import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatDiff, formatPreAgentSummary } from '../report.js';

const ANSI = '\x1b[';

function makeDiff({ fixedCount, remainingCount, introducedCount }) {
  return {
    fixed: [],
    remaining: [],
    introduced: [],
    fixedCount,
    remainingCount,
    introducedCount,
  };
}

test('formatDiff(diff) without options returns plain text without ANSI codes', () => {
  const diff = makeDiff({ fixedCount: 2, remainingCount: 1, introducedCount: 0 });
  const text = formatDiff(diff);
  assert.ok(!text.includes(ANSI), 'should not contain ANSI escape codes');
  assert.ok(text.includes('Fixed:'));
  assert.ok(text.includes('Remaining:'));
  assert.ok(text.includes('Introduced:'));
});

test('formatDiff(diff, { color: true }) returns text containing ANSI escape codes', () => {
  const diff = makeDiff({ fixedCount: 2, remainingCount: 1, introducedCount: 1 });
  const text = formatDiff(diff, { color: true });
  assert.ok(text.includes(ANSI), 'should contain ANSI escape codes');
});

test('formatDiff color: Fixed line contains ANSI escapes near the count', () => {
  const diff = makeDiff({ fixedCount: 5, remainingCount: 0, introducedCount: 0 });
  const text = formatDiff(diff, { color: true });
  // Find the Fixed: line
  const fixedLine = text.split('\n').find((l) => l.includes('Fixed:'));
  assert.ok(fixedLine, 'Fixed line should exist');
  // After "Fixed:" there should be ANSI escapes (color wrapping the number)
  const afterFixed = fixedLine.slice(fixedLine.indexOf('Fixed:') + 'Fixed:'.length);
  assert.ok(afterFixed.includes(ANSI), 'ANSI escapes should appear after Fixed:');
});

test('formatDiff color: Remaining line has ANSI when count > 0', () => {
  const diff = makeDiff({ fixedCount: 0, remainingCount: 3, introducedCount: 0 });
  const text = formatDiff(diff, { color: true });
  const remainingLine = text.split('\n').find((l) => /Remaining:\s/.test(l));
  assert.ok(remainingLine, 'Remaining line should exist');
  const afterRemaining = remainingLine.slice(remainingLine.indexOf('Remaining:') + 'Remaining:'.length);
  assert.ok(afterRemaining.includes(ANSI), 'ANSI escapes should appear after Remaining: when count > 0');
});

test('formatDiff color: Remaining line has ANSI (dim) when count is 0', () => {
  const diff = makeDiff({ fixedCount: 0, remainingCount: 0, introducedCount: 0 });
  const text = formatDiff(diff, { color: true });
  const remainingLine = text.split('\n').find((l) => /Remaining:\s/.test(l));
  assert.ok(remainingLine, 'Remaining line should exist');
  const afterRemaining = remainingLine.slice(remainingLine.indexOf('Remaining:') + 'Remaining:'.length);
  assert.ok(afterRemaining.includes(ANSI), 'ANSI escapes (dim) should appear after Remaining: when count is 0');
});

test('formatDiff color: Introduced line has ANSI when count > 0', () => {
  const diff = makeDiff({ fixedCount: 0, remainingCount: 0, introducedCount: 4 });
  const text = formatDiff(diff, { color: true });
  const introducedLine = text.split('\n').find((l) => /Introduced:\s/.test(l));
  assert.ok(introducedLine, 'Introduced line should exist');
  const afterIntroduced = introducedLine.slice(introducedLine.indexOf('Introduced:') + 'Introduced:'.length);
  assert.ok(afterIntroduced.includes(ANSI), 'ANSI escapes should appear after Introduced: when count > 0');
});

test('formatDiff color: Introduced line has ANSI (dim) when count is 0', () => {
  const diff = makeDiff({ fixedCount: 0, remainingCount: 0, introducedCount: 0 });
  const text = formatDiff(diff, { color: true });
  const introducedLine = text.split('\n').find((l) => /Introduced:\s/.test(l));
  assert.ok(introducedLine, 'Introduced line should exist');
  const afterIntroduced = introducedLine.slice(introducedLine.indexOf('Introduced:') + 'Introduced:'.length);
  assert.ok(afterIntroduced.includes(ANSI), 'ANSI escapes (dim) should appear after Introduced: when count is 0');
});

test('formatPreAgentSummary returns a string that contains totals, kinds, agent name, and paths', () => {
  const text = formatPreAgentSummary({
    counts: { 'dead-code': 12, dupes: 3, health: 7 },
    total: 22,
    agentName: 'Claude Code',
    command: 'claude',
    dir: '/abs/project',
    reportPath: '/abs/project/_ppt-report/123.json',
  });
  assert.equal(typeof text, 'string');
  assert.ok(text.includes('22'), 'should include total');
  assert.ok(text.includes('issue'), 'should mention issue(s)');
  assert.ok(text.includes('dead-code'), 'should include kind');
  assert.ok(text.includes('dupes'), 'should include kind');
  assert.ok(text.includes('health'), 'should include kind');
  assert.ok(text.includes('12'), 'should include kind count');
  assert.ok(text.includes('Claude Code'), 'should include agent name');
  assert.ok(text.includes('claude'), 'should include command');
  assert.ok(text.includes('/abs/project'), 'should include directory');
  assert.ok(text.includes('/abs/project/_ppt-report/123.json'), 'should include report path');
});

test('formatPreAgentSummary without color does not contain ANSI escapes', () => {
  const text = formatPreAgentSummary({
    counts: { 'dead-code': 1 },
    total: 1,
    agentName: 'Claude Code',
    command: 'claude',
    dir: '/abs/project',
    reportPath: '/abs/project/_ppt-report/123.json',
  });
  assert.ok(!text.includes(ANSI), 'should not contain ANSI escapes by default');
});

test('formatPreAgentSummary with { color: true } contains ANSI escapes', () => {
  const text = formatPreAgentSummary(
    {
      counts: { 'dead-code': 1 },
      total: 1,
      agentName: 'Claude Code',
      command: 'claude',
      dir: '/abs/project',
      reportPath: '/abs/project/_ppt-report/123.json',
    },
    { color: true },
  );
  assert.ok(text.includes(ANSI), 'should contain ANSI escapes when color is true');
});
