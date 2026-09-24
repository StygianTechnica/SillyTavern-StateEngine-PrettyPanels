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
- Locked panels (and their elements) can't be moved, resized or edited until unlocked; in
  Editing Mode they show a small lock icon, and their properties are read-only except Unlock.

### Layout Tools

A small floating toolbar shown only in Editing Mode (drag it by its title, collapse it with
the chevron). Click panels to select them; Ctrl/Shift+click adds or removes. The first
panel picked is the reference.

- **Show Grid** - a faint grid across the screen and inside panels, at the grid size.
  Purely visual; snapping is unchanged.
- **Align** Left / Center / Right / Top / Middle / Bottom - to the reference panel, or to the
  screen when only one panel is selected.
- **Distribute** Horizontally / Vertically - 3+ panels, equal gaps between the outermost two;
  sizes never change.
- **Create Group / Ungroup / Select Group** - grouped panels move together when one of them
  is dragged (grouped panels show a link icon). Styling and elements stay per panel.
- **Alignment guides** appear while dragging a panel whenever its edges or centre line up with
  another panel's.
- Locked panels are never moved by align, distribute or a group drag.

### Properties pane

Three collapsible sections; which are open is remembered per panel while it's on screen, and
selecting a panel or element expands its section.

- **Panel Properties** - name, position, size, lock/unlock, delete; **Layering** (Z-Index
  0-99, Send to Back, Send Backward, Bring Forward, Bring to Front); **Panel Library** (Save
  as a new template or over an existing one, Export as a template file); **Panel Styling**
  (background colour and Panel opacity, border colour/thickness/radius, drop shadow,
  padding, and margin - the visible panel is inset by the margin inside its stored bounds;
  a background image from a URL or from a State Engine **image variable** (image, image
  list or image map - the variable wins while set, and follows it live), with Cover /
  Contain / Tile / Stretch and its own opacity). Anything left unset follows the
  SillyTavern theme; ↺ resets a colour.
- Layers, bottom to top: background colour, image, border, content. Panel opacity affects
  the colour layer only. At Panel opacity 0 there is no frosted backdrop and the drop shadow
  follows the image's own (transparent) shape; with image opacity 0 (or no image) and border
  0 too, the panel is fully invisible but still shows its elements.
- **Element Properties** - Type, Role, Binding (search, pick or type a variable name),
  Position X/Y and Size W/H (type for live changes, Enter/blur snaps to the grid, ↑/↓ = 1px,
  Shift+↑/↓ = one grid step); for **Text** elements: Show Label, Label override, Format and
  **Element Styling** (font size, weight and family, text/label colour, alignment, a Font
  Awesome icon left of the value with its colour and size, and one conditional colour rule:
  "if value < threshold, colour the value"); for **widgets**: **Widget Properties** (below);
  then a live Preview, and delete. Only the fields that apply to the element's type are shown.
- **Variables** - every State Engine variable, grouped by preset, searchable and filterable
  by preset. Drag one onto a panel to add an element, onto an element to rebind it, or click
  it to add it to this panel.

### Element types

| Type | Draws | Widget Properties |
| --- | --- | --- |
| Text | label, optional icon, formatted value | (Element Styling) |
| Horizontal Bar | a fill inside a track, left to right | track/fill colour, corners, bar height, animate |
| Vertical Bar | the same, bottom to top | track/fill colour, corners, bar width, animate |
| Circular Gauge | an SVG ring, value in the middle | radius (blank = fit), stroke, track/fill colour, show value, animate |
| Semi-Circular Gauge | a 180° SVG arc, value underneath | as Circular Gauge |
| Composite Bar | icon and/or label, then a horizontal bar | label text/colour, icon/colour/size, bar properties |

- Widgets show the bound variable as value / **Max Value** (value clamped to 0..max). Max
  Value left blank uses the variable's own range: its max if it defines one (12 of max 20 =
  60%), otherwise 100, and its min if it defines one. Min/Max are optional per variable in
  State Engine's editor.
- Animate Changes (on by default) eases width/height/arc changes over 200ms.
- Composite Bar: an icon alone shows just the icon; icon and label text show both; with
  neither, the variable's label is shown.
- Switching an element's type resizes it to the new type's default size only if it was still
  at the old type's default size.
- Elements saved before types existed load as Text.

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

- A **layout** is a complete HUD: its panel instances (geometry, z-index, lock, styling,
  elements with their variable bindings, background layers), its panel groups, and
  layout-level background layers.
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
| `src/panels/panel-style.js` | Panel Styling model and CSS variables |
| `src/elements/element-model.js` | VariableElement records, labels, geometry clamping |
| `src/elements/element-view.js` | One element on screen: render, drag, resize, click |
| `src/elements/formats.js` | Value formats per variable type |
| `src/elements/element-style.js` | Element Styling: typography, icon, conditional colour |
| `src/elements/widgets.js` | Bars, gauges and composite bars; Widget Properties |
| `src/chat/pp-config.js` | The PP Configuration preset and `prettyPanels__layoutId` |
| `src/chat/chat-session.js` | Per-chat layout choice, preset activation, live refresh |
| `src/chat/variable-service.js` | Variable catalog and current values |
| `src/ui/variable-picker.js` | Searchable, draggable variable list |
| `src/ui/layout-toolbar.js` | Layout Tools toolbar |
| `src/ui/guides.js` | Alignment guides while dragging |
| `src/ui/wand-menu.js` | Magic Wand entries (insert only) |
| `src/ui/template-actions.js` | Properties-pane Save to Library / Export |
| `src/ui/settings-drawer.js` + `settings.html` | Extensions-drawer global settings |
| `src/ui/library-drawer.js` | Layout Library and Panel Library drawer sections |
| `src/ui/dialogs.js`, `src/ui/files.js` | Confirm/prompt/list-picker dialogs; JSON download/upload |
| `src/api/*` | Thin State Engine API wrappers, one call per file |
