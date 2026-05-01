import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summarizeReport, formatChecklist } from '../report.js';
import { PRESETS } from '../agents.js';
import { DEFAULT_CONFIG } from '../config.js';

function makeReport(analyses) {
  return {
    directory: '/tmp/foo',
    timestamp: '2026-05-01T00:00:00Z',
    analyses,
  };
}

test('summarizeReport assigns 1-based contiguous ids in dead-code/dupes/health order with correct counts', () => {
  const report = makeReport({
    'dead-code': {
      success: true,
      output: JSON.stringify([
        { file: 'src/x.ts', line: 42, message: 'unused export foo' },
        { file: 'src/y.ts', line: 1, message: 'unused import bar' },
      ]),
      error: '',
    },
    'dupes': {
      success: true,
      output: JSON.stringify({
        issues: [{ path: 'src/a.ts', message: 'duplicated logic with src/b.ts' }],
      }),
      error: '',
    },
    'health': {
      success: true,
      output: JSON.stringify({
        findings: [
          { filename: 'src/c.ts', lineNumber: 10, description: 'too complex' },
          { filename: 'src/c.ts', lineNumber: 22, description: 'too long' },
        ],
      }),
      error: '',
    },
  });

  const summary = summarizeReport(report);

  assert.equal(summary.total, 5);
  assert.deepEqual(summary.countsByKind, {
    'dead-code': 2,
    'dupes': 1,
    'health': 2,
  });

  assert.equal(summary.issues.length, 5);
  assert.deepEqual(
    summary.issues.map((i) => i.id),
    [1, 2, 3, 4, 5],
  );

  assert.equal(summary.issues[0].kind, 'dead-code');
  assert.equal(summary.issues[0].file, 'src/x.ts');
  assert.equal(summary.issues[0].line, 42);
  assert.equal(summary.issues[0].message, 'unused export foo');
  assert.deepEqual(summary.issues[0].raw, {
    file: 'src/x.ts',
    line: 42,
    message: 'unused export foo',
  });

  assert.equal(summary.issues[2].kind, 'dupes');
  assert.equal(summary.issues[2].file, 'src/a.ts');
  assert.equal(summary.issues[2].line, null);

  assert.equal(summary.issues[3].kind, 'health');
  assert.equal(summary.issues[3].file, 'src/c.ts');
  assert.equal(summary.issues[3].line, 10);
  assert.equal(summary.issues[3].message, 'too complex');
});

test('summarizeReport skips kinds where success=false', () => {
  const report = makeReport({
    'dead-code': {
      success: false,
      output: '',
      error: 'boom',
    },
    'dupes': {
      success: true,
      output: JSON.stringify([{ file: 'src/a.ts', message: 'dup' }]),
      error: '',
    },
  });

  const summary = summarizeReport(report);
  assert.equal(summary.total, 1);
  assert.equal(summary.countsByKind['dead-code'], undefined);
  assert.equal(summary.countsByKind['dupes'], 1);
  assert.equal(summary.issues[0].kind, 'dupes');
  assert.equal(summary.issues[0].id, 1);
});

test('summarizeReport silently skips kinds whose output cannot be parsed as JSON', () => {
  const report = makeReport({
    'dead-code': {
      success: true,
      output: 'not json at all {{{',
      error: '',
    },
    'health': {
      success: true,
      output: JSON.stringify([{ file: 'src/c.ts', line: 1, message: 'h' }]),
      error: '',
    },
  });

  const summary = summarizeReport(report);
  assert.equal(summary.total, 1);
  assert.equal(summary.issues[0].kind, 'health');
});

test('summarizeReport handles array shape', () => {
  const report = makeReport({
    'dead-code': {
      success: true,
      output: JSON.stringify([
        { file: 'a.ts', line: 1, message: 'm1' },
        { file: 'b.ts', line: 2, message: 'm2' },
      ]),
      error: '',
    },
  });
  const summary = summarizeReport(report);
  assert.equal(summary.total, 2);
});

test('summarizeReport handles {issues: [...]} shape', () => {
  const report = makeReport({
    'dupes': {
      success: true,
      output: JSON.stringify({
        issues: [
          { file: 'a.ts', line: 1, message: 'm1' },
          { file: 'b.ts', line: 2, message: 'm2' },
        ],
      }),
      error: '',
    },
  });
  const summary = summarizeReport(report);
  assert.equal(summary.total, 2);
  assert.equal(summary.issues[0].file, 'a.ts');
});

