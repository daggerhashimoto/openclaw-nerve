/* @vitest-environment node */
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseDotenv } from 'dotenv';
import { afterAll, describe, it } from 'vitest';

/**
 * End-to-end tests for install.sh (issue #366).
 *
 * Each test pipes the installer into bash, the way `curl ... | bash` does,
 * inside a throwaway HOME. PATH holds only stubs plus a short allowlist of real
 * shell tools, so no test touches the host's systemd, sudo, package manager,
 * git remote or network. The stubs log every call they receive to calls.log.
 *
 * The installer keeps its two systemd host paths in constants; the tests point
 * them into the throwaway directory, so the result never depends on whether the
 * host runs systemd or already has a nerve.service unit.
 */

const INSTALLER = fileURLToPath(new URL('../install.sh', import.meta.url));
const HOST_UNIT_FILE = '/etc/systemd/system/nerve.service';
const HOST_SYSTEMD_RUN_DIR = '/run/systemd/system';
const UNIT_FILE_LINE = `SYSTEMD_UNIT_FILE="${HOST_UNIT_FILE}"`;
const RUN_DIR_LINE = `SYSTEMD_RUN_DIR="${HOST_SYSTEMD_RUN_DIR}"`;
const NERVE_HEALTH_URL = 'http://127.0.0.1:3080/health';
const USERNAME = os.userInfo().username;
const UID = os.userInfo().uid;
const SUITE_STARTED_AT = Date.now();
const RUN_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = RUN_TIMEOUT_MS + 15_000;
const SUCCESS_BANNER = 'Open Nerve in your browser';

const REAL_TOOLS = [
  'awk', 'bash', 'cat', 'chmod', 'cp', 'cut', 'dirname', 'env', 'false', 'grep', 'head',
  'hostname', 'id', 'install', 'mkdir', 'mktemp', 'mv', 'rm', 'sed', 'seq', 'sh', 'tail',
  'tr', 'true', 'tty', 'which',
];
const TOOL_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

interface Scenario {
  platform?: 'Linux' | 'Darwin';
  /** running: systemctl exists and systemd is PID 1. not-running: only the binary exists. */
  systemd?: 'running' | 'not-running' | 'absent';
  existingUnit?: boolean;
  sudo?: 'nopasswd' | 'denied';
  apt?: 'ok' | 'fail';
  ffmpeg?: boolean;
  speechModel?: 'cached' | 'download-fails';
  npmCi?: 'ok' | 'fail';
  build?: 'ok' | 'fail';
  serviceStart?: 'ok' | 'fail';
  launchd?: 'ok' | 'fail';
  nerveHealth?: 'up' | 'down';
  /** Seconds Nerve's /health takes to answer (it waits on its own gateway probe). */
  healthDelaySeconds?: number;
  /** Contents of an .env that already exists in the install directory. */
  env?: string;
  /** Installer flags added after --branch and --dir. */
  args?: string[];
  /** Put spaces in HOME, the install directory and the unit file path. */
  spacedPaths?: boolean;
  /** false: OpenClaw has no gateway token, so the installer cannot write .env. */
  gatewayToken?: boolean;
}

interface InstallRun {
  code: number | null;
  output: string;
  calls: string[];
  home: string;
  installDir: string;
  unitFile: string;
  installedUnit: string | null;
}

