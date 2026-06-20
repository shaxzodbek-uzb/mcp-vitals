import type { Colors } from './colors.js';

export interface Column {
  header: string;
  align?: 'left' | 'right';
}

/**
 * Render an aligned text table. Padding is computed on plain text, then color
 * is applied to already-padded cells so ANSI codes never break alignment.
 */
export function renderTable(columns: Column[], rows: string[][], c: Colors): string {
  const widths = columns.map((col, i) => {
    let w = col.header.length;
    for (const row of rows) {
      const cell = row[i] ?? '';
      if (cell.length > w) w = cell.length;
    }
    return w;
  });

  const pad = (text: string, i: number): string => {
    const w = widths[i] ?? text.length;
    const align = columns[i]?.align ?? 'left';
    return align === 'right' ? text.padStart(w) : text.padEnd(w);
  };

  const headerLine = columns.map((col, i) => c.bold(pad(col.header, i))).join('  ');
  const lines = [headerLine];
  for (const row of rows) {
    lines.push(columns.map((_, i) => pad(row[i] ?? '', i)).join('  '));
  }
  return lines.join('\n');
}

/** A "Key: value" header block, keys dimmed. */
export function renderKeyValues(pairs: [string, string][], c: Colors): string {
  const keyWidth = Math.max(0, ...pairs.map(([k]) => k.length));
  return pairs.map(([k, v]) => `${c.dim((k + ':').padEnd(keyWidth + 1))} ${v}`).join('\n');
}

export function formatMs(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(2)} s`;
  if (n >= 100) return `${n.toFixed(0)} ms`;
  return `${n.toFixed(1)} ms`;
}

export function formatPct(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}
