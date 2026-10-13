// Image sets: an enum runtime field's images as a file
// (src/library/image-set-library.js).

import { readFileSync } from 'node:fs';
import {
    IMAGE_SET_FORMAT, parseImageSet, buildImageSet, matchImageSet, fitExtraValues, imageKind, emojiImage, decodeDataUrl, uploadFileName,
} from '../src/library/image-set-library.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('image set files', () => {
    it('an export holds the values and the images the field has', () => {
        const set = buildImageSet({ name: ' Moods ', values: ['Happy', 'Sad'], images: { Happy: PNG, Sad: '', Gone: PNG } });
        expect(set).toEqual({ format: IMAGE_SET_FORMAT, version: 1, name: 'Moods', values: ['Happy', 'Sad'], images: { Happy: PNG } });
        expect(parseImageSet(JSON.parse(JSON.stringify(set)))).toEqual({ name: 'Moods', description: '', values: ['Happy', 'Sad'], images: { Happy: PNG } });
    });

    it('a file is checked', () => {
        expect(() => parseImageSet(null)).toThrow(/not an image set/);
        expect(() => parseImageSet({ format: 'other' })).toThrow(/not a Pretty Panels image set/);
        expect(() => parseImageSet({ format: IMAGE_SET_FORMAT, version: 99, images: { a: PNG } })).toThrow(/newer/);
        expect(() => parseImageSet({ format: IMAGE_SET_FORMAT, version: 1, values: ['a'], images: {} })).toThrow(/no images/);
    });

    it('values are deduplicated ignoring case, and an image for an unlisted value adds it', () => {
        const set = parseImageSet({ format: IMAGE_SET_FORMAT, version: 1, values: ['Happy', 'happy', ' '], images: { HAPPY: PNG, Calm: 'emoji:😌' } });
        expect(set.values).toEqual(['Happy', 'Calm']);
        expect(set.images).toEqual({ Happy: PNG, Calm: 'emoji:😌' });
    });

    it('the shipped sets are valid', () => {
        const dir = new URL('../assets/image-sets/', import.meta.url);
        const index = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8'));
        expect(index.sets.length).toBeGreaterThan(0);
        for (const entry of index.sets) {
            const set = parseImageSet(JSON.parse(readFileSync(new URL(entry.file, dir), 'utf8')));
            expect(set.values.length).toBeLessThanOrEqual(30);
            for (const value of set.values) expect(set.images[value], `${entry.file}: ${value}`).toBeTruthy();
        }
    });
});

describe('matching a set to a field', () => {
    const set = { name: 'S', values: ['happy', 'Sad', 'Calm'], images: { happy: PNG, Sad: 'emoji:😢', Calm: 'emoji:😌' } };

    it('matches values ignoring case, under the field’s spelling', () => {
        const result = matchImageSet(set, ['Happy', 'Sad', 'Angry'], { Sad: 'user/images/characters/sad.png', Angry: 'x.png' });
        expect(result.matched).toEqual({ Happy: PNG, Sad: 'emoji:😢' });
        expect(result.extra).toEqual(['Calm']);
        expect(result.replacing).toEqual(['Sad']);
    });

    it('extra values stop at State Engine’s 30-value limit', () => {
        const field = Array.from({ length: 28 }, (_, i) => `v${i}`);
        expect(fitExtraValues(field, ['a', 'b', 'c'])).toEqual({ added: ['a', 'b'], skipped: ['c'] });
    });
});

describe('set images', () => {
    it('kinds', () => {
        expect(imageKind(PNG)).toBe('data');
        expect(imageKind('https://x/y.png')).toBe('url');
        expect(imageKind('emoji:😀')).toBe('emoji');
        expect(imageKind('happy.png')).toBe('file');
        expect(imageKind('javascript:alert(1)')).toBe(null);
        expect(imageKind('')).toBe(null);
    });

    it('an emoji becomes an SVG data URL State Engine will show', () => {
        const url = emojiImage('emoji:😀');
        expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
        const decoded = decodeDataUrl(url);
        expect(decoded.type).toBe('image/svg+xml');
        expect(new TextDecoder().decode(decoded.bytes)).toContain('😀');
    });

    it('data URLs decode, base64 or not', () => {
        expect(decodeDataUrl(PNG).bytes.slice(0, 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
        expect(new TextDecoder().decode(decodeDataUrl('data:image/svg+xml;utf8,%3Csvg%3E').bytes)).toBe('<svg>');
        expect(decodeDataUrl('nope')).toBe(null);
    });

    it('uploads are named after the field and value', () => {
        expect(uploadFileName('mood', 'Very Happy!', 'image/jpeg')).toBe('mood-very-happy.jpg');
        expect(uploadFileName('', '', 'image/x')).toBe('image.png');
    });
});
