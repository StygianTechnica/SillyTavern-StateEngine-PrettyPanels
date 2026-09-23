# SillyTavern-StateEngine-PrettyPanels

Free-floating, theme-aware HUD panels for SillyTavern. Requires the
[State Engine](https://github.com/StygianTechnica/SillyTavern-StateEngine) extension.

## Usage (MVP)

- **Extensions → Pretty Panels** drawer holds the global controls:
  - **Enable Pretty Panels** - when off, every panel and the wand entry are hidden and
    Editing Mode is turned off. Saved panels are kept and come back when re-enabled.
  - **Editing Mode** - shows editing chrome and the wand entry. When off, panels are a clean HUD.
- **Magic Wand → New Pretty Panel** (only in Editing Mode) creates a panel.
- In Editing Mode:
  - drag the dotted strip at the top of a panel to move it;
  - drag the bottom-right grip to resize it;
  - click the tiny dot in the top-right corner to open that panel's properties
    (name, position, size, lock/unlock, delete).
- Locked panels can't be moved or resized until unlocked.
- Every panel is saved to extension settings and restored on reload.

## Layout

| Path | Role |
| --- | --- |
| `src/panels/panel-registry.js` | Persisted panel records (`extensionSettings.prettyPanels.panels`, keyed by ID) |
| `src/panels/panel-manager.js` | Live `Panel` instances; routes every change through the registry |
| `src/panels/panel.js` | One independent panel element: drag, resize, edit affordance |
| `src/panels/properties-popup.js` | Per-panel properties popup |
| `src/ui/wand-menu.js` | Magic Wand "New Pretty Panel" entry |
| `src/ui/settings-drawer.js` + `settings.html` | Extensions-drawer global settings |
| `src/api/*` | Thin State Engine API wrappers (namespace, registration, capabilities) |
