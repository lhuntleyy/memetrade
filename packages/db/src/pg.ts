/**
 * Literal array teks Postgres (`{"a","b"}`) — Bun.SQL mengirim array JS kosong sebagai string kosong
 * (error "malformed array literal"), jadi kolom text[] diisi lewat literal ini.
 */
export function pgTextArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;
}
