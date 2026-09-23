# SillyTavern-StateEngine-PrettyPanels

Free-floating, theme-aware HUD panels for SillyTavern. Requires the
[State Engine](https://github.com/StygianTechnica/SillyTavern-StateEngine) extension.

## Usage

- **Extensions → Pretty Panels** drawer holds the global controls:
  - **Enable Pretty Panels** - when off, every panel and the wand entries are hidden and
    Editing Mode is turned off. Saved layouts are kept and come back when re-enabled.
  - **Editing Mode** - shows editing chrome and the wand entries. When off, panels are a clean HUD.
  - **Layout Library** - pick the active layout, or create, duplicate, rename, export, import
    and delete layouts. Only the active layout is shown and edited.
  - **Panel Library** - view, rename, export, import and delete panel templates.
- **Magic Wand** (only in Editing Mode):
  - **Add New Panel** creates an empty panel in the active layout.
  - **Add Panel from Template** inserts a new instance of a Panel Library template.
- In Editing Mode:
  - drag the dotted strip at the top of a panel to move it;
  - drag the bottom-right grip to resize it;
  - click the tiny dot in the top-right corner to open that panel's properties
    (name, position, size, lock/unlock, delete, **Save** to the Panel Library - as a new
    template or overwriting one - and **Export** as a template file).
- Locked panels can't be moved or resized until unlocked.

## Layouts, templates and storage

- A **layout** is a complete HUD: its panel instances (geometry, styling, widgets, background
  layers) plus layout-level background layers.
- A **panel template** is a reusable design. Inserting one creates an independent instance;
  editing either never changes the other.
- Both libraries are global (`extensionSettings.prettyPanels`) and shared by every chat.
  Variable bindings, visibility rules and theme overrides are chat-scoped and are never
  stored in, exported with, or imported into a layout or template.
- Exports are JSON files tagged with a format, kind and version; a template file can't be
  imported as a layout or vice versa. Importing never changes the active layout.
- Settings from 0.1 (a single flat set of panels) are migrated into a layout named "Default".

## Code map

| Path | Role |
| --- | --- |
| `src/storage/store.js` | Persisted schema, migration, library-change signal |
| `src/storage/design.js` | The design-field whitelist shared by instances, templates and exports |
| `src/library/layout-library.js` | Layout Library CRUD, export/import |
| `src/library/panel-library.js` | Panel Library CRUD, export/import |
| `src/library/format.js` | Export file envelope and validation |
| `src/panels/panel-registry.js` | Panel instances of the active layout, Enabled/Editing flags |
| `src/panels/panel-manager.js` | Live `Panel` instances; layout switching; template insertion |
| `src/panels/panel.js` | One independent panel element: drag, resize, edit affordance |
| `src/panels/properties-popup.js` | Per-panel properties popup |
| `src/ui/wand-menu.js` | Magic Wand entries (insert only) |
| `src/ui/template-actions.js` | Properties-pane Save to Library / Export |
| `src/ui/settings-drawer.js` + `settings.html` | Extensions-drawer global settings |
| `src/ui/library-drawer.js` | Layout Library and Panel Library drawer sections |
| `src/ui/dialogs.js`, `src/ui/files.js` | Confirm/prompt/list-picker dialogs; JSON download/upload |
| `src/api/*` | Thin State Engine API wrappers (namespace, registration, capabilities) |
