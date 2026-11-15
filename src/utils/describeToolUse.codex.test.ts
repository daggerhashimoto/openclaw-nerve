import { describe, it, expect } from 'vitest';
import { describeToolUse } from './helpers';

describe('describeToolUse for the Codex harness', () => {
  it('names the files an apply_patch call edits with their line counts', () => {
    const text = describeToolUse('apply_patch', {
      changes: [
        { path: '/home/u/nerve/src/a.tsx', kind: { type: 'update' }, stat: { added: 5, removed: 2 }, diff: '' },
        { path: '/home/u/nerve/README.md', kind: { type: 'add' }, diff: '' },
      ],
    });
    expect(text).toBe('editing a.tsx +5 -2, README.md');
  });

  it('falls back to a plain verb when the patch carries no changes', () => {
    expect(describeToolUse('apply_patch', {})).toBe('editing files');
  });

  it('describes bash calls like exec calls', () => {
    expect(describeToolUse('bash', { command: 'grep -rn foo src', cwd: '/home/u/nerve' })).toMatch(/searching files/);
  });

  // Shapes below are copied from a 2026.9 gateway running the Codex harness.
  describe('web search', () => {
    it('says it is searching the web while the query is not known yet', () => {
      // Codex reports the call before it knows the query.
      expect(describeToolUse('web_search', { queryUnavailable: true })).toBe('searching the web');
    });

    it('names the query once it is known', () => {
      expect(describeToolUse('web_search', { query: 'OpenClaw gateway release notes' })).toBe('searching: OpenClaw gateway release notes');
    });

    it('names the first of several queries and counts the rest', () => {
      expect(describeToolUse('web_search', {
        query: 'site:docs.openclaw.ai memory search ...',
        queries: ['site:docs.openclaw.ai memory search', 'site:github.com/openclaw/openclaw plugin inventory'],
      })).toBe('searching: site:docs.openclaw.ai memory search and 1 more');
    });

    it('names the text it looks for when it searches inside a page', () => {
      expect(describeToolUse('web_search', {
        query: "'Local embeddings' in https://docs.openclaw.ai/concepts/memory-builtin",
        action: 'findInPage',
        url: 'https://docs.openclaw.ai/concepts/memory-builtin',
        pattern: 'Local embeddings',
      })).toBe('finding in page: Local embeddings');
    });

    it('names the page when the search opens one', () => {
      expect(describeToolUse('web_search', {
        query: 'https://docs.openclaw.ai/concepts/memory-builtin',
        action: 'openPage',
        url: 'https://docs.openclaw.ai/concepts/memory-builtin',
      })).toBe('opening docs.openclaw.ai/concepts/memory-builtin');
    });
  });

  describe('shell commands', () => {
    it('looks inside a bash -lc wrapper', () => {
      expect(describeToolUse('bash', {
        command: "/bin/bash -lc 'ls ~/.openclaw | head -5'",
        cwd: '/home/ubuntu/.openclaw/workspace',
      })).toBe('exec: ls ~/.openclaw');
    });

    it('names the pattern a file search looks for', () => {
      expect(describeToolUse('bash', {
        command: `/bin/bash -lc "rg -n -F 'Plugin inventory has retired' ~/.npm-global/lib/node_modules/openclaw | head -30"`,
        cwd: '/home/ubuntu/.openclaw/workspace',
      })).toBe('searching files: Plugin inventory has retired');
      expect(describeToolUse('exec', { command: 'grep -rn -A 3 "foo|bar" src' })).toBe('searching files: foo|bar');
      expect(describeToolUse('exec', { command: 'rg -e TODO -g "*.ts"' })).toBe('searching files: TODO');
    });

    it('names what a find looks for', () => {
      expect(describeToolUse('exec', { command: 'find . -name "*.test.ts" -type f' })).toBe('finding files: *.test.ts');
    });

    it('names the file a read opens', () => {
      expect(describeToolUse('exec', { command: 'cat /home/u/nerve/package.json' })).toBe('reading ~/nerve/package.json');
      expect(describeToolUse('exec', { command: 'head -n 30 src/types.ts' })).toBe('reading src/types.ts');
      expect(describeToolUse('exec', { command: "sed -n '1,120p' src/App.tsx" })).toBe('reading src/App.tsx');
    });

    it('names the host a fetch talks to', () => {
      expect(describeToolUse('exec', { command: 'curl -s https://api.github.com/repos/openclaw/openclaw' })).toBe('fetching api.github.com');
    });

    it('skips a leading cd to the command that does the work', () => {
      expect(describeToolUse('exec', { command: 'cd /home/u/nerve && rg -n useChat src' })).toBe('searching files: useChat');
    });

    it('reads a command given as an argument list', () => {
      expect(describeToolUse('exec', { command: ['bash', '-lc', 'cat README.md'] })).toBe('reading README.md');
    });

    it('still redacts secrets', () => {
      expect(describeToolUse('exec', { command: "/bin/bash -lc 'deploy --token=abc123 now'" })).toBe('exec: deploy --token=[REDACTED] now');
    });
  });

  describe('code mode scripts', () => {
    it('names the commands a script runs', () => {
      const input = 'const r=await Promise.allSettled([\ntools.exec_command({cmd:"openclaw gateway status --deep",max_output_tokens:3000,yield_time_ms:10000}),\ntools.exec_command({cmd:"openclaw doctor --lint",max_output_tokens:3000})\n]);';
      expect(describeToolUse('exec', { input })).toBe('exec: openclaw gateway status --deep and 1 more');
    });

    it('names the searches a script runs', () => {
      const input = 'const r=await Promise.allSettled([\ntools.web__run({search_query:[{q:"site:docs.openclaw.ai memory search embedding provider"},{"q":"site:github.com/openclaw/openclaw plugin inventory"}]})\n]);';
      expect(describeToolUse('exec', { input })).toBe('searching: site:docs.openclaw.ai memory search embedding provider and 1 more');
    });

    it('says it is running a script when it cannot tell more', () => {
      expect(describeToolUse('exec', { input: 'const x = 1 + 1; text(x);' })).toBe('running script');
    });
  });

  // More shapes found replaying a real VPS session through these labels.
  describe('the rest of a real session', () => {
    it('unwraps an unquoted one-word bash -lc', () => {
      expect(describeToolUse('bash', { command: '/bin/bash -lc pwd' })).toBe('exec: pwd');
    });

    it('names the files an rg --files listing looks for', () => {
      expect(describeToolUse('bash', { command: `/bin/bash -lc "rg --files -g 'AGENTS.md' -g 'SOUL.md' -g 'USER.md'"` }))
        .toBe('finding files: AGENTS.md, SOUL.md, USER.md');
    });

    it('names the folder a find walks when it has no name filter', () => {
      expect(describeToolUse('bash', {
        command: `/bin/bash -lc "find ~/.openclaw/models -maxdepth 5 -type f -printf '%p %s bytes\\n' 2>/dev/null | head -30"`,
      })).toBe('finding files in ~/.openclaw/models');
    });

    it('calls a command python only when python is what runs', () => {
      expect(describeToolUse('bash', {
        command: `/bin/bash -lc "openclaw plugins list --json | python3 -c 'import sys,json; print(json.load(sys.stdin))'"`,
      })).toBe('exec: openclaw plugins list --json');
      expect(describeToolUse('bash', { command: `/bin/bash -lc "python3 - <<'PY'\nimport json\nprint(1)\nPY"` })).toBe('running python script');
      expect(describeToolUse('exec', { command: 'python3 scripts/check.py --fast' })).toBe('running scripts/check.py');
    });

    it('names what a code mode script does with a running command or a page', () => {
      expect(describeToolUse('exec', { input: 'const r=await tools.write_stdin({session_id:51553,chars:"",yield_time_ms:1000});text(r);' }))
        .toBe('checking on a running command');
      expect(describeToolUse('exec', { input: 'const r=await tools.write_stdin({session_id:51553,chars:"y\\n"});text(r);' }))
        .toBe('sending input to a running command');
      expect(describeToolUse('exec', {
        input: 'const r=await tools.web__run({find:[{"ref_id":"https://docs.openclaw.ai/concepts/memory-builtin","pattern":"Local embeddings"}]});',
      })).toBe('finding in page: Local embeddings');
      expect(describeToolUse('exec', { input: 'const r=await tools.web__run({open:[{"ref_id":"https://docs.openclaw.ai/reference/memory-config"}]});' }))
        .toBe('opening docs.openclaw.ai/reference/memory-config');
    });

    it('names the OpenClaw and session tools', () => {
      expect(describeToolUse('openclaw', { message: 'Restart the OpenClaw Gateway service' })).toBe('asking OpenClaw: Restart the OpenClaw Gateway service');
      expect(describeToolUse('sessions_search', { query: 'STT_PROVIDER=openai', limit: 3 })).toBe('searching sessions: STT_PROVIDER=openai');
      expect(describeToolUse('agents_list', {})).toBe('listing agents');
      expect(describeToolUse('heartbeat_respond', { outcome: 'no_change', notify: false })).toBe('answering the heartbeat');
      expect(describeToolUse('codex.list_mcp_resources', {})).toBe('listing MCP resources');
      expect(describeToolUse('codex.list_mcp_resource_templates', {})).toBe('listing MCP resource templates');
    });

    it('checks a service for systemctl show', () => {
      expect(describeToolUse('exec', { command: 'systemctl show nerve-redesign.service -p ActiveState' })).toBe('checking service: nerve-redesign.service');
    });

    it('adds the main detail to a tool it does not know', () => {
      expect(describeToolUse('notes_lookup', { query: 'deploy steps' })).toBe('using notes_lookup: deploy steps');
      expect(describeToolUse('notes_lookup', { limit: 3 })).toBe('using notes_lookup');
    });
  });
});
