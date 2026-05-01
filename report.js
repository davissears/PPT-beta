/**
 * report.js — convert a Fallow report (as built by mainFlow in index.js)
 * into a structured, numbered checklist for downstream agents and verification.
 *
 * The report shape is:
 *   { directory, timestamp, analyses: { 'dead-code': {success, output, error}, ... } }
 *
 * `output` is expected to be the raw JSON string produced by Fallow. Because
 * Fallow's exact output shape varies, we defensively accept:
 *   - an array of items
 *   - an object with an `issues` / `results` / `findings` array
 *   - an object whose values are arrays
 */

const FILE_KEYS = ['file', 'filename', 'path'];
const LINE_KEYS = ['line', 'lineNumber'];
const MESSAGE_KEYS = ['message', 'description', 'reason'];
const ARRAY_CONTAINER_KEYS = ['issues', 'results', 'findings'];

function firstDefined(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return null;
}

function extractLine(item) {
  const direct = firstDefined(item, LINE_KEYS);
  if (direct !== null) return direct;
  if (item && typeof item === 'object' && item.loc && item.loc.start && item.loc.start.line !== undefined) {
    return item.loc.start.line;
  }
  return null;
}

/**
 * Coerce a parsed-JSON value into a flat list of issue items.
 */
function coerceToItems(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed === null || typeof parsed !== 'object') return [];

  for (const key of ARRAY_CONTAINER_KEYS) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }

  // Fall back: treat as object whose values are arrays. Concatenate every
  // array-valued field, in declaration order.
  const collected = [];
  for (const value of Object.values(parsed)) {
    if (Array.isArray(value)) {
      collected.push(...value);
    }
  }
  return collected;
}

export function summarizeReport(report) {
  const issues = [];
  const countsByKind = {};
  let nextId = 1;

  const analyses = (report && report.analyses) || {};

  for (const kind of Object.keys(analyses)) {
    const entry = analyses[kind];
    if (!entry || entry.success === false) continue;

    let parsed;
    try {
      parsed = JSON.parse(entry.output);
    } catch {
      continue;
    }

    const items = coerceToItems(parsed);
    if (items.length === 0) continue;

    let kindCount = 0;
    for (const raw of items) {
      const file = firstDefined(raw, FILE_KEYS);
      const line = extractLine(raw);
      const message = firstDefined(raw, MESSAGE_KEYS);

      issues.push({
        id: nextId++,
        kind,
        file: file ?? null,
        line: line ?? null,
        message: message ?? null,
        raw,
      });
      kindCount++;
    }

    if (kindCount > 0) countsByKind[kind] = kindCount;
  }

  return {
    issues,
    countsByKind,
    total: issues.length,
  };
}

function padKind(kind, width) {
  if (kind.length >= width) return kind;
  return kind + ' '.repeat(width - kind.length);
}

/**
 * Build a stable key for an issue. Two issues are "the same" when their
 * kind+file+line+message tuples are equal. `null` equals `null`.
 */
function issueKey(issue) {
  return JSON.stringify([
    issue.kind ?? null,
    issue.file ?? null,
    issue.line ?? null,
    issue.message ?? null,
  ]);
}

/**
 * Diff two summary objects (output of summarizeReport). Returns
 * { fixed, remaining, introduced, fixedCount, remainingCount, introducedCount }.
 *
 * - fixed: issues present in `before` but not in `after`
 * - remaining: issues present in both (the `before` instance is preserved so
 *   the original id is reported to the user)
 * - introduced: issues present in `after` but not in `before`
 */