const STUBS: Record<string, string> = {
  uname: 'echo "$STUB_PLATFORM"',
  openclaw: 'echo "OpenClaw 2026.6.11 (test)"',
  ss: 'exit 0',
  make: 'exit 0',
  'g++': 'exit 0',
  // The installer polls once a second; real waits would only slow the suite down.
  sleep: 'exec "$STUB_REAL_SLEEP" 0.05',
  git: `echo "git $*" >> "$STUB_CALLS"
case "$1" in
  --version) echo "git version 2.43.0" ;;
  clone) for last in "$@"; do :; done; mkdir -p "$last" ;;
esac`,
  npm: `echo "npm $*" >> "$STUB_CALLS"
case "$1" in
  -v) echo "10.9.0" ;;
  ci) if [ "$STUB_NPM_CI" = fail ]; then echo "npm ERR! code E404"; exit 1; fi ;;
  run) if [ "$2" = build ] && [ "$STUB_BUILD" = fail ]; then echo "error TS2304: Cannot find name 'x'."; exit 2; fi ;;
esac`,
  curl: `out=""; url=""; max_time=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    --max-time) max_time="$2"; shift ;;
    http*) url="$1" ;;
  esac
  shift
done
echo "curl $url" >> "$STUB_CALLS"
case "$url" in
  *:18789/*) exit 0 ;;
  *huggingface.co*)
    if [ "$STUB_SPEECH_MODEL" = download-fails ]; then printf partial > "$out"; exit 18; fi ;;
  */health)
    [ "$STUB_NERVE_HEALTH" = up ] || exit 7
    # A --max-time shorter than the time /health takes to answer is a curl timeout.
    if [ -n "$max_time" ] && [ "$max_time" -lt "$STUB_HEALTH_DELAY" ]; then exit 28; fi
    exit 0 ;;
esac
exit 7`,
  sudo: `echo "sudo $*" >> "$STUB_CALLS"
if [ "$STUB_SUDO" != nopasswd ]; then echo "sudo: a password is required" >&2; exit 1; fi
while [ $# -gt 0 ]; do
  case "$1" in
    -v) exit 0 ;;
    -n) shift ;;
    *) break ;;
  esac
done
exec env "$@"`,
  systemctl: `echo "systemctl $*" >> "$STUB_CALLS"
if [ "$1" = restart ] && [ "$STUB_SERVICE_START" = fail ]; then echo "Job for nerve.service failed." >&2; exit 1; fi`,
  launchctl: `echo "launchctl $*" >> "$STUB_CALLS"
case "$1" in
  bootstrap|load) if [ "$STUB_LAUNCHD" = fail ]; then echo "Load failed: 5: Input/output error" >&2; exit 5; fi ;;
esac`,
  'apt-get': `echo "apt-get $*" >> "$STUB_CALLS"
if [ "$STUB_APT" = fail ]; then echo "E: Unable to locate package" >&2; exit 100; fi`,
  ffmpeg: 'exit 0',
};

/** Stubs a scenario can leave off PATH; each lives in its own directory. */
const OPTIONAL_STUBS = ['systemctl', 'launchctl', 'apt-get', 'ffmpeg'] as const;
type OptionalStub = (typeof OPTIONAL_STUBS)[number];

interface Toolbox {
  common: string;
  optional: Record<OptionalStub, string>;
  sysbin: string;
}

const tempRoots: string[] = [];
let sharedToolbox: Toolbox | undefined;

/**
 * Stub and tool directories shared by every test. The stubs take their
 * behaviour from STUB_* variables, so one copy serves all scenarios. Writing
 * them once also matters on macOS, which checks every new executable on its
 * first run and would otherwise add seconds to each test.
 */
function toolbox(): Toolbox {
  if (sharedToolbox) return sharedToolbox;
  const root = mkdtempSync(path.join(os.tmpdir(), 'nerve-install-sh-tools-'));
  tempRoots.push(root);
  const common = path.join(root, 'common');
  const sysbin = path.join(root, 'sysbin');
  const optional = Object.fromEntries(
    OPTIONAL_STUBS.map((name) => [name, path.join(root, `only-${name}`)]),
  ) as Record<OptionalStub, string>;
  for (const dir of [common, sysbin, ...Object.values(optional)]) mkdirSync(dir);

  for (const [name, body] of Object.entries(STUBS)) {
    const dir = (OPTIONAL_STUBS as readonly string[]).includes(name) ? optional[name as OptionalStub] : common;
    writeStub(dir, name, body);
  }
  symlinkSync(process.execPath, path.join(common, 'node'));
  for (const tool of REAL_TOOLS) symlinkSync(findTool(tool), path.join(sysbin, tool));

  sharedToolbox = { common, optional, sysbin };
  return sharedToolbox;
}

function findTool(name: string): string {
  for (const dir of TOOL_DIRS) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Required tool not found on this machine: ${name}`);
}

function writeStub(dir: string, name: string, body: string): void {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/bin/bash\n${body}\n`);
  chmodSync(file, 0o755);
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*m/g, '');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** install.sh with its systemd host paths pointed into the test's own directory. */
function installerScript(unitFile: string, systemdRunDir: string): string {
  const source = readFileSync(INSTALLER, 'utf8');
  for (const line of [UNIT_FILE_LINE, RUN_DIR_LINE]) {
    if (source.split(line).length !== 2) {
      throw new Error(`install.sh must define exactly one line: ${line}`);
    }
  }
  const script = source
    .replace(UNIT_FILE_LINE, () => `SYSTEMD_UNIT_FILE="${unitFile}"`)
    .replace(RUN_DIR_LINE, () => `SYSTEMD_RUN_DIR="${systemdRunDir}"`);
  // Any other literal use of these paths would reach the real host.
  for (const hostPath of [HOST_UNIT_FILE, HOST_SYSTEMD_RUN_DIR]) {
    if (script.includes(hostPath)) {
      throw new Error(`install.sh uses ${hostPath} outside its constant`);
    }
  }
  return script;
}

