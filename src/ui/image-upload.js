// Image upload for theme assets: pick an image file and turn it into a
// compact data URL fit for settings.json. Raster images are scaled down to
// MAX_DIMENSION on their longest side and re-encoded as WebP (alpha kept);
// an SVG is kept as the vector it is (shown only through <img> / CSS
// url(), where its scripts never run). Anything still over MAX_BYTES is
// refused with a message rather than bloating everyone's settings.

export const MAX_DIMENSION = 1024;
export const MAX_BYTES = 1536 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/avif';

// Resolves the chosen File, or null if the picker was cancelled.
export function pickImageFile() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = ACCEPT;
        input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
        input.addEventListener('cancel', () => resolve(null));
        input.click();
    });
}

function readAsDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('The image could not be read.'));
        reader.readAsDataURL(blob);
    });
}

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('That file is not an image this browser can open.'));
        img.src = src;
    });
}

// Byte size of a data URL's payload.
function dataUrlBytes(dataUrl) {
    const body = dataUrl.slice(dataUrl.indexOf(',') + 1);
    return dataUrl.includes(';base64,') ? Math.floor((body.length * 3) / 4) : decodeURIComponent(body).length;
}

// File -> { value, mime, width, height, bytes }. Throws an Error with a
// user-facing message.
export async function prepareImage(file) {
    if (!file || !file.type.startsWith('image/')) throw new Error('Please choose an image file (PNG, JPEG, WebP, GIF, SVG or AVIF).');
    const original = await readAsDataUrl(file);
    const img = await loadImage(original);
    const width = img.naturalWidth || MAX_DIMENSION;
    const height = img.naturalHeight || MAX_DIMENSION;

    let value = original;
    let mime = file.type;
    let outWidth = width;
    let outHeight = height;
    if (file.type !== 'image/svg+xml') {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(width, height));
        outWidth = Math.max(1, Math.round(width * scale));
        outHeight = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = outWidth;
        canvas.height = outHeight;
        canvas.getContext('2d').drawImage(img, 0, 0, outWidth, outHeight);
        const webp = canvas.toDataURL('image/webp', 0.9);
        // Browsers without a WebP encoder fall back to PNG.
        value = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
        mime = value.slice(5, value.indexOf(';'));
        // Keep the original when re-encoding didn't help (a small PNG icon).
        if (dataUrlBytes(original) < dataUrlBytes(value) && scale === 1) {
            value = original;
            mime = file.type;
        }
    }
    const bytes = dataUrlBytes(value);
    if (bytes > MAX_BYTES) {
        throw new Error(`That image is still ${Math.round(bytes / 1024)} KB after compression - the limit is ${Math.round(MAX_BYTES / 1024)} KB. Try a smaller or simpler image.`);
    }
    return { value, mime, width: outWidth, height: outHeight, bytes };
}
