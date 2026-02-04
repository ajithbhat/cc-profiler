export const SESSION_SCHEMA_VERSION = "2" as const;

export type SessionSchemaVersion = typeof SESSION_SCHEMA_VERSION;

export type Platform = NodeJS.Platform;

export type TurnDetectionMode = "enter" | "hotkey";

export interface UnsafeSessionConfig {
  command?: string[];
  cwd?: string;
  outputDir?: string;
}

export interface SessionConfig {
  commandName: string;
  argsCount: number;
  commandSha256: string;
  cwdSha256: string;
  outputDirSha256: string;
  burstIdleMs: number;
  interactionTimeoutMs: number;
  sampleIntervalMs: number;
  durationMs?: number;
  turnDetection: TurnDetectionMode;
  turnHotkey: "alt+t" | "off";
  disableMcps: boolean;
  correlateJsonl: boolean;
  unsafe?: UnsafeSessionConfig;
}

export interface EnvironmentInfo {
  platform: Platform;
  arch: string;
  nodeVersion: string;
  pid: number;
  startedAtIso: string;
  os: {
    type: string;
    release: string;
    version?: string;
  };
  terminal: {
    term?: string;
    termProgram?: string;
    colorterm?: string;
    parentProcessName?: string;
  };
  machine: {
    cpuModel?: string;
    cpuCores?: number;
    totalMemBytes?: number;
  };
  claude?: ClaudeEnvironmentInfo;
}

export interface ClaudeEnvironmentInfo {
  binaryName?: string;
  binaryPathSha256?: string;
  binaryPath?: string;
  versionText?: string;
  settingsPathSha256?: string;
  settingsPath?: string;
  mcpServers?: string[];
  plugins?: string[];
  effectiveMcpsDisabled?: boolean;
}

export interface CalibrationResult {
  method: "pty-cat";
  t1Ms: number;
  t2Ms: number;
  burstIdleMs: number;
  notes?: string;
}

export interface TurnEvent {
  index: number;
  tMs: number;
  source: TurnDetectionMode;
}

export interface Interaction {
  id: number;
  kind: "keystroke" | "turn";
  t0Ms: number;
  t1Ms?: number;
  t2Ms?: number;
  inputBytes: number;
  outputBytes: number;
  turnIndex?: number;
  endReason: "burstIdle" | "timeout" | "sessionEnd" | "overlap";
}

export interface MarkerEvent {
  tMs: number;
  label?: string;
  labelSha256?: string;
}

export interface ProcessSample {
  tMs: number;
  pid: number;
  rssBytes?: number;
  cpuPercent?: number;
  pageFaultsMinor?: number;
  pageFaultsMajor?: number;
  ctxSwitchesVoluntary?: number;
  ctxSwitchesInvoluntary?: number;
  fdCount?: number;
  threadCount?: number;
  error?: string;
}

export interface SessionData {
  schemaVersion: SessionSchemaVersion;
  createdAtIso: string;
  startedAtIso: string;
  endedAtIso?: string;
  config: SessionConfig;
  environment: EnvironmentInfo;
  calibration?: CalibrationResult;
  jsonl?: JsonlTracking;
  turns: TurnEvent[];
  interactions: Interaction[];
  markers: MarkerEvent[];
  samples: ProcessSample[];
  warnings: string[];
}

export interface JsonlTracking {
  activePathSha256?: string;
  samples: Array<{
    turnIndex: number;
    tMs: number;
    sizeBytes: number;
  }>;
  correlation?: JsonlCorrelation;
}

export interface JsonlCorrelation {
  enabled: boolean;
  mode: "timestamps" | "sequential" | "none";
  parsedLines: number;
  parsedBytes: number;
  parseErrors: number;
  perTurn: Array<{
    turnIndex: number;
    recordCount: number;
    recordBytes: number;
    toolUseCount: number;
    toolUseNames: string[];
    inputTokenCount?: number;
    outputTokenCount?: number;
  }>;
  notes: string[];
}
