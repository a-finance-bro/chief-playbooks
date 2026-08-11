// Browser entry point for the reference runner.
//
// Only pure logic crosses this boundary: stepping a transcript and ranking packs.
// Nothing here touches the filesystem, so the same code that backs the CLI also
// runs in a static page with no server behind it.

export { initState, parseTranscript, stepRules, finalize } from "./coach.js";
export type { CoachCard, CoachState, Utterance } from "./coach.js";
export { suggestPack } from "./classify.js";
export type { PackSuggestion } from "./classify.js";
