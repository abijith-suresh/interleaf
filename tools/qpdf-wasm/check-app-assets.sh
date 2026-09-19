#!/usr/bin/env bash

set -euo pipefail

readonly GENERATED_DIR="${1:?generated qpdf directory is required}"
readonly APP_DIR="${2:?application qpdf directory is required}"

die() {
  echo "qpdf app assets: $*" >&2
  exit 1
}

for file in qpdf.mjs qpdf.wasm qpdf-worker.js; do
  [[ -s "${GENERATED_DIR}/${file}" ]] || die "missing generated asset: ${file}"
  [[ -s "${APP_DIR}/${file}" ]] || die "missing application asset: ${file}"
  cmp -s "${GENERATED_DIR}/${file}" "${APP_DIR}/${file}" ||
    die "application asset does not match the verified qpdf build: ${file}"
done

expected_checksums="$(cd "$APP_DIR" && sha256sum qpdf.mjs qpdf.wasm qpdf-worker.js)"
actual_checksums="$(<"${APP_DIR}/SHA256SUMS")"
[[ "$actual_checksums" == "$expected_checksums" ]] ||
  die "application asset checksums do not match SHA256SUMS"

echo "qpdf application assets match the verified build"
