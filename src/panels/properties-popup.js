// Properties popup for ONE panel. Each Panel owns its own instance
// (created on open, discarded on close), so several panels' popups can
// be open at once without sharing state. Contents: name, position and
// size (read-only), lock toggle, delete, close, and the Panel Library
// actions for THIS instance - save as a template, export as a template.

const POPUP_GAP = 8;

export class PanelPropertiesPopup {
    // hooks: { onLockToggle(locked), onDelete(), onSaveTemplate(), onExportTemplate(), onClose() }
    constructor(panel, hooks) {
        this.panel = panel;
        this.hooks = hooks;
        this.el = this.#build();
        this.onKeyDown = (e) => {
            if (e.key === 'Escape') this.close();
        };
    }

    open() {
        if (!this.el.isConnected) {
            document.body.appendChild(this.el);
            document.addEventListener('keydown', this.onKeyDown);
        }
        this.refresh();
    }

    close() {
        if (!this.el.isConnected) return;
        document.removeEventListener('keydown', this.onKeyDown);
        this.el.remove();
        this.hooks.onClose();
    }

    // Re-reads the panel's state into the popup and re-anchors it.
    // `geometry` may be passed mid-drag, before anything is committed.
    refresh(geometry = this.panel.getRenderedGeometry()) {
        if (!this.el.isConnected) return;
        const { record } = this.panel;
        this.el.querySelector('[data-field="name"]').textContent = record.name;
        this.el.querySelector('[data-field="position"]').textContent = `${geometry.x}, ${geometry.y}`;
        this.el.querySelector('[data-field="size"]').textContent = `${geometry.width} × ${geometry.height}`;

        const lockButton = this.el.querySelector('[data-action="lock"]');
        lockButton.classList.toggle('pp-active', record.locked);
        lockButton.querySelector('i').className = `fa-solid ${record.locked ? 'fa-lock' : 'fa-lock-open'}`;
        lockButton.querySelector('span').textContent = record.locked ? 'Locked' : 'Unlocked';

        this.#position(geometry);
    }

    #build() {
        const el = document.createElement('div');
        el.className = 'pp-properties';
        el.dataset.panelId = this.panel.id;
        el.innerHTML = `
            <div class="pp-properties-header">
                <span class="pp-properties-title">Panel Properties</span>
                <button type="button" class="pp-properties-close" data-action="close" aria-label="Close">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            <dl class="pp-properties-fields">
                <dt>Name</dt><dd data-field="name"></dd>
                <dt>Position</dt><dd data-field="position"></dd>
                <dt>Size</dt><dd data-field="size"></dd>
            </dl>
            <div class="pp-properties-actions">
                <button type="button" class="menu_button pp-properties-button" data-action="lock">
                    <i class="fa-solid fa-lock-open"></i><span>Unlocked</span>
                </button>
                <button type="button" class="menu_button pp-properties-button pp-danger" data-action="delete">
                    <i class="fa-solid fa-trash-can"></i><span>Delete</span>
                </button>
            </div>
            <div class="pp-properties-section-label">Panel Library</div>
            <div class="pp-properties-actions">
                <button type="button" class="menu_button pp-properties-button" data-action="save-template" title="Save this panel to the Panel Library">
                    <i class="fa-solid fa-floppy-disk"></i><span>Save</span>
                </button>
                <button type="button" class="menu_button pp-properties-button" data-action="export-template" title="Export this panel as a template file">
                    <i class="fa-solid fa-file-export"></i><span>Export</span>
                </button>
            </div>
        `;
        // Keep clicks inside the popup from reaching SillyTavern's own
        // outside-click handlers (which would close open drawers/menus).
        el.addEventListener('pointerdown', (e) => e.stopPropagation());
        el.querySelector('[data-action="close"]').addEventListener('click', () => this.close());
        el.querySelector('[data-action="lock"]').addEventListener('click', () => {
            this.hooks.onLockToggle(!this.panel.record.locked);
        });
        el.querySelector('[data-action="delete"]').addEventListener('click', () => this.hooks.onDelete());
        el.querySelector('[data-action="save-template"]').addEventListener('click', () => this.hooks.onSaveTemplate());
        el.querySelector('[data-action="export-template"]').addEventListener('click', () => this.hooks.onExportTemplate());
        return el;
    }

    // Anchors beside the panel: right side if it fits, else left, else
    // overlapping - always clamped inside the viewport.
    #position(geometry) {
        const w = this.el.offsetWidth;
        const h = this.el.offsetHeight;
        let x = geometry.x + geometry.width + POPUP_GAP;
        if (x + w > window.innerWidth) x = geometry.x - w - POPUP_GAP;
        if (x < 0) x = Math.max(0, window.innerWidth - w - POPUP_GAP);
        const y = Math.min(Math.max(0, geometry.y), Math.max(0, window.innerHeight - h - POPUP_GAP));
        this.el.style.left = `${x}px`;
        this.el.style.top = `${y}px`;
    }
}
