import { test } from 'node:test';
import assert from 'node:assert/strict';

import { formatChecklistFromIssues } from '../report.js';
import { shouldRetry } from '../index.js';

test('formatChecklistFromIssues includes count line and renders each issue', () => {
  const issues = [
    { id: 1, kind: 'dead-code', file: 'src/x.ts', line: 42, message: 'unused export foo' },
    { id: 2, kind: 'dupes', file: 'src/a.ts', line: null, message: 'dup with b.ts' },
    { id: 3, kind: 'health', file: null, line: null, message: 'too complex' },
  ];
  const text = formatChecklistFromIssues(issues);
  assert.equal(typeof text, 'string');
  assert.ok(
    text.includes('3 issues remaining from previous round'),
    'should contain count header for 3 issues',
  );
  assert.ok(text.includes('[1]'), 'should render [1]');
  assert.ok(text.includes('[2]'), 'should render [2]');
  assert.ok(text.includes('[3]'), 'should render [3]');
  assert.ok(text.includes('dead-code'), 'should include kind dead-code');
  assert.ok(text.includes('dupes'), 'should include kind dupes');
  assert.ok(text.includes('health'), 'should include kind health');
  assert.ok(text.includes('unused export foo'), 'should include message');
  assert.ok(text.includes('src/x.ts:42'), 'should include file:line');
  assert.ok(!text.includes('null'), 'should not include literal "null"');
});

test('formatChecklistFromIssues uses singular form when one issue', () => {
  const issues = [
    { id: 1, kind: 'health', file: 'src/c.ts', line: 10, message: 'too complex' },
  ];
  const text = formatChecklistFromIssues(issues);
  assert.ok(
    text.includes('1 issue remaining from previous round'),
    'should use singular wording for one issue',
  );
});

test('formatChecklistFromIssues handles empty array', () => {
  const text = formatChecklistFromIssues([]);
  assert.equal(typeof text, 'string');
  assert.ok(
    text.includes('0 issues remaining from previous round'),
    'should still include count header',
  );
});

test('shouldRetry stops when remainingCount is 0', () => {
  const decision = shouldRetry({
    remainingCount: 0,
    prevRemainingCount: 5,
    round: 1,
    maxRounds: 3,
    userConfirmed: true,
  });
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, 'no-remaining');
});

test('shouldRetry stops when user declines', () => {
  const decision = shouldRetry({
    remainingCount: 4,
    prevRemainingCount: 6,
    round: 1,
    maxRounds: 3,
    userConfirmed: false,
  });
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, 'user-declined');
});

test('shouldRetry stops when no progress (remainingCount did not decrease)', () => {
  const decision = shouldRetry({
    remainingCount: 5,
    prevRemainingCount: 5,
    round: 1,
    maxRounds: 3,
    userConfirmed: true,
  });
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, 'no-progress');
});

test('shouldRetry stops when remainingCount increases', () => {
  const decision = shouldRetry({
    remainingCount: 7,
    prevRemainingCount: 5,
    round: 1,
    maxRounds: 3,
    userConfirmed: true,
  });
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, 'no-progress');
});

test('shouldRetry stops when at maxRounds', () => {
  const decision = shouldRetry({
    remainingCount: 3,
    prevRemainingCount: 5,
    round: 3,
    maxRounds: 3,
    userConfirmed: true,
  });
  assert.equal(decision.retry, false);
  assert.equal(decision.reason, 'max-rounds');
});

test('shouldRetry continues when there is progress, user confirms, and rounds remain', () => {
  const decision = shouldRetry({
    remainingCount: 3,
    prevRemainingCount: 5,
    round: 1,
    maxRounds: 3,
    userConfirmed: true,
  });
  assert.equal(decision.retry, true);
});

test('shouldRetry continues at round 2 of 3 with progress and confirmation', () => {
  const decision = shouldRetry({
    remainingCount: 1,
    prevRemainingCount: 3,
    round: 2,
    maxRounds: 3,
    userConfirmed: true,
  });
  assert.equal(decision.retry, true);
});
