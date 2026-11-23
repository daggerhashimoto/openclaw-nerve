import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { spawnMock, ensureSpawnHelperExecutableMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  ensureSpawnHelperExecutableMock: vi.fn(),
}));

vi.mock('node-pty', () => ({
  spawn: spawnMock,
}));

vi.mock('../lib/pty-spawn-helper.js', () => ({
  ensureSpawnHelperExecutable: ensureSpawnHelperExecutableMock,
}));

import { getClaudeUsage, getTrustPromptKeys, stripAnsi } from './claude-usage.js';

interface FakePty {
  writes: string[];
  emit: (chunk: string) => void;
  kill: ReturnType<typeof vi.fn>;
}

function createFakePty(onWrite?: (data: string, pty: FakePty) => void): FakePty {
  let dataListener: ((data: string) => void) | null = null;
  const writes: string[] = [];
  const kill = vi.fn();

  const fakePty: FakePty = {
    writes,
    emit(chunk: string) {
      dataListener?.(chunk);
    },
    kill,
  };

  spawnMock.mockReturnValue({
    onData(cb: (data: string) => void) {
      dataListener = cb;
      return { dispose: vi.fn() };
    },
    write(data: string) {
      writes.push(data);
      onWrite?.(data, fakePty);
    },
    kill,
  });

  return fakePty;
}

const SAMPLE_USAGE_OUTPUT = [
  'Current session',
  '  ██████████  42% used',
  '  Resets 10:59pm (UTC)',
  'Current week (all models)',
  '  █████       18% used',
  '  Resets Nov 24 at 11pm (UTC)',
].join('\n');

