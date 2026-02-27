/**
 * Shared types for the Nerve updater.
 */

// ── Exit codes ───────────────────────────────────────────────────────

export const EXIT_CODES = {
  SUCCESS: 0,
  UP_TO_DATE: 1,
  PREFLIGHT: 10,
  VERSION_RESOLUTION: 20,
  BUILD: 40,
  RESTART: 50,
  HEALTH: 60,
  ROLLBACK: 70,
  LOCK: 80,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

// ── CLI options ──────────────────────────────────────────────────────

export interface UpdateOptions {
  version?: string;
  yes: boolean;
  dryRun: boolean;
  verbose: boolean;
  rollback: boolean;
  noRestart: boolean;
  cwd: string;
}

// ── Snapshot ─────────────────────────────────────────────────────────

export interface Snapshot {
  ref: string;
  version: string;
  timestamp: number;
  envHash: string;
}

// ── Version resolution ───────────────────────────────────────────────

export interface ResolvedVersion {
  tag: string;
  version: string;
  current: string;
  isUpToDate: boolean;
  source: 'release' | 'tag' | 'explicit';
}

// ── Preflight ────────────────────────────────────────────────────────

export interface PreflightResult {
  gitVersion: string;
  nodeVersion: string;
  npmVersion: string;
  isGitRepo: boolean;
  hasWritePermission: boolean;
}

// ── Health ───────────────────────────────────────────────────────────

export interface HealthResult {
  healthy: boolean;
  versionMatch: boolean;
  reportedVersion?: string;
  error?: string;
}

// ── Service management ───────────────────────────────────────────────

export interface ServiceManager {
  readonly name: string;
  detect(): boolean;
  restart(): Promise<void>;
  isActive(): Promise<boolean>;
  getLogs(lines: number): Promise<string>;
}

// ── Update result ────────────────────────────────────────────────────

export type UpdateStage =
  | 'lock'
  | 'preflight'
  | 'resolve'
  | 'confirm'
  | 'snapshot'
  | 'update'
  | 'build'
  | 'restart'
  | 'health'
  | 'commit'
  | 'rollback'
  | 'unlock';

export interface UpdateResult {
  success: boolean;
  exitCode: ExitCode;
  stage: UpdateStage;
  fromVersion: string;
  toVersion: string;
  rolledBack: boolean;
  error?: string;
}

// ── Reporter interface ───────────────────────────────────────────────

export interface Reporter {
  stage(name: string, current: number, total: number): void;
  ok(msg: string): void;
  warn(msg: string): void;
  fail(msg: string): void;
  info(msg: string): void;
  dry(msg: string): void;
  verbose(msg: string): void;
  hint(msg: string): void;
  cmd(msg: string): void;
  confirm(msg: string): Promise<boolean>;
  done(fromVersion: string, toVersion: string): void;
  summary(result: UpdateResult): void;
}

// ── Custom errors ────────────────────────────────────────────────────

export class UpdateError extends Error {
  readonly stage: UpdateStage;
  readonly exitCode: ExitCode;

  constructor(message: string, stage: UpdateStage, exitCode: ExitCode) {
    super(message);
    this.name = 'UpdateError';
    this.stage = stage;
    this.exitCode = exitCode;
  }
}
