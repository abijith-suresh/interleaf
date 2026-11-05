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

// Read and release a qpdf-owned C string, then clear the slot that held it.
function takeCString(module, pointerPointer) {
  const pointer = readUint32(module, pointerPointer);
  const value = readCString(module, pointer);
  if (pointer) module._qpdf_free(pointer);
  new DataView(module.HEAPU8.buffer).setUint32(pointerPointer, 0, true);
  return value;
}

// R5 and R6 passwords are UTF-8. R2 to R4 passwords are bytes, which PDF.js
// takes from the low byte of each UTF-16 code unit. Try UTF-8 first, then
// those bytes when they differ.
function passwordCandidates(password) {
  if (typeof password !== "string") return [null];
  const utf8 = new TextEncoder().encode(password);
  if (utf8.byteLength === password.length) return [utf8];
  const bytes = Uint8Array.from(
    { length: password.length },
    (_, index) => password.charCodeAt(index) & 0xff
  );
  return [utf8, bytes];
}

function fail(id, code, message) {
  self.postMessage({ type: "error", id, code, message });
}

// Decryption writes an unencrypted copy for the editor's page-building path.
// The password is passed to qpdf only and never stored or logged.
const operations = {
  optimize: { run: "_qpdf_optimize", failure: "qpdf could not optimize the PDF" },
  decrypt: { run: "_qpdf_decrypt", failure: "qpdf could not decrypt the PDF" },
};

self.addEventListener("message", async (event) => {
  const request = event.data;
  const operation = Object.hasOwn(operations, request?.type) ? operations[request.type] : null;
  if (!operation) return;

  try {
    const module = await getModule();
    const input = new Uint8Array(request.input);
    const inputPointer = module._malloc(Math.max(input.byteLength, 1));
    const outputPointerPointer = module._malloc(4);
    const outputSizePointer = module._malloc(4);
    const errorPointerPointer = module._malloc(4);

    try {
      module.HEAPU8.set(input, inputPointer);

      let status = -1;
      let firstError = "";
      for (const password of passwordCandidates(request.password)) {
        const passwordPointer = password ? module._malloc(Math.max(password.byteLength, 1)) : 0;
        try {
          if (password) module.HEAPU8.set(password, passwordPointer);
          status = module[operation.run](
            inputPointer,
            input.byteLength,
            passwordPointer,
            password?.byteLength ?? 0,
            outputPointerPointer,
            outputSizePointer,
            errorPointerPointer
          );
        } finally {
          if (passwordPointer) module._free(passwordPointer);
        }
        if (status === 0) break;
        const message = takeCString(module, errorPointerPointer);
        firstError ||= message;
      }

      if (status !== 0) {
        fail(request.id, "QPDF_EXEC_FAILED", firstError || operation.failure);
        return;
      }

      const outputPointer = readUint32(module, outputPointerPointer);
      const candidateSize = readUint32(module, outputSizePointer);

      if (request.type === "decrypt") {
        const output = module.HEAPU8.slice(outputPointer, outputPointer + candidateSize);
        self.postMessage({ type: "decrypted", id: request.id, output: output.buffer }, [
          output.buffer,
        ]);
        return;
      }

      const reduced = candidateSize < input.byteLength;
      const output = reduced
        ? module.HEAPU8.slice(outputPointer, outputPointer + candidateSize)
        : input;

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
      module._free(outputPointerPointer);
      module._free(outputSizePointer);
      module._free(errorPointerPointer);
    }
  } catch (error) {
    fail(request.id, "QPDF_INIT_FAILED", error instanceof Error ? error.message : String(error));
  }
});
