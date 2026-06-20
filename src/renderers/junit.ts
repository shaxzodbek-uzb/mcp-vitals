import type { CheckRow, CheckSummary } from '../types.js';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Render check results as JUnit XML (one <testcase> per assertion). */
export function renderJUnit(rows: CheckRow[], summary: CheckSummary): string {
  const seconds = (summary.durationMs / 1000).toFixed(3);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<testsuites name="mcp-vitals" tests="${rows.length}" failures="${summary.failed}" skipped="${summary.skipped}" time="${seconds}">`,
  );
  lines.push(
    `  <testsuite name="mcp-vitals" tests="${rows.length}" failures="${summary.failed}" skipped="${summary.skipped}" time="${seconds}">`,
  );
  for (const row of rows) {
    const name = escapeXml(row.id);
    const cls = `mcp-vitals.${row.kind}`;
    lines.push(`    <testcase name="${name}" classname="${escapeXml(cls)}" time="0">`);
    if (row.status === 'fail') {
      const msg = escapeXml(`${row.target}: expected ${row.expected}, got ${row.actual}`);
      lines.push(`      <failure message="${msg}">${msg}</failure>`);
    } else if (row.status === 'skip') {
      lines.push('      <skipped/>');
    }
    lines.push('    </testcase>');
  }
  lines.push('  </testsuite>');
  lines.push('</testsuites>');
  return lines.join('\n');
}
