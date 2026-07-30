/**
 * Sparse → dense cell materialization, shared by the two places that need it:
 * `SpreadsheetService` (windowed reads over `ctx.db`) and the L9 serializer
 * (the full grid for `snapshot`, read over `ctx.reader.db`).
 *
 * It lives here rather than in either caller because a drift between them is
 * exactly the class of bug that produced an empty `cells` grid in every
 * snapshot: the service materialized a dense window while the serializer
 * emitted whatever its (wrongly typed) argument happened to carry.
 *
 * The sparse index stores a row ONLY for a non-empty cell, so densifying means
 * filling every absent coordinate with `""`.
 */

/** Map key for a 1-based cell coordinate. */
export const cellKey = (r: number, c: number): string => `${r}:${c}`;

/** A row of the sparse cell index, as read back from SQLite. */
export interface SparseCell {
  r: number;
  c: number;
  value: string;
}

/** Index sparse rows by `"r:c"` for O(1) lookup while densifying. */
export function cellMapOf(rows: Iterable<SparseCell>): Map<string, string> {
  const map = new Map<string, string>();
  for (const cell of rows) map.set(cellKey(cell.r, cell.c), cell.value);
  return map;
}

/**
 * Materialize the 1-based inclusive rectangle `(r1,c1)..(r2,c2)` row-major,
 * absent cells as `""`. Sparse rows outside the rectangle are ignored, so a
 * caller may pass the sheet's whole cell set and have it clamped to the current
 * `nRows × nCols` — which is what keeps a snapshot consistent with a shrink that
 * left out-of-bounds rows behind. An empty rectangle yields `[]`.
 */
export function densify(
  rows: Iterable<SparseCell>,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): string[][] {
  const map = cellMapOf(rows);
  const cells: string[][] = [];
  for (let r = r1; r <= r2; r++) {
    const rowArr: string[] = [];
    for (let c = c1; c <= c2; c++) rowArr.push(map.get(cellKey(r, c)) ?? '');
    cells.push(rowArr);
  }
  return cells;
}
