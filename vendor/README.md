# Vendored third-party code

Copied unmodified from npm so Pretty Panels works offline and never loads code from a CDN.
Used only by the font pipeline (see `docs/FONTS.md`).

| Folder | File | From | Licence |
| --- | --- | --- | --- |
| `harfbuzz/` | `harfbuzz-subset.wasm` | [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) 1.6.2, `dist/harfbuzz-subset.wasm` | harfbuzzjs: MIT (`LICENSE`); HarfBuzz: "Old MIT" (`HARFBUZZ-COPYING`) |
| `woff2/` | `woff2.js` | [woff2-encoder](https://github.com/itskyedo/woff2-encoder) 2.0.0, `dist/index.js` (WebAssembly inlined) | woff2-encoder: MIT (`LICENSE`); Google woff2: MIT (`GOOGLE-WOFF2-LICENSE`); Brotli: MIT (`BROTLI-LICENSE`) |

`harfbuzz-subset.wasm` is a standalone module with no imports: it can only read and write the
memory it is given.
