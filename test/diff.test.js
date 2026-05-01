import { test } from 'node:test';
import assert from 'node:assert/strict';

import { diffSummaries, formatDiff } from '../report.js';

function makeSummary(issues) {
  const countsByKind = {};
  for (const i of issues) {
    countsByKind[i.kind] = (countsByKind[i.kind] || 0) + 1;
  }
  return {
    issues,
    countsByKind,
    total: issues.length,
  };
}

test('diffSummaries classifies fixed, remaining, and introduced correctly', () => {
  const before = makeSummary([
    { id: 1, kind: 'dead-code', file: 'src/x.ts', line: 42, message: 'unused export foo' },
    { id: 2, kind: 'dupes', file: 'src/a.ts', line: null, message: 'dup with b.ts' },
    { id: 3, kind: 'health', file: 'src/c.ts', line: 10, message: 'too complex' },
  ]);
  const after = makeSummary([
    // remaining: id changes but matches by kind+file+line+message
    { id: 7, kind: 'dupes', file: 'src/a.ts', line: null, message: 'dup with b.ts' },
    // remaining
    { id: 8, kind: 'health', file: 'src/c.ts', line: 10, message: 'too complex' },
    // introduced
    { id: 9, kind: 'health', file: 'src/y.ts', line: null, message: 'cyclomatic complexity 22' },
  ]);

  const diff = diffSummaries(before, after);

  assert.equal(diff.fixedCount, 1);
  assert.equal(diff.remainingCount, 2);
  assert.equal(diff.introducedCount, 1);

  assert.equal(diff.fixed.length, 1);
  assert.equal(diff.fixed[0].kind, 'dead-code');
  assert.equal(diff.fixed[0].file, 'src/x.ts');
  assert.equal(diff.fixed[0].line, 42);

  assert.equal(diff.remaining.length, 2);
  // Remaining issues should be sourced (we'll preserve the "before" issue object)
  assert.ok(diff.remaining.some((i) => i.kind === 'dupes' && i.file === 'src/a.ts'));
  assert.ok(diff.remaining.some((i) => i.kind === 'health' && i.file === 'src/c.ts' && i.line === 10));

  assert.equal(diff.introduced.length, 1);
  assert.equal(diff.introduced[0].kind, 'health');
  assert.equal(diff.introduced[0].file, 'src/y.ts');
  assert.equal(diff.introduced[0].message, 'cyclomatic complexity 22');
});

test('diffSummaries: identical before and after means all remaining, none fixed/introduced', () => {
  const issues = [
    { id: 1, kind: 'dead-code', file: 'src/x.ts', line: 1, message: 'm1' },
    { id: 2, kind: 'dupes', file: 'src/y.ts', line: 2, message: 'm2' },
  ];
  const before = makeSummary(issues);
  const after = makeSummary(issues.map((i) => ({ ...i })));

  const diff = diffSummaries(before, after);
  assert.equal(diff.fixedCount, 0);
  assert.equal(diff.introducedCount, 0);
  assert.equal(diff.remainingCount, 2);
  assert.equal(diff.fixed.length, 0);
  assert.equal(diff.introduced.length, 0);
  assert.equal(diff.remaining.length, 2);
});

test('diffSummaries: empty before means everything in after is introduced', () => {
  const before = makeSummary([]);
  const after = makeSummary([
    { id: 1, kind: 'dead-code', file: 'a.ts', line: 1, message: 'm' },
    { id: 2, kind: 'health', file: 'b.ts', line: null, message: 'm2' },
  ]);
  const diff = diffSummaries(before, after);
  assert.equal(diff.fixedCount, 0);
  assert.equal(diff.remainingCount, 0);
  assert.equal(diff.introducedCount, 2);
  assert.equal(diff.introduced.length, 2);
});

test('diffSummaries: empty after means everything in before is fixed', () => {
  const before = makeSummary([
    { id: 1, kind: 'dead-code', file: 'a.ts', line: 1, message: 'm' },
    { id: 2, kind: 'health', file: 'b.ts', line: null, message: 'm2' },
  ]);
  const after = makeSummary([]);
  const diff = diffSummaries(before, after);
  assert.equal(diff.fixedCount, 2);
  assert.equal(diff.remainingCount, 0);
  assert.equal(diff.introducedCount, 0);
  assert.equal(diff.fixed.length, 2);
});

