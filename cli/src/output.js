// Output helpers: color only on a terminal (and never with NO_COLOR), tables, JSON.

export function styles(stream, env) {
  const on = !!stream.isTTY && !env.NO_COLOR && env.TERM !== "dumb";
  const wrap = (code) => (s) => (on ? `\u001b[${code}m${s}\u001b[0m` : String(s));
  return { bold: wrap(1), dim: wrap(2), red: wrap(31), green: wrap(32), yellow: wrap(33), cyan: wrap(36) };
}

/** A plain text table: header row, then rows, columns padded to fit. */
export function table(headers, rows) {
  const all = [headers, ...rows].map((r) => r.map((c) => String(c ?? "")));
  const widths = headers.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]))).join("  ");
  return [line(all[0]), line(widths.map((w) => "-".repeat(w))), ...all.slice(1).map(line)].join("\n");
}

export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

export function when(ms) {
  if (!ms) return "never";
  return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
}
