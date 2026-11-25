/** Flow step 2: classify leading slash commands (`/plan`, `/stop`, …). */
export {
  classifyLeadingCommand,
  parseLeadingCommand,
  isLeadingSlashCommand,
  BUILTIN_META_COMMAND_SPECS,
  MODE_SLASH_COMMANDS,
} from "../../helpers/command-classify";
export type {
  BuiltinMetaCommandSpec,
  ParsedLeadingCommand,
  CommandClassifyResult,
} from "../../helpers/command-classify";
