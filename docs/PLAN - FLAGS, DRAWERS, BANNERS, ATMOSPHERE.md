# Plan: Flag-Driven Display - Drawers, Conditional Panels, Banners, Atmosphere

Status (2026-10-09): phase 0 built (`src/chat/flag-watch.js`, `flag-watch-core.js`); phases 1
and 2 built (`src/panels/drawer.js`, the Toggle element, `visibleWhen`). Phases 3-4 not built.

## Principle: Pretty Panels reads flags, State Engine decides them

Pretty Panels never evaluates conditions. Every behaviour below is driven by a **State Engine
boolean variable** (or a role that resolves to one) - a "flag". The logic lives where it already
works: a calculated boolean (`weather.contains("Rain")`, `hp < 20`), a prompted boolean, a
flag-mode boolean, or one set by another extension.

- No new State Engine API, and no condition language in Pretty Panels.
- No new LLM calls: flags come from the values the existing update already produces.
- Behaviours combine freely. Two flags true at once means two behaviours at once - rain and
  embers together ("snowing in hell") is just two effect layers both switched on.

Recommended pattern for authors (to put in the README): store weather as an **array of enum**
(`["Snow", "Embers"]`) - one prompt line, any combination - and derive calculated booleans from
it (`isSnowing = weather.contains("Snow")`). A single enum would make conditions mutually
exclusive.

**Default State Engine preset (later):** State Engine will ship the user's **Scene Context**
preset as its default, extended with the pieces
Pretty Panels' features expect - the weather array, its calculated flags, scene variables, and
whatever the default layout binds. Then users mostly just hook flags in, without building
State Engine configuration themselves. Pretty Panels still works with any boolean; the preset
only saves the setup.

## Shared foundation: the flag watcher

`src/chat/flag-watch.js` (new): every behaviour registers the flag refs it needs. When values
change (variable-service's existing refresh after State Engine's change signal), the watcher
compares each flag's previous and current value and reports:

- **state**: the flag is true / false now (for "visible while true")
- **rise**: the flag went false -> true (for one-shot behaviours like banners)

Rules:
- **Chat load / switch is not a rise.** The first values read for a chat set the baseline
  silently. Otherwise every banner whose flag is already true would fire whenever a chat
  opens.
