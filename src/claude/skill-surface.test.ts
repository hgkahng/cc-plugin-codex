import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const skills = new Map([
  ['claude-delegate', 'delegate'],
  ['claude-status', 'status'],
  ['claude-result', 'result'],
  ['claude-cancel', 'cancel'],
]);

describe('claude skills', () => {
  it('ships skills that only run the shared entrypoint script', () => {
    for (const [skill, command] of skills) {
      const path = `claude/skills/${skill}/SKILL.md`;
      expect(existsSync(path)).toBe(true);
      const contents = readFileSync(path, 'utf8');
      expect(contents).toContain('directory two levels above this `SKILL.md` file');
      expect(contents).toContain(`node <plugin-root>/scripts/claude-companion.mjs ${command}`);
      expect(contents).not.toContain('node claude/scripts/claude-companion.mjs');
      expect(contents).toContain("Do not do the command's work yourself.");
    }
  });
});