export function diffSummaries(before, after) {
  const beforeIssues = (before && before.issues) || [];
  const afterIssues = (after && after.issues) || [];

  const beforeMap = new Map();
  for (const issue of beforeIssues) {
    beforeMap.set(issueKey(issue), issue);
  }
  const afterMap = new Map();
  for (const issue of afterIssues) {
    afterMap.set(issueKey(issue), issue);
  }

  const fixed = [];
  const remaining = [];
  const introduced = [];

  for (const issue of beforeIssues) {
    const key = issueKey(issue);
    if (afterMap.has(key)) {
      remaining.push(issue);
    } else {
      fixed.push(issue);
    }
  }

  for (const issue of afterIssues) {
    const key = issueKey(issue);
    if (!beforeMap.has(key)) {
      introduced.push(issue);
    }
  }

  return {
    fixed,
    remaining,
    introduced,
    fixedCount: fixed.length,
    remainingCount: remaining.length,
    introducedCount: introduced.length,
  };
}

function formatIssueLine(issue, idLabel) {
  const parts = [`[${idLabel} ${issue.id}]`, issue.kind];
  let location = '';
  if (issue.file) {
    location = issue.line != null ? `${issue.file}:${issue.line}` : issue.file;
  }
  if (location) parts.push(location);
  if (issue.message) parts.push(issue.message);
  return '  ' + parts.join('  ');
}

export function formatDiff(diff) {
  const sections = [];
  sections.push('Verification:');
  sections.push(`  Fixed:       ${diff.fixedCount}`);
  sections.push(`  Remaining:   ${diff.remainingCount}`);
  sections.push(`  Introduced:  ${diff.introducedCount}`);

  if (diff.remaining && diff.remaining.length > 0) {
    sections.push('');
    sections.push('Remaining:');
    for (const issue of diff.remaining) {
      sections.push(formatIssueLine(issue, 'old-id'));
    }
  }

  if (diff.introduced && diff.introduced.length > 0) {
    sections.push('');
    sections.push('Introduced:');
    for (const issue of diff.introduced) {
      sections.push(formatIssueLine(issue, 'new-id'));
    }
  }

  return sections.join('\n');
}

export function formatChecklist(summary) {
  const { total, countsByKind, issues } = summary;
  const kinds = Object.keys(countsByKind);
  const summaryLine =
    kinds.length === 0
      ? ''
      : '  ' + kinds.map((k) => `${k}: ${countsByKind[k]}`).join(', ');

  const header = `Fallow found ${total} issue${total === 1 ? '' : 's'}:`;

  const kindWidth = issues.reduce((max, i) => Math.max(max, i.kind.length), 0);

  const lines = issues.map((issue) => {
    const kindCol = padKind(issue.kind, kindWidth);
    let location = '';
    if (issue.file) {
      location = issue.line != null ? `${issue.file}:${issue.line}` : issue.file;
    }

    const parts = [`[${issue.id}]`, kindCol];
    if (location) parts.push(location);
    if (issue.message) parts.push(issue.message);
    return parts.join('  ');
  });

  const sections = [header];
  if (summaryLine) sections.push(summaryLine);
  if (lines.length > 0) {
    sections.push('');
    sections.push(lines.join('\n'));
  }
  return sections.join('\n');
}

/**
 * Build a checklist string from a flat array of issue objects (the same
 * shape produced by `summarizeReport().issues`). Used for retry rounds
 * where only the remaining (unfixed) issues should be passed to the agent.
 *
 * The returned string starts with a count header, e.g.
 *   "3 issues remaining from previous round:"
 * followed by per-issue lines in the same format as `formatChecklist`.
 */
export function formatChecklistFromIssues(issues) {
  const safe = Array.isArray(issues) ? issues : [];
  const count = safe.length;
  const header = `${count} issue${count === 1 ? '' : 's'} remaining from previous round:`;

  if (count === 0) return header;

  const kindWidth = safe.reduce((max, i) => Math.max(max, (i.kind || '').length), 0);

  const lines = safe.map((issue) => {
    const kindCol = padKind(issue.kind || '', kindWidth);
    let location = '';
    if (issue.file) {
      location = issue.line != null ? `${issue.file}:${issue.line}` : issue.file;
    }

    const parts = [`[${issue.id}]`, kindCol];
    if (location) parts.push(location);
    if (issue.message) parts.push(issue.message);
    return parts.join('  ');
  });

  return [header, '', lines.join('\n')].join('\n');
}