async function install(scenario: Scenario = {}): Promise<InstallRun> {
  const s = {
    platform: 'Linux',
    systemd: 'running',
    existingUnit: false,
    sudo: 'nopasswd',
    apt: 'ok',
    ffmpeg: true,
    speechModel: 'cached',
    npmCi: 'ok',
    build: 'ok',
    serviceStart: 'ok',
    launchd: 'ok',
    nerveHealth: 'up',
    healthDelaySeconds: 0,
    env: undefined,
    args: [],
    spacedPaths: false,
    gatewayToken: true,
    ...scenario,
  } satisfies Scenario;

  const tools = toolbox();
  const root = mkdtempSync(path.join(os.tmpdir(), s.spacedPaths ? 'nerve install sh ' : 'nerve-install-sh-'));
  tempRoots.push(root);
  const home = path.join(root, 'home');
  const installDir = path.join(root, s.spacedPaths ? 'My Nerve' : 'nerve');
  const callsFile = path.join(root, 'calls.log');
  const unitFile = path.join(root, 'etc-systemd-system', 'nerve.service');
  const systemdRunDir = path.join(root, 'run-systemd-system');

  mkdirSync(path.join(home, '.openclaw'), { recursive: true });
  mkdirSync(path.join(home, '.nerve', 'models'), { recursive: true });
  mkdirSync(path.dirname(unitFile));
  writeFileSync(callsFile, '');
  writeFileSync(
    path.join(home, '.openclaw', 'openclaw.json'),
    JSON.stringify({ gateway: { port: 18789, auth: s.gatewayToken ? { token: 'test-token' } : {} } }),
  );
  if (s.speechModel === 'cached') {
    writeFileSync(path.join(home, '.nerve', 'models', 'ggml-base.bin'), 'model');
  }
  if (s.systemd === 'running') mkdirSync(systemdRunDir);
  if (s.existingUnit) writeFileSync(unitFile, '[Service]\nExecStart=/old/node\n');
  if (s.env !== undefined) {
    mkdirSync(installDir);
    writeFileSync(path.join(installDir, '.env'), s.env);
  }

  const present = new Set<OptionalStub>();
  if (s.platform === 'Darwin') {
    present.add('launchctl');
  } else {
    present.add('apt-get');
    if (s.systemd !== 'absent') present.add('systemctl');
  }
  if (s.ffmpeg) present.add('ffmpeg');
  const pathDirs = [tools.common, ...OPTIONAL_STUBS.filter((name) => present.has(name)).map((name) => tools.optional[name]), tools.sysbin];

  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USER: USERNAME,
    LOGNAME: USERNAME,
    PATH: pathDirs.join(':'),
    STUB_CALLS: callsFile,
    STUB_REAL_SLEEP: findTool('sleep'),
    STUB_PLATFORM: s.platform,
    STUB_SUDO: s.sudo,
    STUB_APT: s.apt,
    STUB_SPEECH_MODEL: s.speechModel,
    STUB_NPM_CI: s.npmCi,
    STUB_BUILD: s.build,
    STUB_SERVICE_START: s.serviceStart,
    STUB_LAUNCHD: s.launchd,
    STUB_NERVE_HEALTH: s.nerveHealth,
    STUB_HEALTH_DELAY: String(s.healthDelaySeconds),
  };

  const script = installerScript(unitFile, systemdRunDir);
  const { code, output } = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    // detached: true starts a new session, so the installer has no controlling
    // terminal and runs non-interactively even when the tests run in one. It
    // also makes the installer a process group leader, so a timeout can stop
    // its background jobs too.
    const child = spawn(
      path.join(tools.sysbin, 'bash'),
      ['-c', 'exec bash -s -- "$@" 2>&1', 'install.sh', '--branch', 'master', '--dir', installDir, ...s.args],
      { env, detached: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const timer = setTimeout(() => {
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        // already exited
      }
    }, RUN_TIMEOUT_MS);
    let text = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      text += chunk;
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ code: exitCode, output: stripAnsi(text) });
    });
    child.stdin.end(script);
  });

  return {
    code,
    output,
    calls: readFileSync(callsFile, 'utf8').split('\n').filter(Boolean),
    home,
    installDir,
    unitFile,
    installedUnit: existsSync(unitFile) ? readFileSync(unitFile, 'utf8') : null,
  };
}

