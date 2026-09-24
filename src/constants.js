// Extension identity, shared by the bootstrap (src/extension.js) and
// every module that calls the State Engine API.

// Must be unique across every extension that talks to the State Engine
// API on this SillyTavern install - it is how the State Engine tells
// your extension's calls apart from anyone else's. Convention: match
// your extension's own folder/repo name.
export const EXTENSION_ID = 'SillyTavern-StateEngine-PrettyPanels';

// Prefixes every variable and preset your extension creates through the
// State Engine (e.g. a variable named "mood" is stored as
// "prettyPanels__mood"). Letters and digits only, starting with a
// letter - see the State Engine API Reference, "Namespace Model".
export const NAMESPACE = 'prettyPanels';
