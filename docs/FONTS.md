# Fonts in Pretty Panels

Pretty Panels draws text in fonts from three sources, all behind one id space:

| Source | Ids | Where it lives |
| --- | --- | --- |
| **System** | `inherit`, `sans`, `serif`, `mono`, `display` | the device's own fonts (generic stacks) |
| **Curated** | `inter`, `roboto-flex`, `recursive`, `eb-garamond`, `crimson-pro`, `fira-code`, `saira`, `orbitron`, `caveat`, `unifrakturmaguntia` | `fonts/curated/` - bundled, SIL Open Font License 1.1 |
| **Local (uploaded)** | `user-<id>` | `extensionSettings.prettyPanels.userFonts` - **only** a sanitized, subsetted WOFF2 |

## How panels reference fonts

A font is chosen **per element**, in the element's `style` (Element Styling):

```json
{
  "type": "free-text",
  "content": "Stormwatch Keep",
  "style": {
    "fontFamily": "eb-garamond",
    "fontWeight": 700,
    "fontStyle": "italic",
    "fontAxes": { "wdth": 80 },
    "fontSize": 28,
    "letterSpacing": 0.02,
    "textTransform": "uppercase",
    "textShadow": "soft"
  }
}
```

| Field | Meaning |
| --- | --- |
| `fontFamily` | font id (table above). Unknown ids fall back to the inherited font. |
| `fontWeight` | 100-1000 (older layouts may hold `normal` / `medium` / `bold` / `extrabold`, still honoured) |
| `fontStyle` | `italic` or unset. Uses the font's italic face if it has one, otherwise the browser slants it. |
| `fontAxes` | other variable-font axes, e.g. `{ "wdth": 60 }` (Saira, Roboto Flex), `{ "MONO": 1, "CASL": 1 }` (Recursive). Applied with `font-variation-settings`. |
| `labelFontFamily` | text elements only: a different font for the label ("HUD labels") |
| `letterSpacing`, `lineHeight`, `textTransform`, `textDecoration`, `textShadow`, `shadowColor` | the rest of the formatting |

Text elements (variable values) and **Free Text** elements (text you type) both use this style.
Free Text also offers presets: Title, Subtitle, Section heading, HUD label, Body text, Caption.
A preset just fills in the fields above once; nothing about the preset itself is stored.

In the editor, the **Font** button in Element Styling opens the Font Picker: category filters,
search, editable preview text, sliders for weight and every variable axis, italic, and
**Add your own font**.

## How themes reference fonts

When Pretty Panels starts, it registers every curated and uploaded font with the page
(`document.fonts`) under a fixed family name:

- curated: `PP_<font_id>` (for example `"PP_saira"`, `"PP_eb-garamond"`)
- uploaded: `UserFont_<id>`: the Font Picker shows each font's details; the id is also in
  `extensionSettings.prettyPanels.userFonts`

So a SillyTavern theme's Custom CSS can use them for decorative text anywhere on the page:

```css
.mes_text h1 { font-family: "PP_unifrakturmaguntia", serif; }
#top-bar { font-family: "PP_saira", sans-serif; font-variation-settings: "wdth" 70; }
```

A curated font file is only downloaded when some text actually uses it.

## Curated library

`fonts/curated/manifest.json` describes every curated font:

```json
{
  "font_id": "saira",
  "display_name": "Saira",
  "category": "hud",
  "tags": ["condensed", "sans", "width"],
  "variable_axes": [{ "tag": "wght", "min": 100, "default": 100, "max": 900 },
                    { "tag": "wdth", "min": 50, "default": 100, "max": 125 }],
  "file_path": "saira-latin-standard-normal.woff2",
  "faces": [{ "file_path": "...", "weight": "100 900", "stretch": "50% 125%", "style": "normal",
              "unicode_range": "U+0000-00FF,...", "bytes": 98912 }],
  "fallback_stack": "\"Arial Narrow\", \"Roboto Condensed\", system-ui, sans-serif",
  "license": "OFL-1.1",
  "license_file": "licenses/saira-OFL.txt",
  "source": "@fontsource-variable/saira@5.3.0"
}
```

Categories: `ui`, `fantasy`, `sci_fi`, `gothic`, `handwritten`, `hud`. Each font ships its
Latin and Latin Extended subsets as separate faces, joined by `unicode-range`.
`file_path` is the primary face. Axis ranges are read from each file's own `fvar` table.

The library is generated, not hand-edited:

```
npm install
npm run build:fonts
```

(`tools/build-curated-fonts.mjs`, from the pinned Fontsource packages in `package.json`.)
Recursive is instanced there with HarfBuzz down to its `MONO`, `CASL` and `wght` axes, which
keeps monospace and casual without shipping the 600 KB all-axes file.

## Uploading a font

Accepted: `.ttf`, `.otf`, `.woff`, `.woff2` (up to 15 MB; font collections are refused).
The file never leaves the browser and is never stored. The pipeline:

1. **Sandbox.** The file's bytes are *transferred* to a dedicated module Worker
   (`src/fonts/font-worker.js`), which has no DOM or page access and is terminated after the
   job (60-second limit).
2. **Decode and validate** (`sfnt.js`): format detection, WOFF/WOFF2 decoding, and a
   bounds-checked table directory. Required tables and outlines must be present.
3. **Licence check.** The font's own embedding bits (OS/2 `fsType`) are honoured: fonts marked
   *restricted*, *no subsetting* or *bitmap only* are **rejected** with a clear message.
