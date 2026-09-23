// Small dialog helpers shared by the drawer, wand menu and properties
// pane. Messages are plain text (escaped here before reaching
// SillyTavern's HTML popups). Each prefers SillyTavern's own popup and
// falls back to the native browser dialog.

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

export async function confirmYesNo(message) {
    try {
        const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = SillyTavern.getContext();
        if (typeof callGenericPopup === 'function' && POPUP_TYPE) {
            const result = await callGenericPopup(escapeHtml(message), POPUP_TYPE.CONFIRM);
            return result === (POPUP_RESULT?.AFFIRMATIVE ?? 1);
        }
    } catch {
        // Fall through to the native dialog.
    }
    return window.confirm(message);
}

// Resolves the trimmed text entered, or null if cancelled/blank.
export async function promptText(message, defaultValue = '') {
    try {
        const { callGenericPopup, POPUP_TYPE } = SillyTavern.getContext();
        if (typeof callGenericPopup === 'function' && POPUP_TYPE?.INPUT !== undefined) {
            const result = await callGenericPopup(escapeHtml(message), POPUP_TYPE.INPUT, defaultValue);
            return typeof result === 'string' && result.trim() ? result.trim() : null;
        }
    } catch {
        // Fall through to the native dialog.
    }
    const result = window.prompt(message, defaultValue);
    return result?.trim() || null;
}

export function notify(type, message) {
    const toast = window.toastr?.[type];
    if (typeof toast === 'function') toast(message);
    else console.log(`[PrettyPanels] ${message}`);
}

// A modal list picker. `items`: [{ value, label, detail?, icon? }].
// Resolves the chosen item's value, or undefined if dismissed.
export function chooseFromList({ title, items, emptyText = 'Nothing here yet.' }) {
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'pp-modal-backdrop';
        backdrop.innerHTML = `
            <div class="pp-modal" role="dialog" aria-modal="true">
                <div class="pp-modal-header">
                    <span class="pp-modal-title"></span>
                    <button type="button" class="pp-properties-close" aria-label="Close">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
                <div class="pp-modal-list"></div>
            </div>
        `;
        const titleEl = backdrop.querySelector('.pp-modal-title');
        titleEl.textContent = title;
        backdrop.querySelector('.pp-modal').setAttribute('aria-label', title);

        const finish = (value) => {
            document.removeEventListener('keydown', onKeyDown, true);
            backdrop.remove();
            resolve(value);
        };
        // Capture phase + stopPropagation so Escape closes only this
        // modal, not a properties popup open underneath it.
        const onKeyDown = (e) => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            finish(undefined);
        };

        const listEl = backdrop.querySelector('.pp-modal-list');
        if (items.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'pp-modal-empty';
            empty.textContent = emptyText;
            listEl.appendChild(empty);
        }
        for (const item of items) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'pp-modal-item';
            button.innerHTML = '<i></i><span class="pp-modal-item-label"></span><span class="pp-modal-item-detail"></span>';
            button.querySelector('i').className = `fa-solid ${item.icon ?? 'fa-table-columns'}`;
            button.querySelector('.pp-modal-item-label').textContent = item.label;
            button.querySelector('.pp-modal-item-detail').textContent = item.detail ?? '';
            button.addEventListener('click', () => finish(item.value));
            listEl.appendChild(button);
        }

        // Keep clicks from reaching SillyTavern's outside-click handlers.
        backdrop.addEventListener('pointerdown', (e) => e.stopPropagation());
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) finish(undefined);
        });
        backdrop.querySelector('.pp-properties-close').addEventListener('click', () => finish(undefined));
        document.addEventListener('keydown', onKeyDown, true);

        document.body.appendChild(backdrop);
        backdrop.querySelector('.pp-modal-item, .pp-properties-close')?.focus();
    });
}
