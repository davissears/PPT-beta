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