4. **Strip** (`font-converter.js`): only whitelisted tables are kept: outlines (`glyf`/`loca`,
   `CFF `, `CFF2`), metrics, `cmap`, `name`, `OS/2`, `post`, OpenType layout (`GDEF`, `GPOS`,
   `GSUB`, `kern`), variations (`fvar`, `gvar`, `avar`, `HVAR`, `MVAR`, `VVAR`, `STAT`),
   vertical metrics, `COLR`/`CPAL` and `gasp`. Everything else is removed: hinting bytecode
   (`fpgm`, `prep`, `cvt `, `cvar`, `hdmx`, `VDMX`, `LTSH`), SVG documents, bitmap strikes,
   `DSIG`, `meta`, Graphite/AAT programs and vendor tables.
5. **Subset** (`font-subsetter.js`, HarfBuzz `hb-subset` as a standalone WebAssembly module
   with no imports): keeps the glyphs for the chosen character sets (Latin, Latin Extended,
   Cyrillic, Greek, Symbols) **plus every character currently shown in the layout**, removes
   glyph instructions and CFF hints, and rebuilds every kept table. The name table keeps only
   the naming and version records and the font's legal notices (see below).
6. **Whitelist again** and rebuild the SFNT with fresh checksums.
7. **WOFF2**: compressed, decompressed again and re-validated. Where the browser allows it,
   the browser's own font sanitizer must also accept it. Any failure rejects the font.

The stored record (`prettyPanels.userFonts[font_id]`):

```json
{
  "font_id": "user-mufv9n3y74uti",
  "display_name": "Bahnschrift",
  "source": "local",
  "family": "UserFont_mufv9n3y74uti",
  "sanitized_base64_woff2": "d09GMgABAAAA...",
  "variable_axes": [{ "tag": "wght", "min": 300, "default": 400, "max": 700 }],
  "fallback_stack": "system-ui, sans-serif",
  "notice": { "copyright": "...", "license": "...", "license_url": "..." },
  "subset_info": {
    "charsets": ["latin", "latin-ext"], "extra_characters": 2,
    "codepoint_count": 393, "unicode_range": "U+0020-007E,...", "glyph_count": 440,
    "tables_kept": ["GDEF", "GPOS", "..."], "tables_removed": ["DSIG", "cvt", "fpgm", "meta", "prep"],
    "hinting_removed": true, "original_format": "TrueType/OpenType",
    "original_bytes": 361564, "sanitized_bytes": 69272,
    "created_at": "...", "tool": "hb-subset + woff2 (Pretty Panels font sandbox)"
  }
}
```

A record is only accepted if its data starts with the WOFF2 signature and is under 2 MB of
base64. The registry refuses anything else.

**Legal notices are kept on purpose.** The copyright, trademark and licence records (`name`
IDs 0, 7, 13, 14) stay in the sanitized font and are shown in the Font Picker. Font licences,
including the OFL, require them to travel with every copy, and an exported layout is a copy.
All other metadata is removed.

Characters that appear later (a new name in a value) and aren't in the chosen character sets
fall back to the element's fallback font. Pick the character sets you need when uploading.

## Export and import

Exporting a layout or panel template adds a `fonts` section with **every non-system font its
elements use**, embedded as base64 WOFF2 (curated fonts from their bundled files, uploaded fonts
from their sanitized subset). No URL is referenced and nothing but WOFF2 is embedded; each face
is checked for the WOFF2 signature.

```json
"fonts": {
  "faces": [
    { "font_id": "user-mufv9n3y74uti", "display_name": "Bahnschrift", "source": "local",
      "family": "UserFont_mufv9n3y74uti", "variable_axes": [...], "subset_info": {...}, "notice": {...},
      "faces": [{ "weight": "300 700", "style": "normal", "stretch": "75% 100%",
                  "unicode_range": "U+0020-007E,...", "base64_woff2": "d09GMg..." }] }
  ],
  "css": "@font-face {\n  font-family: \"UserFont_mufv9n3y74uti\";\n  src: url(data:font/woff2;base64,d09GMg...) format(\"woff2\");\n  font-weight: 300 700;\n  font-style: normal;\n  ..."
}
```

`css` holds ready-to-use `@font-face` blocks for anyone using the export outside Pretty Panels.

On **import**, Pretty Panels never uses that CSS. Curated fonts it already has are used as-is.
Every other embedded font goes back through the **same sandbox and pipeline** as an upload
before it is stored. It gets a new id, the imported elements are pointed at it, and a font
imported twice is stored only once. If any embedded font is rejected, nothing is imported.

Embedding curated fonts makes exports larger (roughly 50-270 KB per font used).

## Code map

| Module | Role |
| --- | --- |
| `src/fonts/font-registry.js` | **FontRegistry**: curated + system + user fonts, CSS family names, `document.fonts` registration, user font storage |
| `src/fonts/font-converter.js` | **FontConverter**: the sanitization pipeline |
| `src/fonts/font-subsetter.js` | **FontSubsetter**: HarfBuzz subsetting and axis pinning |
| `src/fonts/font-preview.js` | **FontPreviewRenderer**: preview text with weight/style/axes |
| `src/fonts/font-export.js` | **FontExportAssembler**: `@font-face` / embedded fonts for export; import |
| `src/fonts/font-worker.js` | the ingestion sandbox (module Worker) |
| `src/fonts/font-ingest.js` | page-side upload / re-sanitize entry points |
| `src/fonts/sfnt.js` | dependency-free SFNT/WOFF reading and writing |
| `src/fonts/charsets.js` | character set ranges |
| `src/ui/font-picker.js` | the Font Picker popover |
| `src/ui/font-transfer.js` | attaches fonts to exports, receives them on import |
| `vendor/harfbuzz/` | `harfbuzz-subset.wasm` from harfbuzzjs 1.6.2 (MIT; HarfBuzz "Old MIT") |
| `vendor/woff2/` | `woff2.js` from woff2-encoder 2.0.0 (MIT; Google woff2 and Brotli, MIT) |
