// Rebuilds fonts/curated/ (the WOFF2 files, their OFL licences and
// manifest.json) from the pinned @fontsource packages in package.json's
// devDependencies. Run from the repository root:
//
//   npm install
//   node tools/build-curated-fonts.mjs
//
// Every curated font is SIL Open Font License 1.1. Files are the Latin and
// Latin Extended splits Fontsource publishes (already WOFF2); Recursive is
// instanced here with HarfBuzz from its "full" file down to the MONO, CASL
// and wght axes (slnt and CRSV pinned), which keeps monospace/casual
// without shipping the 600 KB all-axes file. Axis ranges in the manifest
// are read from each file's own fvar table, not typed by hand.

import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readTables, readAxes } from '../src/fonts/sfnt.js';
import { FontSubsetter } from '../src/fonts/font-subsetter.js';
import { compress, decompress } from '../vendor/woff2/woff2.js';

const OUT = 'fonts/curated';
const MODULES = 'node_modules';

const STACKS = {
    ui: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace',
    serif: 'Georgia, Cambria, "Times New Roman", Times, serif',
    hud: '"Arial Narrow", "Roboto Condensed", system-ui, sans-serif',
    display: '"Segoe UI", system-ui, sans-serif',
    script: '"Segoe Script", "Comic Sans MS", cursive',
    blackletter: '"Old English Text MT", Georgia, serif',
};

// id, display name, category, tags, package, fallback, faces:
// [cssFile, fontsource face name (without .woff2), style]
const FONTS = [
    {
        id: 'inter', name: 'Inter', category: 'ui', tags: ['sans', 'interface'], pkg: '@fontsource-variable/inter', fallback: STACKS.ui,
        faces: [['wght.css', 'inter-latin-wght-normal'], ['wght.css', 'inter-latin-ext-wght-normal'], ['wght-italic.css', 'inter-latin-wght-italic']],
    },
    {
        id: 'roboto-flex', name: 'Roboto Flex', category: 'ui', tags: ['sans', 'interface', 'width'], pkg: '@fontsource-variable/roboto-flex', fallback: STACKS.ui,
        faces: [['wdth.css', 'roboto-flex-latin-wdth-normal'], ['wdth.css', 'roboto-flex-latin-ext-wdth-normal']],
    },
    {
        id: 'recursive', name: 'Recursive', category: 'ui', tags: ['monospace', 'sans', 'casual'], pkg: '@fontsource-variable/recursive', fallback: STACKS.mono,
        faces: [['full.css', 'recursive-latin-full-normal'], ['full.css', 'recursive-latin-ext-full-normal']],
        instance: { pin: { slnt: 0, CRSV: 0.5 }, rename: (f) => f.replace('-full-', '-mono-casl-') },
    },
    {
        id: 'eb-garamond', name: 'EB Garamond', category: 'fantasy', tags: ['serif', 'old style', 'book'], pkg: '@fontsource-variable/eb-garamond', fallback: STACKS.serif,
        faces: [['wght.css', 'eb-garamond-latin-wght-normal'], ['wght.css', 'eb-garamond-latin-ext-wght-normal'], ['wght-italic.css', 'eb-garamond-latin-wght-italic']],
    },
    {
        id: 'crimson-pro', name: 'Crimson Pro', category: 'fantasy', tags: ['serif', 'literary', 'book'], pkg: '@fontsource-variable/crimson-pro', fallback: STACKS.serif,
        faces: [['wght.css', 'crimson-pro-latin-wght-normal'], ['wght.css', 'crimson-pro-latin-ext-wght-normal'], ['wght-italic.css', 'crimson-pro-latin-wght-italic']],
    },
    {
        id: 'fira-code', name: 'Fira Code', category: 'sci_fi', tags: ['monospace', 'tech', 'code'], pkg: '@fontsource-variable/fira-code', fallback: STACKS.mono,
        faces: [['wght.css', 'fira-code-latin-wght-normal'], ['wght.css', 'fira-code-latin-ext-wght-normal']],
    },
    {
        id: 'saira', name: 'Saira', category: 'hud', tags: ['condensed', 'sans', 'width'], pkg: '@fontsource-variable/saira', fallback: STACKS.hud,
        faces: [['standard.css', 'saira-latin-standard-normal'], ['standard.css', 'saira-latin-ext-standard-normal']],
    },
    {
        id: 'orbitron', name: 'Orbitron', category: 'sci_fi', tags: ['display', 'geometric', 'futuristic'], pkg: '@fontsource-variable/orbitron', fallback: STACKS.display,
        faces: [['wght.css', 'orbitron-latin-wght-normal']],
    },
    {
        id: 'caveat', name: 'Caveat', category: 'handwritten', tags: ['script', 'casual'], pkg: '@fontsource-variable/caveat', fallback: STACKS.script,
        faces: [['wght.css', 'caveat-latin-wght-normal'], ['wght.css', 'caveat-latin-ext-wght-normal']],
    },
    {
        id: 'unifrakturmaguntia', name: 'UnifrakturMaguntia', category: 'gothic', tags: ['blackletter', 'fraktur'], pkg: '@fontsource/unifrakturmaguntia', fallback: STACKS.blackletter,
        faces: [['latin-400.css', 'unifrakturmaguntia-latin-400-normal']],
    },
];