const systemctlCalls = (run: InstallRun) => run.calls.filter((call) => call.startsWith('systemctl '));
const healthChecks = (run: InstallRun, url = NERVE_HEALTH_URL) => run.calls.filter((call) => call === `curl ${url}`);

/** The commands printed under "Start it with:". */
function printedSteps(run: InstallRun): string[] {
  const lines = run.output.split('\n');
  const start = lines.findIndex((line) => line.trim() === 'Start it with:');
  if (start === -1) throw new Error('No "Start it with:" section in the installer output');
  const steps: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) break;
    steps.push(line.trim());
  }
  return steps;
}

/** The single printed line that starts with `prefix`, without the rail and surrounding space. */
function printedLine(run: InstallRun, prefix: string): string {
  const matches = run.output
    .split('\n')
    .map((line) => line.trim().replace(/^│\s+/, ''))
    .filter((line) => line.startsWith(prefix));
  if (matches.length !== 1) throw new Error(`Expected one printed line starting with ${prefix}, found ${matches.length}`);
  return matches[0];
}

/**
 * Runs a command the installer printed for the user to copy, as bash would
 * after a paste. `prelude` defines shell functions that stand in for commands
 * such as sudo or npm. Throws when bash rejects or fails the command.
 */
function runPrinted(command: string, prelude: string): string {
  const result = spawnSync(path.join(toolbox().sysbin, 'bash'), ['-c', `${prelude}\n${command}`], {
    encoding: 'utf8',
    env: { PATH: toolbox().sysbin },
  });
  if (result.status !== 0) {
    throw new Error(`Printed command failed (${result.status}): ${command}\n${result.stderr}`);
  }
  return result.stdout;
}

/**
 * Runs one of install.sh's .env helpers (env_file_value KEY, or nerve_port)
 * against an .env with `content`, using the helper definitions from the script.
 */
