import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const load = () => import('../../claude/scripts/lib/runtime-config.mjs');

describe('runtime config', () => {
  it('defaults to opus and high effort', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-config-'));
    const { loadRuntimeConfig } = await load();

    const config = await loadRuntimeConfig({ CLAUDE_COMPANION_STATE_ROOT: root });

    expect(config).toEqual({ defaultModel: 'opus', defaultEffort: 'high' });
  });

  it('reads hand-edited defaults from config.json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'claude-companion-config-'));
    const { loadRuntimeConfig, getConfigPath } = await load();
    mkdirSync(root, { recursive: true });
    writeFileSync(getConfigPath({ CLAUDE_COMPANION_STATE_ROOT: root }), JSON.stringify({ defaultModel: 'sonnet' }));

    const config = await loadRuntimeConfig({ CLAUDE_COMPANION_STATE_ROOT: root });

    expect(config).toEqual({ defaultModel: 'sonnet', defaultEffort: 'high' });
  });
});
