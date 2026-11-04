import { describe, expect, it } from 'vitest';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function createFakeClaudeExecutable(result: string) {
  const root = mkdtempSync(join(tmpdir(), 'claude-entrypoint-fake-cli-'));
  const binDir = join(root, 'bin');
  const exePath = join(binDir, 'claude');

  mkdirSync(binDir, { recursive: true });
  writeFileSync(
    exePath,
    [
      '#!/usr/bin/env node',
      'process.stdout.write(JSON.stringify({',
      '  is_error: false,',
      `  result: ${JSON.stringify(result)},`,
      '  session_id: "session-entrypoint"',
      '}));',
    ].join('\n'),
    'utf8',
  );
  chmodSync(exePath, 0o755);

  return {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    },
  };
}

function createInstalledPluginBundle() {
  const root = mkdtempSync(join(tmpdir(), 'claude-entrypoint-plugin-'));
  const pluginRoot = join(root, 'claude-companion');
  cpSync('claude', pluginRoot, { recursive: true });
  return pluginRoot;
}

describe('entrypoint asset paths', () => {
  it('runs delegate from an arbitrary workspace while reading the installed bundled prompt', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'claude-entrypoint-workspace-'));
    const stateRoot = mkdtempSync(join(tmpdir(), 'claude-entrypoint-state-'));
    const fake = createFakeClaudeExecutable('delegate finished');
    const entrypoint = join(createInstalledPluginBundle(), 'scripts/claude-companion.mjs');

    const stdout = execFileSync('node', [entrypoint, 'delegate', 'investigate path handling'], {
      cwd: workspaceRoot,
      env: {
        ...fake.env,
        CLAUDE_COMPANION_STATE_ROOT: stateRoot,
      },
      encoding: 'utf8',
    });

    expect(stdout).toContain('delegate finished');
  });
});
