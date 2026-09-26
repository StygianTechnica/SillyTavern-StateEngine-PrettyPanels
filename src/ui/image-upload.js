// Image file picker for theme assets. The picked file is checked and
// stored by State Engine's Image API (src/themes/asset-files.js).

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp';

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
