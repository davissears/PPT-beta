const FILE_KEYS = ['file', 'filename', 'path'];
const LINE_KEYS = ['line', 'lineNumber'];
const MESSAGE_KEYS = ['message', 'description', 'reason'];
const ARRAY_CONTAINER_KEYS = ['issues', 'results', 'findings'];

function firstDefined(obj, keys) {
  if (obj == null || typeof obj !== 'object') return null;
  const k = keys.find((key) => obj[key] != null);
  return k !== undefined ? obj[k] : null;
}

function locStart(item) {
  return item && item.loc && item.loc.start;
}

function extractLine(item) {
  const direct = firstDefined(item, LINE_KEYS);
  if (direct !== null) return direct;
  const start = locStart(item);
  return (start && start.line !== undefined) ? start.line : null;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function findArrayContainer(parsed) {
  for (const key of ARRAY_CONTAINER_KEYS) {
    if (Array.isArray(parsed[key])) return parsed[key];
  }
  return null;
}

function collectArrayValues(parsed) {
  const collected = [];
  for (const value of Object.values(parsed)) {
    if (Array.isArray(value)) collected.push(...value);
  }
  return collected;
}

function coerceToItems(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (!isPlainObject(parsed)) return [];
  return findArrayContainer(parsed) ?? collectArrayValues(parsed);
}

function parseAnalysisOutput(entry) {
  if (!entry || entry.success === false) return null;
  try {
    return JSON.parse(entry.output);
  } catch {
    return null;
  }
}

function mapItem(raw, kind, id) {
  return {
    id,
    kind,
    file: firstDefined(raw, FILE_KEYS),
    line: extractLine(raw),
    message: firstDefined(raw, MESSAGE_KEYS),
    raw,
  };
}

function processKind(analyses, kind, issues, countsByKind, nextId) {
  const parsed = parseAnalysisOutput(analyses[kind]);
  if (!parsed) return nextId;
  const items = coerceToItems(parsed);
  if (items.length === 0) return nextId;
  for (const raw of items) {
    issues.push(mapItem(raw, kind, nextId++));
  }
  countsByKind[kind] = items.length;
  return nextId;
}

export function summarizeReport(report) {
  const issues = [];
  const countsByKind = {};
  let nextId = 1;
  const analyses = (report && report.analyses) || {};
  for (const kind of Object.keys(analyses)) {
    nextId = processKind(analyses, kind, issues, countsByKind, nextId);
  }
  return { issues, countsByKind, total: issues.length };
}

function padKind(kind, width) {
  if (kind.length >= width) return kind;
  return kind + ' '.repeat(width - kind.length);
}

function issueKey(issue) {
  return JSON.stringify([issue.kind, issue.file, issue.line, issue.message]);
}

function extractIssues(summary) {
  return (summary && summary.issues) || [];
}

function buildIssueMap(issues) {
  const map = new Map();
  for (const issue of issues) {
    map.set(issueKey(issue), issue);
  }
  return map;
}

function partitionByMap(issues, map) {
  const hit = [];
  const miss = [];
  for (const issue of issues) {
    if (map.has(issueKey(issue))) hit.push(issue);
    else miss.push(issue);
  }
  return { hit, miss };
}

export function diffSummaries(before, after) {
  const beforeIssues = extractIssues(before);
  const afterIssues = extractIssues(after);
  const beforeMap = buildIssueMap(beforeIssues);
  const afterMap = buildIssueMap(afterIssues);
  const { hit: remaining, miss: fixed } = partitionByMap(beforeIssues, afterMap);
  const { miss: introduced } = partitionByMap(afterIssues, beforeMap);
  return {
    fixed,
    remaining,
    introduced,
    fixedCount: fixed.length,
    remainingCount: remaining.length,
    introducedCount: introduced.length,
  };
}

function issueLocation(issue) {
  if (!issue.file) return '';
  return issue.line != null ? `${issue.file}:${issue.line}` : issue.file;
}

function formatIssueLine(issue, idLabel) {
  const parts = [`[${idLabel} ${issue.id}]`, issue.kind];
  const location = issueLocation(issue);
  if (location) parts.push(location);
  if (issue.message) parts.push(issue.message);
  return '  ' + parts.join('  ');
}

const ANSI = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function wrap(code, text) {
  return `${code}${text}${ANSI.reset}`;
}

function colorCount(count, zeroCode, nonZeroCode, str) {
  return count > 0 ? wrap(nonZeroCode, str) : wrap(zeroCode, str);
}

function formatCountLines(diff, color) {
  const fStr = String(diff.fixedCount);
  const rStr = String(diff.remainingCount);
  const iStr = String(diff.introducedCount);
  if (!color) {
    return [
      `  Fixed:       ${fStr}`,
      `  Remaining:   ${rStr}`,
      `  Introduced:  ${iStr}`,
    ];
  }
  return [
    `  Fixed:       ${wrap(ANSI.green, fStr)}`,
    `  Remaining:   ${colorCount(diff.remainingCount, ANSI.dim, ANSI.yellow, rStr)}`,
    `  Introduced:  ${colorCount(diff.introducedCount, ANSI.dim, ANSI.red, iStr)}`,
  ];
}

function appendIssueSection(sections, issues, label, idLabel) {
  if (!issues || issues.length === 0) return;
  sections.push('');
  sections.push(label);
  for (const issue of issues) {
    sections.push(formatIssueLine(issue, idLabel));
  }
}

export function formatDiff(diff, { color = false } = {}) {
  const sections = ['Verification:', ...formatCountLines(diff, color)];
  appendIssueSection(sections, diff.remaining, 'Remaining:', 'old-id');
  appendIssueSection(sections, diff.introduced, 'Introduced:', 'new-id');
  return sections.join('\n');
}

function normalizeCounts(counts) {
  return counts != null && typeof counts === 'object' ? counts : {};
}

function formatKindLine(kind, kindWidth, count) {
  return `  ${padKind(`${kind}:`, kindWidth)} ${count}`;
}

function formatMetaLines(agentName, command, dir, reportPath, color) {
  const sendingTo = `Sending to: ${agentName}${command ? ` (${command})` : ''}`;
  const mayDim = (s) => color ? wrap(ANSI.dim, s) : s;
  return [sendingTo, mayDim(`Working directory: ${dir}`), mayDim(`Report: ${reportPath}`)];
}

export function formatPreAgentSummary(
  { counts, total, agentName, command, dir, reportPath },
  { color = false } = {},
) {
  const safeCounts = normalizeCounts(counts);
  const kinds = Object.keys(safeCounts);
  const kindWidth = kinds.reduce((max, k) => Math.max(max, k.length + 1), 0);
  const heading = `Found ${total} issue${total === 1 ? '' : '(s)'}:`;
  const lines = [color ? wrap(ANSI.bold, heading) : heading];
  for (const kind of kinds) {
    lines.push(formatKindLine(kind, kindWidth, safeCounts[kind]));
  }
  lines.push('', ...formatMetaLines(agentName, command, dir, reportPath, color));
  return lines.join('\n');
}

function issueChecklistLine(issue, kindWidth) {
  const kindCol = padKind(issue.kind || '', kindWidth);
  const location = issueLocation(issue);
  const parts = [`[${issue.id}]`, kindCol];
  if (location) parts.push(location);
  if (issue.message) parts.push(issue.message);
  return parts.join('  ');
}

function buildChecklist(header, countsByKind, lines) {
  const kinds = Object.keys(countsByKind);
  const summaryLine = kinds.length === 0
    ? ''
    : '  ' + kinds.map((k) => `${k}: ${countsByKind[k]}`).join(', ');
  const sections = [header];
  if (summaryLine) sections.push(summaryLine);
  if (lines.length > 0) {
    sections.push('');
    sections.push(lines.join('\n'));
  }
  return sections.join('\n');
}

export function formatChecklist(summary) {
  const { total, countsByKind, issues } = summary;
  const header = `Fallow found ${total} issue${total === 1 ? '' : 's'}:`;
  const kindWidth = issues.reduce((max, i) => Math.max(max, i.kind.length), 0);
  const lines = issues.map((issue) => issueChecklistLine(issue, kindWidth));
  return buildChecklist(header, countsByKind, lines);
}

export function formatChecklistFromIssues(issues) {
  const safe = Array.isArray(issues) ? issues : [];
  const count = safe.length;
  const header = `${count} issue${count === 1 ? '' : 's'} remaining from previous round:`;
  if (count === 0) return header;
  const kindWidth = safe.reduce((max, i) => Math.max(max, (i.kind || '').length), 0);
  const lines = safe.map((issue) => issueChecklistLine(issue, kindWidth));
  return [header, '', lines.join('\n')].join('\n');
}
