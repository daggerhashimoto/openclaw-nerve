/**
 * Update orchestrator — the state machine that wires all modules together.
 *
 * Flow: lock → preflight → resolve → confirm → snapshot → update → build
 *       → restart → health → commit/rollback → unlock
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { acquireLock, releaseLock } from './lock.js';
import { runPreflight } from './preflight.js';
import { resolveVersion } from './release-resolver.js';
import { createSnapshot } from './snapshot.js';
import { gitFetchAndCheckout, buildProject } from './installer.js';
import { detectServiceManager } from './service-manager.js';
import { checkHealth } from './health.js';
import { rollback } from './rollback.js';
import { EXIT_CODES, UpdateError } from './types.js';
import type { UpdateOptions, Reporter, ExitCode, ServiceManager } from './types.js';

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/**
 * Run the full update flow. Returns an exit code.
 * All terminal output goes through the reporter.
 */
export async function orchestrate(options: UpdateOptions, reporter: Reporter): Promise<ExitCode> {
  if (options.rollback) {
    return handleManualRollback(options, reporter);
  }

  // Calculate total stages dynamically based on which stages will actually run
  // lock + preflight + resolve + snapshot + update + build = 6
  // + confirm (only if not --yes) + restart + health (only if not --no-restart)
  const totalStages = 6 + (options.yes ? 0 : 1) + (options.noRestart ? 0 : 2);
  let stageNum = 0;
  let locked = false;
  let serviceManager: ServiceManager | null = null;
  let snapshotCreated = false;

  try {
    // ── 1. Lock ────────────────────────────────────────────────────
    stageNum++;
    reporter.stage('Acquiring lock', stageNum, totalStages);
    acquireLock();
    locked = true;
    reporter.ok('Lock acquired');

    // ── 2. Preflight ───────────────────────────────────────────────
    stageNum++;
    reporter.stage('Preflight checks', stageNum, totalStages);
    const preflight = runPreflight(options.cwd);
    reporter.ok(`git ${preflight.gitVersion}`);
    reporter.ok(`Node.js v${preflight.nodeVersion}`);
    reporter.ok(`npm ${preflight.npmVersion}`);

    // ── 3. Resolve version ─────────────────────────────────────────
    stageNum++;
    reporter.stage('Resolving version', stageNum, totalStages);
    const resolved = await resolveVersion(options.cwd, options.version);

    if (resolved.isUpToDate) {
      reporter.ok(`Already up to date (v${resolved.current})`);
      return EXIT_CODES.UP_TO_DATE;
    }

    const sourceLabel =
      resolved.source === 'release'
        ? 'latest release'
        : resolved.source === 'tag'
          ? 'latest tag fallback'
          : 'pinned version';
    reporter.info(`v${resolved.current} → v${resolved.version} (${sourceLabel})`);

    // ── Dry-run stops here ─────────────────────────────────────────
    if (options.dryRun) {
      reporter.dry('Would snapshot current state');
      reporter.dry(`Would checkout ${resolved.tag}`);
      reporter.dry('Would run npm install && build');
      if (!options.noRestart) {
        reporter.dry('Would restart service');
        reporter.dry('Would run health checks');
      }
      return EXIT_CODES.SUCCESS;
    }

    // ── 4. Confirm ─────────────────────────────────────────────────
    if (!options.yes) {
      stageNum++;
      reporter.stage('Confirm', stageNum, totalStages);
      const confirmed = await reporter.confirm(
        `Update v${resolved.current} → v${resolved.version}?`,
      );
      if (!confirmed) {
        reporter.info('Update cancelled');
        return EXIT_CODES.SUCCESS;
      }
      reporter.ok('Confirmed');
    }

    // ── 5. Snapshot ────────────────────────────────────────────────
    stageNum++;
    reporter.stage('Creating snapshot', stageNum, totalStages);
    const snapshot = createSnapshot(options.cwd);
    snapshotCreated = true;
    reporter.ok(`Snapshot saved (ref: ${snapshot.ref.slice(0, 8)})`);

    // ── 6. Update (git checkout) ───────────────────────────────────
    stageNum++;
    reporter.stage('Updating', stageNum, totalStages);
    reporter.verbose(`git fetch --tags origin && git checkout ${resolved.tag}`);
    gitFetchAndCheckout(options.cwd, resolved.tag);
    reporter.ok(`Checked out ${resolved.tag}`);

    // ── 7. Build ───────────────────────────────────────────────────
    stageNum++;
    reporter.stage('Building', stageNum, totalStages);
    reporter.verbose('npm install && npm run build && npm run build:server');
    buildProject(options.cwd);
    reporter.ok('Build complete');

    // ── 8–9. Restart + health (unless --no-restart) ────────────────
    if (!options.noRestart) {
      stageNum++;
      reporter.stage('Restarting service', stageNum, totalStages);
      serviceManager = detectServiceManager();

      if (serviceManager) {
        reporter.verbose(`Detected ${serviceManager.name}`);
        await serviceManager.restart();
        // Give the service a moment to stabilize before checking
        await sleep(2000);
        let active = await serviceManager.isActive();
        if (!active) {
          // Retry once after another short delay (systemd may show "activating")
          await sleep(2000);
          active = await serviceManager.isActive();
        }
        if (!active) {
          throw new UpdateError(
            `Service failed to start via ${serviceManager.name}`,
            'restart',
            EXIT_CODES.RESTART,
          );
        }
        reporter.ok(`Service restarted via ${serviceManager.name}`);
      } else {
        reporter.warn('No service manager detected — skipping restart');
        reporter.hint('Start the server manually:');
        reporter.cmd('npm start');
      }

      stageNum++;
      reporter.stage('Health check', stageNum, totalStages);
      if (serviceManager) {
        reporter.verbose('Polling /health and /api/version...');
        const health = await checkHealth(options.cwd, resolved.version);

        if (!health.healthy || !health.versionMatch) {
          throw new UpdateError(
            health.error ?? 'Health check failed',
            'health',
            EXIT_CODES.HEALTH,
          );
        }

        reporter.ok(`Healthy — v${health.reportedVersion}`);
      } else {
        reporter.warn('Skipped — no running service to verify');
      }
    }

    // ── Success ────────────────────────────────────────────────────
    writeLastRun({ success: true, from: resolved.current, to: resolved.version, exitCode: EXIT_CODES.SUCCESS });
    reporter.done(resolved.current, resolved.version);
    return EXIT_CODES.SUCCESS;
  } catch (err) {
    return handleFailure(err, options, serviceManager, snapshotCreated, reporter);
  } finally {
    if (locked) releaseLock();
  }
}