- Only a real boolean `true` counts as true (`"true"`, 1 and so on don't).
- A missing variable (preset not active, role not assigned) counts as false.
- A rise is reported once per change; the same burst of writes (one update) reports it once.

**Change trigger** (decided: A = yes): besides flags, a banner can fire when **any variable
changes** ("old != new", any type) - for example a banner that follows the location without a
"scene changed" flag (which would cost a prompted boolean, an extra prompt line). The same
rules apply: chat load is not a change, and one update's burst reports once. Its risk, noted for
the README: a variable rewritten every update (a scene title) fires every update - follow a
steadier one (the location), and use the minimum gap.

## Phase 1 - Drawers (compact area) for every panel

Any panel - layout panels, character card templates, any kind of content - can have a
**compact area**: a rectangle anywhere inside the design. Collapsed, the panel shows only that
area. Expanded, it shows the whole design **as an overlay**: it grows over its neighbours and is
raised above them, so nothing reflows.

**Direction: the compact area stays put; the rest unfolds around it.** Where the compact area
sits in the design decides which way the drawer opens:
- compact area at the **top** of the design -> opens **downward**;
- at the **bottom** -> opens **upward** (a panel at the bottom of the screen);
- at the **left** / **right** -> opens to the right / left;
- in a corner -> opens both ways from that corner.

So a bottom-of-screen panel is designed with its details above and its compact strip at the
bottom. **Keep on screen** (on by default): if the expanded panel would go past a screen edge,
it is shifted back inside rather than cut off.

- **Toggle element** (new element type, Add palette): a chevron or tab the author places
  anywhere. Clicking it opens or closes the drawer, outside Editing Mode. Its look: icon
  (default chevron, which flips when open), colour, size; optionally an image.
- **Open / closed is per session** (decided: B): kept in memory per chat - per panel, and per
  card per character - and back to the design's default (collapsed) on page refresh. Nothing
  is saved.
- **Character cards**: the tiling lays cards out at their compact size. An expanded card
  overlays the cards next to it. This makes "a band of portraits" possible: compact area = the
  portrait strip.
- **Editing**: in Editing Mode the full design always shows, with the compact area outlined
  (dashed) so it can be moved and resized on the canvas. Properties set it too: "Compact area:
  off / x, y, width, height", and "Keep on screen".
- **Optional flag**: "Open while <flag> is true" - for example, a status drawer that opens on
  its own in combat.

Data: panel / template record gains `compact: { x, y, width, height, keepOnScreen } | null`. A Toggle element is
`{ type: 'toggle', icon?, color?, size? }`. Open state lives outside the design (it isn't part
of the template).

## Phase 2 - Element visibility by flag

Every element gets **Visible: always | while <flag> is true | while <flag> is false**.

- Hidden elements take no clicks. In Editing Mode they show faded with an eye-slash badge, so
  they can still be edited.
- Use cases: ⚠ icon while `isWounded`, a "present" ribbon on a card, a rain icon on the scene
  panel while `isRaining`.

Data: element gains `visibleWhen: { flag: <ref>, invert?: boolean } | null`. The ref uses the
same binding refs as variables and roles (`role:...` works).

## Phase 3 - Conditional panels and banners

A layout panel gets **Display: always | while <flag> is true | when <flag> becomes true
(timed)**, plus an animation:

- **In / out**: none, fade, slide (from top / bottom / left / right), zoom. Durations.
- **Hold** (timed mode): seconds on screen, then animate out - even if the flag stays true.
- **Placement**: a "Full width" option (stretched across the screen at its y position) for the
  cinematic band, alongside the existing free and anchored placements.
- **Queue**: timed panels that fire together play one after another, never on top of each
  other. A minimum gap between plays stops a flickering flag from spamming.
- **Replay**: a wand menu item and a slash command (`/pp-banner <name>`) play a banner on demand,
  which also helps when designing it.

**Editing hidden panels** - the layout gets a **Layout Panels** list (drawer section, and
reachable from the wand menu): every panel in the layout with its display mode. From it:
- **Show for editing** pins one conditional panel visible in Editing Mode, so a full-screen
  banner is edited on its own instead of covering the rest of the layout.
- **Preview** plays its animation once.
- **Select** opens its properties.

In Editing Mode, conditional panels are hidden unless pinned; a pinned one shows a badge naming
its flag.

Data: panel record gains `display: { mode: 'always' | 'while' | 'rise', flag, invert?, holdMs?,
in: { kind, ms }, out: { kind, ms }, fullWidth? }` and `trigger: { kind: 'flag' |
'change', ref }`.

## Phase 4 - Atmosphere

A full-screen canvas **behind the chat text** (above SillyTavern's background, below the chat
column). It ignores the mouse and runs lightweight particle effects.

- **Effect layers**, any number, each `{ effect, flag, intensity }`. Effects: rain, drizzle,
  storm (rain + lightning flashes), snow, hail, fog, embers, falling leaves, dust. Every layer
  whose flag is true runs; layers mix.
- **Intensity**: a number 0-100 per layer, or optionally bound to a number variable.
- **Where it is configured**: per layout (decided: C - layers bind to variables, which only
  exist in a layout's context), in a new "Atmosphere" section of the layout panel list above.
- **Guards**: master on/off and an intensity scale in Pretty Panels' settings; pause while the
  tab is hidden; honour "reduce motion" (static tint instead of particles); a particle cap; one
  shared animation loop for all layers.

Data: layout gains `atmosphere: [{ effect, flag, intensity | intensityRef }]`.

## Order and size

| Phase | What | Size |
|---|---|---|
| 0 | Flag watcher + change trigger, vitest for Pretty Panels | small |
| 1 | Compact area + Toggle element, panels and cards | medium-large (card tiling, overlay expansion) |
| 2 | Element visibility by flag | small |
| 3 | Conditional panels, banners, Layout Panels list | medium |
| 4 | Atmosphere canvas and effects | medium (mostly tuning) |

Phase 2 is small and could ride along with Phase 1.

## Testing

Pretty Panels has no test suite yet. The flag watcher (baseline on chat load, rise detection,
missing = false), the banner queue and the compact-area geometry are pure logic worth unit
tests: Phase 0 adds vitest (as State Engine uses) with those tests. Visual behaviour is checked
in the browser pane against a test page and in SillyTavern.

## Decisions (2026-10-09)

- **A**: banners can also fire on "variable changed" (any type).
- **B**: drawer open / closed is per chat, per session - it resets on page refresh.
- **C**: atmosphere is configured per layout.
- Drawers overlay their neighbours; their direction follows where the compact area sits.
- Banners use the full panel designer; hidden and conditional panels are reached through the
  Layout Panels list.
- Effects are drawn behind the chat text (revisit if readability suffers).
- Atmosphere stays in Pretty Panels.