describe('claude-usage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    spawnMock.mockReset();
    ensureSpawnHelperExecutableMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('stripAnsi', () => {
    it('preserves word boundaries and line breaks from Ink cursor-positioning sequences', () => {
      const raw =
        '\x1b[2G\x1b[1mAccessing\x1b[12Gworkspace:\x1b[22m\r\r\n' +
        '\x1b[2GQuick\x1b[8Gsafety\x1b[15Gcheck:\r\r\n' +
        '\x1b[2G\x1b[38;2;177;185;249m❯\x1b[4GNo,\x1b[8Gexit\x1b[39m\r\r\n' +
        '\x1b[4GYes,\x1b[9GI\x1b[11Gtrust\x1b[17Gthis\x1b[22Gfolder\r\r\n' +
        '\r\x1b[2C\x1b[1B100%\x1b[59Gused\r\x1b[1BResets 11:10pm (UTC)\r\x1b[2C\x1b[2BCurrent week';

      const cleaned = stripAnsi(raw);
      expect(cleaned).toContain('Accessing workspace:');
      expect(cleaned).toContain('Quick safety check:');
      expect(cleaned).toContain('❯ No, exit');
      expect(cleaned).toContain('Yes, I trust this folder');
      expect(cleaned).toContain('100% used\nResets 11:10pm (UTC) \nCurrent week');
    });
  });

  describe('getTrustPromptKeys', () => {
    it('moves down before confirming when "No, exit" is selected above "Yes, I trust this folder"', () => {
      const prompt = [
        'Quick safety check: Is this a project you created or one you trust?',
        '❯ No, exit',
        '  Yes, I trust this folder',
        'Enter to confirm · Esc to cancel',
      ].join('\n');

      expect(getTrustPromptKeys(prompt)).toEqual(['\x1b[B', '\r']);
    });

    it('presses Enter directly when "Yes, I trust this folder" is already selected', () => {
      const prompt = [
        'Quick safety check: Is this a project you created or one you trust?',
        '❯ Yes, I trust this folder',
        '  No, exit',
        'Enter to confirm · Esc to cancel',
      ].join('\n');

      expect(getTrustPromptKeys(prompt)).toEqual(['\r']);
    });

    it('moves up before confirming when "Yes" is listed above a selected "No, exit"', () => {
      const prompt = [
        'Quick safety check: Is this a project you created or one you trust?',
        '  Yes, I trust this folder',
        '❯ No, exit',
        'Enter to confirm · Esc to cancel',
      ].join('\n');

      expect(getTrustPromptKeys(prompt)).toEqual(['\x1b[A', '\r']);
    });
  });

  describe('getClaudeUsage', () => {
    it('selects "Yes, I trust this folder" when Claude Code 2.1.330 starts on "No, exit"', async () => {
      let selectedOption: 'no' | 'yes' = 'no';
      let trusted = false;

      const pty = createFakePty((data, self) => {
        if (!trusted) {
          if (data === '\x1b[B') {
            selectedOption = 'yes';
            // Redraw the trust menu with ❯ on "Yes, I trust this folder"
            self.emit(
              ' \x1b[4GNo, exit\r\x1b[1C\x1b[1B\x1b[38;2;177;185;249m❯\x1b[4GYes, I trust this folder\x1b[39m',
            );
            return;
          }
          if (data === '\r') {
            if (selectedOption === 'no') {
              self.emit(
                "Claude Code didn't start because this folder isn't trusted.\nRun claude again and choose Yes, or run it in another folder.\n",
              );
              return;
            }
            trusted = true;
            // Delay the ready prompt slightly so we verify getClaudeUsage waits for it
            // instead of matching the trust prompt's own ❯ cursor.
            setTimeout(() => {
              self.emit('\x1b[2J\x1b[H❯ Try "refactor <filepath>"');
            }, 200);
            return;
          }
        }

        if (trusted && data === '/usage\r') {
          self.emit(
            '\r\x1b[2B \x1b[3G\x1b[1mCurrent session\x1b[22m\r\x1b[2C\x1b[1B████ 42%\x1b[59Gused\r\x1b[1B  Resets 10:59pm (UTC)\r\x1b[2C\x1b[2B\x1b[1mCurrent week (all models)\r\x1b[2C\x1b[1B████ 18%\x1b[58Gused\r\x1b[2C\x1b[1BResets Nov 24 at 11pm (UTC)\r\x1b[2C\x1b[2BWhat is contributing',
          );
        }
      });

      const promise = getClaudeUsage();

      // Emit the 2.1.330 Ink-formatted trust prompt where ❯ starts on "No, exit"
      pty.emit(
        '\x1b[2G\x1b[1mAccessing\x1b[12Gworkspace:\x1b[22m\r\r\n' +
          '\x1b[2G/tmp\r\r\n' +
          '\x1b[2GQuick\x1b[8Gsafety\x1b[15Gcheck:\x1b[22GIs\x1b[25Gthis\x1b[30Ga\x1b[32Gproject\x1b[40Gyou\x1b[44Gcreated\x1b[52Gor\x1b[55Gone\x1b[59Gyou\x1b[63Gtrust?\r\r\n' +
          '\x1b[2G\x1b[38;2;177;185;249m❯\x1b[4GNo,\x1b[8Gexit\x1b[39m\r\r\n' +
          '\x1b[4GYes,\x1b[9GI\x1b[11Gtrust\x1b[17Gthis\x1b[22Gfolder\r\r\n' +
          '\x1b[2GEnter\x1b[8Gto\x1b[11Gconfirm\x1b[19G·\x1b[21GEsc\x1b[25Gto\x1b[28Gcancel\r\r\n',
      );

      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(pty.writes).toEqual(['\x1b[B', '\r', '/usage\r', '\r']);
      expect(result).toEqual({
        available: true,
        session_limit: {
          used_percent: 42,
          left_percent: 58,
          resets_at: '10:59pm (UTC)',
        },
        weekly_limit: {
          used_percent: 18,
          left_percent: 82,
          resets_at: 'Nov 24 at 11pm (UTC)',
        },
      });
      expect(pty.kill).toHaveBeenCalledOnce();
    });

    it('accepts the trust prompt with Enter alone when "Yes, I trust this folder" starts selected', async () => {
      let trusted = false;

      const pty = createFakePty((data, self) => {
        if (!trusted) {
          if (data === '\x1b[B') {
            // Moving down when Yes is first would select "No, exit"
            self.emit("Claude Code didn't start because this folder isn't trusted.\n");
            return;
          }
          if (data === '\r') {
            trusted = true;
            self.emit('❯ ');
            return;
          }
        }

        if (trusted && data === '/usage\r') {
          self.emit(SAMPLE_USAGE_OUTPUT);
        }
      });

      const promise = getClaudeUsage();

      pty.emit(
        [
          'Quick safety check: Is this a project you created or one you trust?',
          '❯ Yes, I trust this folder',
          '  No, exit',
          'Enter to confirm · Esc to cancel',
        ].join('\n'),
      );

      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(pty.writes).toEqual(['\r', '/usage\r', '\r']);
      expect(result).toEqual({
        available: true,
        session_limit: {
          used_percent: 42,
          left_percent: 58,
          resets_at: '10:59pm (UTC)',
        },
        weekly_limit: {
          used_percent: 18,
          left_percent: 82,
          resets_at: 'Nov 24 at 11pm (UTC)',
        },
      });
    });

    it('sends /usage directly when the folder is already trusted', async () => {
      const pty = createFakePty((data, self) => {
        if (data === '/usage\r') {
          self.emit(SAMPLE_USAGE_OUTPUT);
        }
      });

      const promise = getClaudeUsage();
      pty.emit('❯ Try "refactor <filepath>"');

      await vi.advanceTimersByTimeAsync(5_000);
      const result = await promise;

      expect(pty.writes).toEqual(['/usage\r', '\r']);
      expect(result.available).toBe(true);
    });
  });
});
