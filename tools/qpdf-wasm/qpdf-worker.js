import createQpdfModule from "./qpdf.mjs";

let modulePromise;

function getModule() {
  modulePromise ??= createQpdfModule({ noInitialRun: true });
  return modulePromise;
}

function readCString(module, pointer) {
  if (!pointer) return "";

  const bytes = [];
  for (let index = pointer; module.HEAPU8[index] !== 0; index += 1) {
    bytes.push(module.HEAPU8[index]);
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function readUint32(module, pointer) {
  return new DataView(module.HEAPU8.buffer).getUint32(pointer, true);
}

function fail(id, code, message) {
  self.postMessage({ type: "error", id, code, message });
}

self.addEventListener("message", async (event) => {
  const request = event.data;
  if (request?.type !== "optimize") return;

  try {
    const module = await getModule();
    const input = new Uint8Array(request.input);
    const password =
      typeof request.password === "string" ? new TextEncoder().encode(request.password) : null;
    const inputPointer = module._malloc(Math.max(input.byteLength, 1));
    const passwordPointer = password ? module._malloc(Math.max(password.byteLength, 1)) : 0;
    const outputPointerPointer = module._malloc(4);
    const outputSizePointer = module._malloc(4);
    const errorPointerPointer = module._malloc(4);

    try {
      module.HEAPU8.set(input, inputPointer);
      if (password) module.HEAPU8.set(password, passwordPointer);

      const status = module._qpdf_optimize(
        inputPointer,
        input.byteLength,
        passwordPointer,
        password?.byteLength ?? 0,
        outputPointerPointer,
        outputSizePointer,
        errorPointerPointer
      );
      const outputPointer = readUint32(module, outputPointerPointer);
      const candidateSize = readUint32(module, outputSizePointer);
      const errorPointer = readUint32(module, errorPointerPointer);

      if (status !== 0) {
        const message = readCString(module, errorPointer) || "qpdf could not optimize the PDF";
        fail(request.id, "QPDF_EXEC_FAILED", message);
        return;
      }

      const candidate = module.HEAPU8.slice(outputPointer, outputPointer + candidateSize);
      const reduced = candidate.byteLength < input.byteLength;
      const output = reduced ? candidate : input.slice();

      self.postMessage(
        {
          type: "result",
          id: request.id,
          output: output.buffer,
          inputSize: input.byteLength,
          candidateSize,
          reduced,
        },
        [output.buffer]
      );
    } finally {
      const outputPointer = readUint32(module, outputPointerPointer);
      const errorPointer = readUint32(module, errorPointerPointer);
      if (outputPointer) module._qpdf_free(outputPointer);
      if (errorPointer) module._qpdf_free(errorPointer);
      module._free(inputPointer);
      if (passwordPointer) module._free(passwordPointer);
      module._free(outputPointerPointer);
      module._free(outputSizePointer);
      module._free(errorPointerPointer);
    }
  } catch (error) {
    fail(request.id, "QPDF_INIT_FAILED", error instanceof Error ? error.message : String(error));
  }
});
