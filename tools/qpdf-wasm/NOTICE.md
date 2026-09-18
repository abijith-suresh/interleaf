# qpdf WASM notices

The generated WASM module links the following permissively licensed components:

- qpdf 12.4.1 — Apache License 2.0, including qpdf's bundled native crypto implementation and the
  notices in the upstream distribution.
- zlib — Zlib license, supplied through the Emscripten port.
- libjpeg — Independent JPEG Group license, supplied through the Emscripten port.

The generated asset is not shipped by this spike. When it is added to the application, carry this file
and the upstream qpdf notice with the deployed asset. Sources:

- https://github.com/qpdf/qpdf/tree/v12.4.1
- https://raw.githubusercontent.com/qpdf/qpdf/v12.4.1/NOTICE.md
- https://zlib.net/zlib_license.html
- https://www.ijg.org/files/README
