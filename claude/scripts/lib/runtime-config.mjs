import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';

export const DEFAULT_MODEL = 'opus';
export const DEFAULT_EFFORT = 'high';

const DEFAULT_CONFIG = {
  defaultModel: DEFAULT_MODEL,
  defaultEffort: DEFAULT_EFFORT,
};

export function getStateRoot(env = process.env) {
  return env.CLAUDE_COMPANION_STATE_ROOT ?? join(homedir(), '.codex', 'claude-companion');
}

export function getConfigPath(env = process.env) {
  return join(getStateRoot(env), 'config.json');
}

// Optional hand-edited defaults, for example {"defaultModel": "sonnet"}.
export async function loadRuntimeConfig(env = process.env) {
  try {
    const parsed = JSON.parse(await readFile(getConfigPath(env), 'utf8'));
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}