function runInstallerHelper(content: string | null, ...command: string[]): string {
  const source = readFileSync(INSTALLER, 'utf8');
  // env_file_value ends with its node heredoc, so its closing brace follows EOF.
  const envFileValue = /^env_file_value\(\) \{\n[\s\S]*?\nEOF\n\}\n/m.exec(source)?.[0];
  const nervePort = /^nerve_port\(\) \{\n[\s\S]*?\n\}\n/m.exec(source)?.[0];
  if (!envFileValue || !nervePort) throw new Error('install.sh lacks env_file_value() or nerve_port()');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'nerve-install-sh-env-'));
  tempRoots.push(dir);
  if (content !== null) writeFileSync(path.join(dir, '.env'), content);
  const tools = toolbox();
  const result = spawnSync(
    path.join(tools.sysbin, 'bash'),
    ['-c', `set -euo pipefail\n${envFileValue}\n${nervePort}\n"$@"`, 'install-helpers', ...command],
    { encoding: 'utf8', env: { PATH: `${tools.common}:${tools.sysbin}`, INSTALL_DIR: dir } },
  );
  if (result.status !== 0) throw new Error(`${command.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

const installerEnvValue = (content: string | null, key: string) => runInstallerHelper(content, 'env_file_value', key);

afterAll(() => {
  if (process.env.KEEP_ROOTS) { console.log("ROOTS", tempRoots.join(" ")); return; }
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  // Failed npm/build steps intentionally leave their logs in /tmp for the user.
  for (const name of readdirSync('/tmp')) {
    if (!/^nerve-(npm-install|build)-|^nerve\.service\./.test(name)) continue;
    const file = path.join('/tmp', name);
    try {
      if (statSync(file).mtimeMs >= SUITE_STARTED_AT) rmSync(file, { force: true });
    } catch {
      // already gone
    }
  }
});

const isRoot = process.getuid?.() === 0;

describe.skipIf(isRoot).concurrent('install.sh', () => {
  describe('systemd service on Linux as a non-root user', () => {
    it('installs, enables and starts nerve.service through sudo, and says it uses sudo', async ({ expect }) => {
      const run = await install();

      expect(run.code).toBe(0);
      expect(run.calls).toContainEqual(
        expect.stringMatching(new RegExp(`^sudo -n install -m 0644 \\S+ ${escapeRegExp(run.unitFile)}$`)),
      );
      expect(systemctlCalls(run)).toEqual([
        'systemctl daemon-reload',
        'systemctl enable nerve.service',
        'systemctl restart nerve.service',
      ]);
      expect(run.installedUnit).toContain(`User=${USERNAME}`);
      expect(run.installedUnit).toContain(`WorkingDirectory=${run.installDir}`);
      // .env is left to the server's dotenv; systemd parses EnvironmentFile= differently.
      expect(run.installedUnit).not.toContain('EnvironmentFile=');
      expect(run.output).toContain(`Using sudo to install ${run.unitFile}`);
      expect(healthChecks(run)).toHaveLength(1);
      expect(run.output).toContain(SUCCESS_BANNER);
      expect(run.output).toContain('http://localhost:3080');
    }, TEST_TIMEOUT_MS);

    it('gives /health long enough to answer while Nerve waits on a slow gateway probe', async ({ expect }) => {
      const run = await install({ healthDelaySeconds: 3 });

      expect(run.code).toBe(0);
      expect(run.output).toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('reports Nerve as not responding and exits 2 when /health never answers', async ({ expect }) => {
      const run = await install({ nerveHealth: 'down' });

      expect(run.code).toBe(2);
      expect(healthChecks(run).length).toBeGreaterThan(1);
      expect(run.output).toContain(`Nerve was started but did not respond at ${NERVE_HEALTH_URL}`);
      expect(run.output).toContain('sudo journalctl -u nerve.service -n 50 --no-pager');
      expect(run.output).toContain('sudo systemctl restart nerve.service');
      expect(run.output).not.toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('reports a service that fails to start and exits 2 instead of claiming success', async ({ expect }) => {
      const run = await install({ serviceStart: 'fail' });

      expect(run.code).toBe(2);
      expect(systemctlCalls(run)).toContain('systemctl restart nerve.service');
      expect(healthChecks(run)).toEqual([]);
      expect(run.output).toContain('Job for nerve.service failed.');
      expect(run.output).toContain('The Nerve service failed to start.');
      expect(run.output).toContain('sudo journalctl -u nerve.service -n 50 --no-pager');
      expect(run.output).toContain('sudo systemctl restart nerve.service');
      expect(run.output).not.toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('keeps the unit, prints the exact commands and exits 2 when root access is unavailable', async ({ expect }) => {
      const run = await install({ sudo: 'denied' });
      const savedUnit = path.join(run.home, '.nerve', 'nerve.service');

      expect(run.code).toBe(2);
      expect(systemctlCalls(run)).toEqual([]);
      expect(run.installedUnit).toBeNull();
      expect(readFileSync(savedUnit, 'utf8')).toContain(`User=${USERNAME}`);
      expect(run.output).toContain(`sudo install -m 0644 ${savedUnit} ${run.unitFile}`);
      expect(run.output).toContain('sudo systemctl daemon-reload');
      expect(run.output).toContain('sudo systemctl enable nerve.service');
      expect(run.output).toContain('sudo systemctl restart nerve.service');
      expect(run.output).toContain('Nerve is installed but not running yet.');
      expect(run.output).not.toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('restarts an existing unit in place instead of stopping it first', async ({ expect }) => {
      const run = await install({ existingUnit: true });

      expect(run.code).toBe(0);
      expect(run.output).toContain('Updating existing systemd service');
      expect(systemctlCalls(run)).toEqual([
        'systemctl daemon-reload',
        'systemctl enable nerve.service',
        'systemctl restart nerve.service',
      ]);
      expect(run.installedUnit).toContain(`WorkingDirectory=${run.installDir}`);
      expect(run.output).toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('leaves a running service alone and says it was not restarted when an update lacks root', async ({ expect }) => {
      const run = await install({ existingUnit: true, sudo: 'denied' });

      expect(run.code).toBe(2);
      expect(systemctlCalls(run)).toEqual([]);
      expect(run.installedUnit).toBe('[Service]\nExecStart=/old/node\n');
      expect(run.output).toContain('Nerve was updated, but nerve.service was not restarted.');
      expect(run.output).toContain('sudo systemctl restart nerve.service');
      expect(run.output).not.toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('probes the PORT and HOST of an existing .env the way the server reads them', async ({ expect }) => {
      const run = await install({
        env: [
          'GATEWAY_URL=http://127.0.0.1:18789',
          'GATEWAY_TOKEN=test-token',
          'PORT=1111',
          'export PORT = 4123 # local port',
          'HOST = "::"   # every interface',
          '',
        ].join('\r\n'),
      });

      expect(run.code).toBe(0);
      expect(healthChecks(run, 'http://[::1]:4123/health')).toHaveLength(1);
      expect(run.output).toContain('http://localhost:4123');
      expect(run.output).toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('reads .env values exactly like dotenv, which the server and updater use', ({ expect }) => {
      const cases: Array<{ name: string; content: string | null; key: string }> = [
        { name: 'plain value', content: 'PORT=4123\n', key: 'PORT' },
        { name: 'inline comment after an unquoted value', content: 'PORT=4123 # local port\n', key: 'PORT' },
        { name: 'spaces around =', content: 'PORT = 4123\n', key: 'PORT' },
        { name: 'tabs and trailing spaces', content: 'PORT=\t4123  \n', key: 'PORT' },
        { name: 'export prefix', content: 'export PORT=4123\n', key: 'PORT' },
        { name: 'double quotes keep a #', content: 'HOST="a#b" # comment\n', key: 'HOST' },
        { name: 'single quotes keep a # and spaces', content: "HOST='a # b'\n", key: 'HOST' },
        { name: 'backticks', content: 'HOST=`::`\n', key: 'HOST' },
        { name: 'CRLF line endings', content: 'PORT=4123\r\nHOST=::\r\n', key: 'PORT' },
        { name: 'CRLF on the last line', content: 'PORT=4123\r\nHOST=::\r\n', key: 'HOST' },
        { name: 'last assignment wins', content: 'PORT=1111\nPORT=4123\n', key: 'PORT' },
        { name: 'commented-out assignment', content: '# PORT=1111\nPORT=4123\n', key: 'PORT' },
        { name: 'similar key names', content: 'PORTS=1\nMY_PORT=2\nPORT=4123\nPORT_X=3\n', key: 'PORT' },
        { name: 'empty value', content: 'PORT=\n', key: 'PORT' },
        { name: 'missing key', content: 'HOST=::\n', key: 'PORT' },
        { name: 'no .env file', content: null, key: 'PORT' },
      ];

      const actual = cases.map(({ name, content, key }) => ({ name, value: installerEnvValue(content, key) }));
      const expected = cases.map(({ name, content, key }) => ({
        name,
        value: content === null ? '' : (parseDotenv(content)[key] ?? ''),
      }));
      expect(actual).toEqual(expected);
    }, TEST_TIMEOUT_MS);

    it('leaves .env to the server, so the service and the probe agree on the port', async ({ expect }) => {
      // systemd's EnvironmentFile= would reject `export PORT=4123` and keep PORT=1111,
      // and dotenv never overrides a variable systemd already set.
      const run = await install({
        env: 'GATEWAY_URL=http://127.0.0.1:18789\nGATEWAY_TOKEN=test-token\nPORT=1111\nexport PORT=4123\n',
      });

      expect(run.code).toBe(0);
      expect(run.installedUnit).not.toContain('EnvironmentFile=');
      // dotenv resolves .env from the working directory.
      expect(run.installedUnit).toContain(`WorkingDirectory=${run.installDir}\n`);
      expect(healthChecks(run, 'http://127.0.0.1:4123/health')).toHaveLength(1);
      expect(healthChecks(run, 'http://127.0.0.1:1111/health')).toEqual([]);
    }, TEST_TIMEOUT_MS);

    it('converts PORT to a number the way the server does', ({ expect }) => {
      // server/lib/config.ts: Number(process.env.PORT || DEFAULT_PORT), then listen().
      // '' means the server could not be reached: listen() rejects the value, or 0
      // picks a random port.
      const cases: Array<{ content: string | null; port: string }> = [
        { content: 'PORT=4123\n', port: '4123' },
        { content: 'PORT=+4123\n', port: '4123' },
        { content: 'PORT=" 4123 "\n', port: '4123' },
        { content: 'PORT=4123.0\n', port: '4123' },
        { content: 'PORT=0x1F90\n', port: '8080' },
        { content: 'PORT=1e3\n', port: '1000' },
        { content: 'PORT=\n', port: '3080' },
        { content: 'HOST=::\n', port: '3080' },
        { content: null, port: '3080' },
        { content: 'PORT=0\n', port: '' },
        { content: 'PORT=abc\n', port: '' },
        { content: 'PORT=4123abc\n', port: '' },
        { content: 'PORT=4123.5\n', port: '' },
        { content: 'PORT=-1\n', port: '' },
        { content: 'PORT=70000\n', port: '' },
      ];

      const actual = cases.map(({ content }) => ({ content, port: runInstallerHelper(content, 'nerve_port') }));
      expect(actual).toEqual(cases);
    }, TEST_TIMEOUT_MS);

    it('says PORT is unusable instead of probing a port the server cannot be on', async ({ expect }) => {
      const run = await install({
        env: 'GATEWAY_URL=http://127.0.0.1:18789\nGATEWAY_TOKEN=test-token\nPORT=abc\n',
      });

      expect(run.code).toBe(2);
      expect(run.calls.filter((call) => /\/health$/.test(call) && !call.includes(':18789/'))).toEqual([]);
      expect(run.output).toContain('PORT in .env (abc) is not a usable port (use 1 to 65535).');
      expect(printedSteps(run)).toEqual([`cd ${run.installDir} && npm run setup`, 'sudo systemctl restart nerve.service']);
      expect(run.output).not.toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);
  });

  describe('Linux without a running systemd', () => {
    it('tells the user how to start Nerve when systemctl is missing', async ({ expect }) => {
      const run = await install({ systemd: 'absent' });

      expect(run.code).toBe(0);
      expect(run.output).toContain('Nerve is installed but not running yet.');
      expect(run.output).toContain(`cd ${run.installDir} && npm start`);
      expect(run.output).not.toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('does not try to install a unit when systemctl exists but systemd is not running', async ({ expect }) => {
      const run = await install({ systemd: 'not-running' });

      expect(run.code).toBe(0);
      expect(systemctlCalls(run)).toEqual([]);
      expect(run.calls.filter((call) => call.startsWith('sudo '))).toEqual([]);
      expect(run.installedUnit).toBeNull();
      expect(run.output).toMatch(/systemd is not running/);
      expect(run.output).toContain(`cd ${run.installDir} && npm start`);
      expect(run.output).not.toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('describes the manual start in a dry run without changing anything', async ({ expect }) => {
      const run = await install({ systemd: 'not-running', args: ['--dry-run'] });

      expect(run.code).toBe(0);
      expect(run.output).toContain('systemd is not running: would print how to start Nerve manually');
      expect(run.calls.filter((call) => /^(git clone|npm ci|sudo|systemctl) /.test(call))).toEqual([]);
      expect(existsSync(run.installDir)).toBe(false);
    }, TEST_TIMEOUT_MS);
  });

  describe('launchd agent on macOS', () => {
    it('reports Nerve running once the launchd agent answers /health', async ({ expect }) => {
      const run = await install({ platform: 'Darwin' });

      expect(run.code).toBe(0);
      expect(run.calls).toContainEqual(expect.stringMatching(/^launchctl bootstrap gui\/\d+ \S+com\.nerve\.server\.plist$/));
      expect(healthChecks(run)).toHaveLength(1);
      expect(run.output).toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('points at the log and a restart command when the agent never answers', async ({ expect }) => {
      const run = await install({ platform: 'Darwin', nerveHealth: 'down' });

      expect(run.code).toBe(2);
      expect(run.output).toContain(`tail -n 50 ${run.installDir}/nerve.log`);
      expect(run.output).toContain(`launchctl kickstart -k gui/${UID}/com.nerve.server`);
      expect(run.output).not.toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('prints the load command and exits 2 when the agent cannot be loaded', async ({ expect }) => {
      const run = await install({ platform: 'Darwin', launchd: 'fail' });
      const plist = path.join(run.home, 'Library', 'LaunchAgents', 'com.nerve.server.plist');

      expect(run.code).toBe(2);
      expect(healthChecks(run)).toEqual([]);
      expect(run.output).toContain(`launchctl load ${plist}`);
      expect(run.output).toContain('Nerve is installed but not running yet.');
      expect(run.output).not.toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);
  });

  describe('printed commands still work when paths contain spaces', () => {
    it('quotes the install directory in the manual start and directory commands', async ({ expect }) => {
      const run = await install({ systemd: 'absent', spacedPaths: true });

      expect(run.code).toBe(0);
      expect(run.installDir).toContain(' ');
      const [start] = printedSteps(run);
      expect(start).toMatch(/&& npm start$/);
      expect(runPrinted(start, 'npm() { pwd; echo "npm $*"; }')).toBe(`${run.installDir}\nnpm start\n`);
      const directory = printedLine(run, 'Directory:').replace(/^Directory:\s+/, '');
      expect(runPrinted(`${directory} && pwd`, '')).toBe(`${run.installDir}\n`);
    }, TEST_TIMEOUT_MS);

    it('quotes the saved unit and unit paths in the commands printed without root access', async ({ expect }) => {
      const run = await install({ sudo: 'denied', spacedPaths: true });
      const savedUnit = path.join(run.home, '.nerve', 'nerve.service');

      expect(run.code).toBe(2);
      expect(run.unitFile).toContain(' ');
      const steps = printedSteps(run);
      expect(steps).toHaveLength(4);
      // Run each step with a sudo that executes its arguments and a systemctl that records them.
      const calls = steps.map((step) => runPrinted(step, 'systemctl() { echo "systemctl $*"; }\nsudo() { "$@"; }'));
      expect(calls.slice(1)).toEqual([
        'systemctl daemon-reload\n',
        'systemctl enable nerve.service\n',
        'systemctl restart nerve.service\n',
      ]);
      expect(readFileSync(run.unitFile, 'utf8')).toBe(readFileSync(savedUnit, 'utf8'));
    }, TEST_TIMEOUT_MS);

    it('quotes the setup command when .env still has to be created', async ({ expect }) => {
      const run = await install({ gatewayToken: false, spacedPaths: true });

      expect(run.code).toBe(2);
      expect(existsSync(path.join(run.installDir, '.env'))).toBe(false);
      const [setup, restart] = printedSteps(run);
      const npmPrelude = 'npm() { pwd; echo "npm $*"; }';
      expect(runPrinted(setup, npmPrelude)).toBe(`${run.installDir}\nnpm run setup\n`);
      expect(runPrinted(restart, 'sudo() { echo "$*"; }')).toBe('systemctl restart nerve.service\n');
      const finalHint = printedLine(run, '→ Run: cd ').replace(/^→ Run:\s+/, '');
      expect(runPrinted(finalHint, npmPrelude)).toBe(`${run.installDir}\nnpm run setup\n`);
    }, TEST_TIMEOUT_MS);

    it('quotes the launchd log and load commands', async ({ expect }) => {
      const notAnswering = await install({ platform: 'Darwin', nerveHealth: 'down', spacedPaths: true });
      const logs = printedLine(notAnswering, 'tail -n 50 ');
      expect(runPrinted(logs, 'tail() { printf "%s\\n" "$@"; }')).toBe(`-n\n50\n${notAnswering.installDir}/nerve.log\n`);

      const notLoaded = await install({ platform: 'Darwin', launchd: 'fail', spacedPaths: true });
      const plist = path.join(notLoaded.home, 'Library', 'LaunchAgents', 'com.nerve.server.plist');
      const [load] = printedSteps(notLoaded);
      expect(runPrinted(load, 'launchctl() { printf "%s\\n" "$@"; }')).toBe(`load\n${plist}\n`);
      expect(existsSync(plist)).toBe(true);
    }, TEST_TIMEOUT_MS);
  });

  describe('failing steps are reported instead of silently ending the install', () => {
    it('treats a failed speech model download as a warning and removes the partial file', async ({ expect }) => {
      const run = await install({ speechModel: 'download-fails' });

      expect(run.code).toBe(0);
      expect(run.output).toMatch(/Speech model download failed/);
      expect(existsSync(path.join(run.home, '.nerve', 'models', 'ggml-base.bin'))).toBe(false);
      expect(run.output).toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('treats a failed ffmpeg install as a warning and keeps going', async ({ expect }) => {
      const run = await install({ ffmpeg: false, apt: 'fail' });

      expect(run.code).toBe(0);
      expect(run.calls).toContain('sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ffmpeg');
      expect(run.output).toMatch(/ffmpeg install failed/);
      expect(run.output).toContain(SUCCESS_BANNER);
    }, TEST_TIMEOUT_MS);

    it('shows npm ci diagnostics and exits 1 when dependencies fail to install', async ({ expect }) => {
      const run = await install({ npmCi: 'fail' });

      expect(run.code).toBe(1);
      expect(run.output).toMatch(/npm ci failed/);
      expect(run.output).toContain('npm ERR! code E404');
      expect(run.calls).not.toContain('npm run build');
    }, TEST_TIMEOUT_MS);

    it('shows build diagnostics and exits 1 when the build fails', async ({ expect }) => {
      const run = await install({ build: 'fail' });

      expect(run.code).toBe(1);
      expect(run.output).toMatch(/Build failed/);
      expect(run.output).toContain("error TS2304: Cannot find name 'x'.");
      expect(systemctlCalls(run)).toEqual([]);
    }, TEST_TIMEOUT_MS);
  });
});
