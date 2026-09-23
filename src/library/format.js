// The on-disk envelope for exported layouts and panel templates. Every
// export is tagged with a format, a kind and a version so a template
// file can't be imported as a layout (or vice versa), and a file from a
// newer, incompatible version is refused with a clear message.

const FORMAT = 'SillyTavern-StateEngine-PrettyPanels';
const FORMAT_VERSION = 1;

export const KIND = {
    LAYOUT: 'layout',
    PANEL_TEMPLATE: 'panel-template',
};

const KIND_LABELS = {
    [KIND.LAYOUT]: 'layout',
    [KIND.PANEL_TEMPLATE]: 'panel template',
};

export function makePayload(kind, data) {
    return {
        format: FORMAT,
        kind,
        version: FORMAT_VERSION,
        exportedAt: new Date().toISOString(),
        data,
    };
}

// Parses exported JSON text and returns its `data`, or throws an Error
// whose message is safe to show the user as-is.
export function readPayload(text, kind) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        throw new Error('That file is not valid JSON.');
    }
    if (parsed?.format !== FORMAT) {
        throw new Error('That file is not a Pretty Panels export.');
    }
    if (parsed.kind !== kind) {
        const found = KIND_LABELS[parsed.kind] ?? 'different kind of export';
        throw new Error(`That file contains a ${found}, not a ${KIND_LABELS[kind]}.`);
    }
    if (!(parsed.version <= FORMAT_VERSION)) {
        throw new Error('That file was exported by a newer version of Pretty Panels.');
    }
    if (parsed.data === null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
        throw new Error('That file has no usable data.');
    }
    return parsed.data;
}
