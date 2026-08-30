/**
 * Types for the vendored eiscp-commands.json command/value mapping table.
 * See ./eiscp-commands.json and eiscp-commands-convert.ts for the source format.
 */

export interface ValueEntry {
  value: string;
  models: string;
}

export interface IntRange {
  range: string;
  models: string;
}

/**
 * value_mappings[zone][iscpCode]. INTRANGES is a sibling key mixed into the
 * same object as the named value entries (not a separate branch), so the
 * index signature must admit both shapes.
 */
export interface ValueMapping {
  INTRANGES?: IntRange[];
  [humanValueName: string]: ValueEntry | IntRange[] | undefined;
}

export interface ValueDef {
  name?: string | string[];
  description: string;
  models: string;
}

export interface CommandDef {
  name: string | string[];
  aliases?: string[];
  description: string;
  values: Record<string, ValueDef>;
}

export type ZoneCommands = Record<string, CommandDef>;
export type EiscpCommands = Record<string, ZoneCommands>;
export type EiscpCommandMappings = Record<string, Record<string, string>>;
export type EiscpValueMappings = Record<string, Record<string, ValueMapping>>;
export type EiscpModelsets = Record<string, string[]>;

export interface EiscpCommandsFile {
  commands: EiscpCommands;
  modelsets: EiscpModelsets;
  command_mappings: EiscpCommandMappings;
  value_mappings: EiscpValueMappings;
}
