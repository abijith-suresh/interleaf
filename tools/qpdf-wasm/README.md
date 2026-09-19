# qpdf WASM runtime

This directory contains the browser boundary for Interleaf's lossless PDF compression workflow.
The editor uses it to optimize an untouched, single uploaded PDF without sending its bytes to a
server.

The build pins qpdf 12.4.1 to the official release archive and checks its SHA-256 before compiling it
with Emscripten 3.1.72. The generated worker uses qpdf's in-memory C++ API, so PDF bytes do not pass
through a server or a temporary browser file.

The optimization profile is intentionally narrow:

- generalized and specialized non-lossy filters may be decoded;
- Flate streams are recompressed at level 9;
- object streams are generated for PDFs that already support PDF 1.5 object streams; older PDFs
  keep their existing object-stream mode and version;
- encryption is preserved when the caller supplies the password;
- applied signed PDFs are rejected because any rewrite would invalidate their signature; empty
  signature fields are preserved;
- image optimization, JPEG decoding/re-encoding, metadata removal, decryption, and rasterization are
  not enabled.

qpdf reparses its output before returning it. It may still produce an output that is larger than the
input. The worker returns the original bytes in that case and reports the candidate size, so a later
product surface can honestly say that no reduction was available.

## Build

Use an Emscripten environment matching the pinned toolchain. The verified loader, worker, and WASM
binary are checked into `public/qpdf/` so normal application builds do not require Emscripten.

```sh
./tools/qpdf-wasm/build-qpdf-wasm.sh
```

The script also works from the official Emscripten Docker image:

```sh
docker run --rm -it \
  -v "$PWD":/src \
  -w /src \
  emscripten/emsdk:3.1.72 \
  ./tools/qpdf-wasm/build-qpdf-wasm.sh
```

Pass an output directory as the first argument when the generated files need to be served by a local
browser smoke test:

```sh
./tools/qpdf-wasm/build-qpdf-wasm.sh /tmp/interleaf-qpdf
```

Serve that directory and open `smoke.html` in a browser to exercise the real worker and WASM module:

```sh
python3 -m http.server 8080 --directory /tmp/interleaf-qpdf
```

The smoke page is intentionally small: it checks the real worker boundary, output header, and size
decision. CI opens it in Chromium after building the generated assets.

`fidelity.html` is the qpdf fidelity fixture suite. It exercises real qpdf WASM behavior for
recompression, page text, forms, annotations, images, 40-bit R3 and AES-256 R6 encrypted input,
wrong passwords, malformed input, and signed-document rejection. The encrypted fixture provenance
and license are recorded in `fixtures/README.md`. This suite is still not a substitute for
editor-level regression tests.

The generated `qpdf-worker.js` imports `qpdf.mjs` beside it. The editor loads that worker through
`QpdfProcessing` when the compression workflow runs.

The current compression workflow sends the untouched uploaded source file to qpdf. It stays
disabled after page edits or selection so compression cannot silently discard document-level data
that the editor's page-building path does not preserve yet.

The application keeps the verified runtime in `public/qpdf/`. CI rebuilds qpdf and compares those
three deployed assets byte-for-byte with the build output using `check-app-assets.sh`. The
`SHA256SUMS` file in that directory records the checked-in bytes.
