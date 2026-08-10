// Library entry point — import these to build your own runner.
export * from "./schema.js";
export { parsePlaybook, loadPlaybookFile, loadPack } from "./parse.js";
export {
  initState,
  parseTranscript,
  stepRules,
  applyModelAdvice,
  finalize,
  type Utterance,
  type CoachState,
  type CoachCard,
  type ModelAdvice,
} from "./coach.js";
export { adviseWithModel, hasModelKey } from "./llm.js";
export { suggestPack, type PackSuggestion } from "./classify.js";
export {
  toObject,
  toJSON,
  fromObject,
  toMarkdown,
  fromMarkdownDoc,
  SCHEMA_VERSION,
  type PlaybookObject,
  type ImportResult,
} from "./convert.js";
export { lintPlaybook, type Finding } from "./lint.js";
