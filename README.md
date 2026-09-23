# SillyTavern-StateEngine-PrettyPanels

Free-floating, theme-aware HUD panels for SillyTavern. Requires the
[State Engine](https://github.com/StygianTechnica/SillyTavern-StateEngine) extension.

## Usage (MVP)

- **Magic Wand → New Pretty Panel** creates a panel and turns Editing Mode on.
- **Magic Wand → Panel Editing Mode** toggles editing chrome. When off, panels are a clean HUD.
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
| `src/ui/wand-menu.js` | Magic Wand menu entries |
| `src/api/*` | Thin State Engine API wrappers (namespace, registration, capabilities) |
