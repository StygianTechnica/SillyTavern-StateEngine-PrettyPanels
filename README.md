# SillyTavern-StateEngine-PrettyPanels

Free-floating, theme-aware HUD panels for SillyTavern that display State Engine variables.
Requires the [State Engine](https://github.com/StygianTechnica/SillyTavern-StateEngine)
extension, in a version with the Variable Value API (`listAllVariables`, `getVariableValues`,
`setVariableValue`, the `state_engine_variables_changed` event) and cross-namespace preset
activation.

## Usage

- **Extensions → Pretty Panels** drawer holds the global controls:
  - **Enable Pretty Panels** - when off, every panel and the wand entries are hidden and
    Editing Mode is turned off. Saved layouts are kept and come back when re-enabled.
  - **Editing Mode** - shows editing chrome and the wand entries. When off, panels are a clean HUD.
  - **Snap to grid** and **grid size** (default 8px) - soft, magnetic snapping for panels
    (layout grid) and elements (each panel's grid).
  - **Layout Library** - choose this chat's layout, or create, duplicate, rename, make default
    (★), export, import and delete layouts.
  - **Panel Library** - view, rename, export, import and delete panel templates.
- **Magic Wand** (only in Editing Mode):
  - **Add New Panel** creates an empty panel in the active layout.
  - **Add Panel from Template** inserts a new instance of a Panel Library template.
- In Editing Mode:
  - drag the dotted strip at the top of a panel to move it, the bottom-right grip to resize it;
  - click the tiny dot in the top-right corner to open that panel's properties;
  - drag an element to move it, its corner grip to resize it, click it to edit it. While one
    element is dragged, the panel's other elements are faintly outlined.
- Locked panels (and their elements) can't be moved or resized until unlocked.

### Properties pane

Three collapsible sections; which are open is remembered per panel while it's on screen, and
selecting a panel or element expands its section.

- **Panel Properties** - name, position, size, lock/unlock, delete; **Layering** (Z-Index
  0-99, Send to Back, Send Backward, Bring Forward, Bring to Front); **Panel Library** (Save
  as a new template or over an existing one, Export as a template file).
- **Element Properties** - Role, Binding (search, pick or type a variable name), Position
  X/Y and Size W/H (type for live changes, Enter/blur snaps to the grid, ↑/↓ = 1px,
  Shift+↑/↓ = one grid step), Show Label, Label override, Format (by variable type), a live
  Preview, and delete.
- **Variables** - every State Engine variable, grouped by preset, searchable and filterable
  by preset. Drag one onto a panel to add an element, onto an element to rebind it, or click
  it to add it to this panel.

## Chats, layouts and State Engine

- Each chat chooses its layout. The choice is stored as the State Engine variable
  `prettyPanels__layoutId` in Pretty Panels' own **PP Configuration** preset (created
  through the State Engine API, hidden from the tracker).
- A chat without PP Configuration (or with no choice in it) shows the **default** layout (★);
  the dropdown then reads "Default (…) - not saved to this chat", and picking any layout -
  including the default one - saves it for the chat. A new chat that continues from a
  previous one inherits its PP Configuration, and so its layout.
- When a layout becomes active in a chat, the presets owning the variables its elements show
  are activated there. Presets are never deactivated when switching away.
- Element values update live from State Engine's `state_engine_variables_changed` event.

## Layouts, templates and storage

- A **layout** is a complete HUD: its panel instances (geometry, z-index, styling, elements
  with their variable bindings, background layers) plus layout-level background layers.
- A **panel template** is a reusable design. It never stores variable bindings - they're
  stripped on save, export and import. Inserting one creates an independent instance; editing
  either never changes the other.
- Both libraries are global (`extensionSettings.prettyPanels`) and shared by every chat.
- Exports are JSON files tagged with a format, kind and version; a template file can't be
  imported as a layout or vice versa. Importing never changes the active layout.
- Settings from 0.1 (a single flat set of panels) are migrated into a layout named "Default".
  Panels saved before z-index existed get one from their creation order.

## Code map

| Path | Role |
| --- | --- |
| `src/constants.js` | Extension ID and namespace |
| `src/storage/store.js` | Persisted schema, migration, library-change signal |
| `src/storage/design.js` | The design-field whitelist; binding stripping for templates |
| `src/library/layout-library.js` | Layout Library CRUD, default layout, export/import |
| `src/library/panel-library.js` | Panel Library CRUD, export/import |
| `src/library/format.js` | Export file envelope and validation |
| `src/panels/panel-registry.js` | Panel instances of the active layout; Enabled/Editing/grid settings |
| `src/panels/panel-manager.js` | Live panels; layout switching; z-order; element add/rebind/edit/drop |
| `src/panels/panel.js` | One panel element: drag, resize, elements, properties |
| `src/panels/properties-popup.js` | Per-panel properties pane |
| `src/panels/snap.js` | Soft snap-to-grid |
| `src/elements/element-model.js` | VariableElement records, labels, geometry clamping |
| `src/elements/element-view.js` | One element on screen: render, drag, resize, click |
| `src/elements/formats.js` | Value formats per variable type |
| `src/chat/pp-config.js` | The PP Configuration preset and `prettyPanels__layoutId` |
| `src/chat/chat-session.js` | Per-chat layout choice, preset activation, live refresh |
| `src/chat/variable-service.js` | Variable catalog and current values |
| `src/ui/variable-picker.js` | Searchable, draggable variable list |
| `src/ui/wand-menu.js` | Magic Wand entries (insert only) |
| `src/ui/template-actions.js` | Properties-pane Save to Library / Export |
| `src/ui/settings-drawer.js` + `settings.html` | Extensions-drawer global settings |
| `src/ui/library-drawer.js` | Layout Library and Panel Library drawer sections |
| `src/ui/dialogs.js`, `src/ui/files.js` | Confirm/prompt/list-picker dialogs; JSON download/upload |
| `src/api/*` | Thin State Engine API wrappers, one call per file |