test('diffSummaries: differing message means different issue (fixed + introduced, not remaining)', () => {
  const before = makeSummary([
    { id: 1, kind: 'dead-code', file: 'src/x.ts', line: 42, message: 'unused export foo' },
  ]);
  const after = makeSummary([
    { id: 1, kind: 'dead-code', file: 'src/x.ts', line: 42, message: 'unused export bar' },
  ]);
  const diff = diffSummaries(before, after);
  assert.equal(diff.fixedCount, 1);
  assert.equal(diff.remainingCount, 0);
  assert.equal(diff.introducedCount, 1);
});

test('diffSummaries: null line equals null line', () => {
  const before = makeSummary([
    { id: 1, kind: 'dupes', file: 'src/a.ts', line: null, message: 'dup' },
  ]);
  const after = makeSummary([
    { id: 5, kind: 'dupes', file: 'src/a.ts', line: null, message: 'dup' },
  ]);
  const diff = diffSummaries(before, after);
  assert.equal(diff.remainingCount, 1);
  assert.equal(diff.fixedCount, 0);
  assert.equal(diff.introducedCount, 0);
});

test('formatDiff includes count lines and omits empty sections', () => {
  const diff = {
    fixed: [
      { id: 1, kind: 'dead-code', file: 'src/x.ts', line: 42, message: 'unused export foo' },
    ],
    remaining: [],
    introduced: [],
    fixedCount: 1,
    remainingCount: 0,
    introducedCount: 0,
  };
  const text = formatDiff(diff);
  assert.ok(text.includes('Verification:'), 'should include Verification:');
  assert.ok(text.includes('Fixed:'), 'should include Fixed: count line');
  assert.ok(text.includes('Remaining:'), 'should include Remaining: count line');
  assert.ok(text.includes('Introduced:'), 'should include Introduced: count line');
  assert.ok(text.includes('1'), 'should include the fixed count');
  // omits empty Remaining and Introduced sections (no per-issue listings)
  // The count lines do contain "Remaining:" so we can't simply check substring;
  // instead ensure the per-issue line for the introduced item is not present.
  assert.ok(!text.includes('cyclomatic'));
});

test('formatDiff includes per-issue lines for non-empty Remaining and Introduced sections', () => {
  const diff = {
    fixed: [],
    remaining: [
      { id: 4, kind: 'dead-code', file: 'src/x.ts', line: 42, message: 'unused export foo' },
    ],
    introduced: [
      { id: 2, kind: 'health', file: 'src/y.ts', line: null, message: 'cyclomatic complexity 22' },
    ],
    fixedCount: 0,
    remainingCount: 1,
    introducedCount: 1,
  };
  const text = formatDiff(diff);
  assert.ok(text.includes('Verification:'));
  assert.ok(text.includes('unused export foo'), 'should include remaining issue message');
  assert.ok(text.includes('src/x.ts:42'), 'should include file:line for remaining');
  assert.ok(text.includes('cyclomatic complexity 22'), 'should include introduced message');
  assert.ok(text.includes('src/y.ts'), 'should include introduced file');
});

test('formatDiff omits Remaining section when remaining is empty but Introduced has items', () => {
  const diff = {
    fixed: [],
    remaining: [],
    introduced: [
      { id: 1, kind: 'health', file: 'src/y.ts', line: 7, message: 'too complex' },
    ],
    fixedCount: 0,
    remainingCount: 0,
    introducedCount: 1,
  };
  const text = formatDiff(diff);
  // Count lines always present
  assert.ok(/Remaining:\s+0/.test(text), 'should include Remaining: 0 count line');
  // Per-issue Remaining listing should not appear; only introduced details should
  assert.ok(text.includes('too complex'), 'introduced detail should appear');
  // No remaining detail should appear (no other messages)
  const remainingHeaderMatches = text.match(/Remaining:/g) || [];
  // "Remaining:" appears once (count line) since the section header is omitted
  assert.equal(remainingHeaderMatches.length, 1, 'Remaining: should appear only as count line');
});
