import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { writeReport } from '../index.js';

test('writeReport creates _ppt-report directory and writes JSON file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-test-'));
  try {
    const report = {
      directory: dir,
      timestamp: new Date().toISOString(),
      analyses: { 'dead-code': { success: true, output: 'ok', error: '' } },
    };

    const reportPath = await writeReport(report, dir);

    // File should be under <dir>/_ppt-report/<timestamp>.json
    const reportDir = path.join(dir, '_ppt-report');
    assert.ok(fs.existsSync(reportDir), '_ppt-report directory should exist');
    assert.ok(fs.statSync(reportDir).isDirectory(), '_ppt-report should be a directory');
    assert.equal(path.dirname(reportPath), reportDir, 'report should live in _ppt-report dir');
    assert.match(path.basename(reportPath), /^\d+\.json$/, 'filename should be <timestamp>.json');

    // Content should be valid JSON containing the report
    const raw = fs.readFileSync(reportPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, report);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeReport creates the _ppt-report directory if it does not exist', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-test-'));
  try {
    const reportDir = path.join(dir, '_ppt-report');
    assert.equal(fs.existsSync(reportDir), false, 'precondition: dir should not exist');

    const report = { directory: dir, timestamp: 'now', analyses: {} };
    await writeReport(report, dir);

    assert.ok(fs.existsSync(reportDir), '_ppt-report directory should be created');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('writeReport does NOT register a process.on(exit) handler that unlinks the file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ppt-test-'));
  try {
    const before = process.listenerCount('exit');
    const report = { directory: dir, timestamp: 'now', analyses: {} };
    const reportPath = await writeReport(report, dir);
    const after = process.listenerCount('exit');

    assert.equal(after, before, 'writeReport should not add exit listeners');

    // Source should not contain an unlink-on-exit handler
    const src = fs.readFileSync(new URL('../index.js', import.meta.url), 'utf8');
    assert.equal(
      /process\.on\(\s*['"]exit['"][\s\S]*unlink/i.test(src),
      false,
      'index.js should not unlink the report on process exit',
    );

    // File should still exist after writeReport returns (not cleaned up)
    assert.ok(fs.existsSync(reportPath), 'report file should persist');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
