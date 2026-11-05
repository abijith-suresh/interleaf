# Fidelity fixture provenance

`encrypted-40-bit-r3.b64` is the base64 representation of
`qpdf/qtest/qpdf/encrypted-40-bit-R3.pdf` from qpdf v12.4.1:

https://github.com/qpdf/qpdf/blob/v12.4.1/qpdf/qtest/qpdf/encrypted-40-bit-R3.pdf

The upstream file is distributed under qpdf's Apache-2.0 license. Its qpdf test password is
`623`. Its SHA-256 is `221b17165d2c807500165c7890f6f8f355b6cf62ecdb430d9bae71cec17b8369`.

`encrypted-256-bit-r6.b64` is the base64 representation of
`qpdf/qtest/qpdf/enc-XI-R6,V5,U=wwwww,O=wwwww.pdf` from qpdf v12.4.1:

https://github.com/qpdf/qpdf/blob/v12.4.1/qpdf/qtest/qpdf/enc-XI-R6%2CV5%2CU%3Dwwwww%2CO%3Dwwwww.pdf

The upstream file is distributed under qpdf's Apache-2.0 license. Its user password is
`wwwww`. Its SHA-256 is `94ce7ecade61858c0c0cf8b20b92fdf639550a50aa5a1b6bde767d713544e376`.
The repository's [NOTICE](../NOTICE.md) records the qpdf license and source links.

`encrypted-256-bit-owner-only.b64` is the base64 representation of the same 30-page R6 file,
re-encrypted by qpdf 11.9.0 from Ubuntu 24.04 with an empty user password and the owner password
`owner`:

```sh
qpdf --password=wwwww --object-streams=generate --static-aes-iv --static-id \
  --encrypt --user-password= --owner-password=owner --bits=256 -- in.pdf owner-only.pdf
```

It opens without a password prompt. Its SHA-256 is
`87483dc898d35bb92b6dbf95192832b0b6c31e20db1f15467f1bcffc6dfa3dcf`.

`encrypted-128-bit-r3-latin1-password.b64` is `encrypted-40-bit-r3.b64` re-encrypted by the same
qpdf 11.9.0 as an RC4 128-bit R3 file with the user password `é`, which R3 stores as the single
PDFDocEncoding byte `0xE9`, and the owner password `owner`:

```sh
qpdf --password=623 --static-id --allow-weak-crypto \
  --encrypt --user-password=é --owner-password=owner --bits=128 --use-aes=n -- in.pdf out.pdf
```

Its SHA-256 is `2eafb8cf2a4298c58562919c62a6a31d23168e30cb12dddfe12dc5edf00ff2f8`.
