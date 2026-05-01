import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../config.js';
import { PRESETS } from '../agents.js';

test('DEFAULT_CONFIG has an agent with required fields', () => {
  assert.ok(DEFAULT_CONFIG.agent);
  assert.equal(typeof DEFAULT_CONFIG.agent.command, 'string');
  assert.ok(Array.isArray(DEFAULT_CONFIG.agent.args));
  assert.match(DEFAULT_CONFIG.agent.promptStyle, /^(inline|stdin)$/);
  assert.equal(typeof DEFAULT_CONFIG.agent.prompt, 'string');
});

test('PRESETS contains the expected agents', () => {
  const names = PRESETS.map((p) => p.name);
  assert.deepEqual(names, ['Claude Code', 'Aider', 'Codex CLI', 'Gemini CLI', 'Custom']);
});