// ── Failure handler ──────────────────────────────────────────────────

async function handleFailure(
  err: unknown,
  options: UpdateOptions,
  serviceManager: ServiceManager | null,
  snapshotCreated: boolean,
  reporter: Reporter,
): Promise<ExitCode> {
  const isUpdateError = err instanceof UpdateError;
  const stage = isUpdateError ? err.stage : 'unknown';
  const message = err instanceof Error ? err.message : String(err);
  let exitCode: ExitCode = isUpdateError ? err.exitCode : EXIT_CODES.BUILD;

  reporter.fail(`Failed at stage: ${stage}`);
  reporter.fail(message);

  // Attempt rollback if we had a snapshot and the failure was after snapshot
  const rollbackStages = new Set(['update', 'build', 'restart', 'health']);
  if (snapshotCreated && rollbackStages.has(stage)) {
    reporter.info('Attempting rollback...');
    const result = await rollback(options.cwd, serviceManager, reporter);

    if (result.success) {
      reporter.warn(`Rolled back to v${result.snapshot?.version}`);
    } else {
      reporter.fail(`Rollback failed: ${result.error}`);
      exitCode = EXIT_CODES.ROLLBACK;
    }
  }

  writeLastRun({ success: false, stage, error: message, exitCode });

  // Helpful hints based on failure stage
  if (stage === 'build') {
    reporter.hint('Troubleshooting:');
    reporter.cmd('npm install');
    reporter.cmd('npm run build');
    reporter.cmd('npm run build:server');
  } else if (stage === 'restart' || stage === 'health') {
    if (serviceManager) {
      reporter.hint('Check service logs:');
      reporter.cmd(
        serviceManager.name === 'systemd'
          ? 'journalctl -u nerve -n 50 --no-pager'
          : 'log show --predicate \'processImagePath contains "nerve"\' --last 5m',
      );
    }
  }

  return exitCode;
}

// ── Manual rollback ──────────────────────────────────────────────────

async function handleManualRollback(
  options: UpdateOptions,
  reporter: Reporter,
): Promise<ExitCode> {
  let locked = false;

  try {
    reporter.stage('Acquiring lock', 1, 2);
    acquireLock();
    locked = true;
    reporter.ok('Lock acquired');

    reporter.stage('Rolling back', 2, 2);
    const serviceManager = detectServiceManager();
    const result = await rollback(options.cwd, serviceManager, reporter);

    if (result.success) {
      reporter.ok(`Rolled back to v${result.snapshot?.version}`);
      return EXIT_CODES.SUCCESS;
    }

    reporter.fail(result.error ?? 'Rollback failed');
    return EXIT_CODES.ROLLBACK;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    reporter.fail(message);
    if (err instanceof UpdateError) return err.exitCode;
    return EXIT_CODES.ROLLBACK;
  } finally {
    if (locked) releaseLock();
  }
}

// ── Last run persistence ─────────────────────────────────────────────

const STATE_DIR = join(homedir(), '.nerve', 'updater');

function writeLastRun(data: Record<string, unknown>): void {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(
      join(STATE_DIR, 'last-run.json'),
      JSON.stringify({ timestamp: Date.now(), ...data }, null, 2),
      'utf-8',
    );
  } catch {
    // Non-critical — don't let this fail the update
  }
}