// The @font-face block for `file` in a fontsource CSS file.
function cssFace(pkg, cssFile, file) {
    const css = readFileSync(join(MODULES, pkg, cssFile), 'utf8');
    const block = css.split('@font-face').find((b) => b.includes(`/files/${file}.woff2`));
    if (!block) throw new Error(`${pkg}/${cssFile}: no face for ${file}`);
    const get = (prop) => block.match(new RegExp(`${prop}:\\s*([^;]+);`))?.[1].trim() ?? null;
    return { style: get('font-style'), unicodeRange: get('unicode-range') };
}

function descriptorsFor(axes, style) {
    const range = (tag) => axes.find((a) => a.tag === tag);
    const wght = range('wght');
    const wdth = range('wdth');
    return {
        weight: wght ? `${wght.min} ${wght.max}` : '400',
        stretch: wdth ? `${wdth.min}% ${wdth.max}%` : null,
        style: style === 'italic' ? 'italic' : 'normal',
    };
}

const subsetter = await FontSubsetter.create(readFileSync('vendor/harfbuzz/harfbuzz-subset.wasm'));
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'licenses'), { recursive: true });

const manifest = {
    format: 'pretty-panels-font-manifest',
    version: 1,
    note: 'Curated fonts bundled with Pretty Panels. All SIL Open Font License 1.1 - see licenses/. Generated by tools/build-curated-fonts.mjs.',
    fonts: [],
};
let total = 0;

for (const font of FONTS) {
    const pkgJson = JSON.parse(readFileSync(join(MODULES, font.pkg, 'package.json'), 'utf8'));
    if (pkgJson.license !== 'OFL-1.1') throw new Error(`${font.pkg} is not OFL-1.1 (${pkgJson.license})`);
    const licenseFile = `licenses/${font.id}-OFL.txt`;
    copyFileSync(join(MODULES, font.pkg, 'LICENSE'), join(OUT, licenseFile));

    const faces = [];
    let axes = [];
    for (const [cssFile, face] of font.faces) {
        const { style, unicodeRange } = cssFace(font.pkg, cssFile, face);
        let bytes = new Uint8Array(readFileSync(join(MODULES, font.pkg, 'files', `${face}.woff2`)));
        let fileName = `${face}.woff2`;
        if (font.instance) {
            const sfnt = await decompress(bytes);
            // Keep every glyph - only the axes change.
            bytes = await compress(subsetter.subset(sfnt, { codepoints: 'all', noHinting: false, pinAxes: font.instance.pin }));
            fileName = `${font.instance.rename(face)}.woff2`;
        }
        writeFileSync(join(OUT, fileName), bytes);
        total += bytes.byteLength;
        const faceAxes = readAxes(readTables(await decompress(bytes)).tables);
        if (faceAxes.length > axes.length) axes = faceAxes;
        faces.push({
            file_path: fileName,
            ...descriptorsFor(faceAxes, style),
            unicode_range: unicodeRange,
            bytes: bytes.byteLength,
        });
    }
    manifest.fonts.push({
        font_id: font.id,
        display_name: font.name,
        category: font.category,
        tags: font.tags,
        variable_axes: axes.map(({ tag, min, default: def, max }) => ({ tag, min, default: def, max })),
        file_path: faces[0].file_path,
        faces,
        fallback_stack: font.fallback,
        license: 'OFL-1.1',
        license_file: licenseFile,
        source: `${font.pkg}@${pkgJson.version}`,
    });
    console.log(`${font.name.padEnd(20)} ${faces.length} face(s)  axes: ${axes.map((a) => `${a.tag} ${a.min}-${a.max}`).join(', ') || 'static'}`);
}

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\n${manifest.fonts.length} fonts, ${(total / 1024).toFixed(0)} KB total -> ${OUT}/`);
if (!existsSync(join(OUT, 'manifest.json'))) process.exit(1);
