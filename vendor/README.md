# Third-party code in `vendor/`

These two files are the only third-party code the app runs. They are used for QR codes only (never for encryption: all
cryptography is the browser's own WebCrypto). Both were copied in unmodified; check that yours match with
`sha256sum vendor/*.js`.

| File | What it is | Licence | SHA-256 |
|---|---|---|---|
| `qrcode.js` | QR code encoder, "QR Code Generator for JavaScript" by Kazuhiko Arase (2009) | MIT (notice in the file header) | `79ec86f82856005b1c887905cfccfcfbec3821ca61c7fd5a952faa5f778f791c` |
| `jsQR.js` | QR code decoder, [jsQR](https://github.com/cozmo/jsQR) (webpack bundle, exposes `jsQR(data, width, height)`) | Apache-2.0 (`LICENSE-jsqr.txt`) | `bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859` |

Both came from the ulyOS project this app grew out of. Neither file states an upstream version number; the checksums above
identify the exact bytes shipped. If you ever replace one, update the checksum here (the unit tests compare them).