test('summarizeReport handles {findings: [...]} shape', () => {
  const report = makeReport({
    'health': {
      success: true,
      output: JSON.stringify({
        findings: [
          { file: 'a.ts', line: 1, message: 'm1' },
          { file: 'b.ts', line: 2, message: 'm2' },
          { file: 'c.ts', line: 3, message: 'm3' },
        ],
      }),
      error: '',
    },
  });
  const summary = summarizeReport(report);
  assert.equal(summary.total, 3);
});

test('summarizeReport handles {results: [...]} shape', () => {
  const report = makeReport({
    'health': {
      success: true,
      output: JSON.stringify({
        results: [{ file: 'a.ts', line: 1, message: 'm1' }],
      }),
      error: '',
    },
  });
  const summary = summarizeReport(report);
  assert.equal(summary.total, 1);
});

test('summarizeReport handles object whose values are arrays', () => {
  const report = makeReport({
    'dead-code': {
      success: true,
      output: JSON.stringify({
        groupA: [{ file: 'a.ts', line: 1, message: 'm1' }],
        groupB: [{ file: 'b.ts', line: 2, message: 'm2' }],
      }),
      error: '',
    },
  });
  const summary = summarizeReport(report);
  assert.equal(summary.total, 2);
});

test('summarizeReport sets missing fields to null', () => {
  const report = makeReport({
    'health': {
      success: true,
      output: JSON.stringify([{ somethingElse: true }]),
      error: '',
    },
  });
  const summary = summarizeReport(report);
  assert.equal(summary.total, 1);
  assert.equal(summary.issues[0].file, null);
  assert.equal(summary.issues[0].line, null);
  assert.equal(summary.issues[0].message, null);
  assert.deepEqual(summary.issues[0].raw, { somethingElse: true });
});

test('summarizeReport supports loc.start.line', () => {
  const report = makeReport({
    'dead-code': {
      success: true,
      output: JSON.stringify([
        { file: 'a.ts', loc: { start: { line: 99 } }, message: 'm' },
      ]),
      error: '',
    },
  });
  const summary = summarizeReport(report);
  assert.equal(summary.issues[0].line, 99);
});

test('formatChecklist contains [1], kind names, and total count', () => {
  const summary = {
    total: 3,
    countsByKind: { 'dead-code': 1, 'dupes': 1, 'health': 1 },
    issues: [
      { id: 1, kind: 'dead-code', file: 'src/x.ts', line: 42, message: 'unused export foo' },
      { id: 2, kind: 'dupes', file: 'src/a.ts', line: null, message: 'dup with b.ts' },
      { id: 3, kind: 'health', file: null, line: null, message: 'function bar is too complex' },
    ],
  };
  const text = formatChecklist(summary);
  assert.ok(text.includes('[1]'), 'checklist should include [1]');
  assert.ok(text.includes('[2]'), 'checklist should include [2]');
  assert.ok(text.includes('[3]'), 'checklist should include [3]');
  assert.ok(text.includes('dead-code'), 'checklist should include dead-code');
  assert.ok(text.includes('dupes'), 'checklist should include dupes');
  assert.ok(text.includes('health'), 'checklist should include health');
  assert.ok(text.includes('3'), 'checklist should include total count');
  assert.ok(text.includes('unused export foo'), 'checklist should include the message');
  // When file is null, line:file should be omitted
  assert.ok(!text.includes('null'), 'checklist should not include the literal "null"');
});

test('formatChecklist omits :line when line is null but file exists', () => {
  const summary = {
    total: 1,
    countsByKind: { 'dupes': 1 },
    issues: [
      { id: 1, kind: 'dupes', file: 'src/a.ts', line: null, message: 'm' },
    ],
  };
  const text = formatChecklist(summary);
  assert.ok(text.includes('src/a.ts'), 'should include file');
  assert.ok(!text.includes('src/a.ts:'), 'should not include trailing colon when line is null');
});

test('every PRESETS entry prompt contains {checklist} placeholder', () => {
  for (const preset of PRESETS) {
    assert.ok(
      preset.prompt.includes('{checklist}'),
      `PRESETS[${preset.name}] must contain {checklist} placeholder`,
    );
  }
});

test('DEFAULT_CONFIG.agent.prompt contains {checklist} placeholder', () => {
  assert.ok(
    DEFAULT_CONFIG.agent.prompt.includes('{checklist}'),
    'DEFAULT_CONFIG.agent.prompt must contain {checklist} placeholder',
  );
});
