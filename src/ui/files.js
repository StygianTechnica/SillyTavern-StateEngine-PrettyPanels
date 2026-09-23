// Browser file plumbing for import/export: save a JSON payload as a
// download, and let the user pick a JSON file to read.

export function safeFilename(name) {
    return String(name).replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'pretty-panels';
}

export function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

// Resolves the chosen file's text, or null if the picker was cancelled.
export function pickJsonFile() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            resolve(file ? await file.text() : null);
        });
        input.addEventListener('cancel', () => resolve(null));
        input.click();
    });
}
