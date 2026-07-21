/**
 * Single source of truth for the overview projection. The overview is produced
 * in three places — serializer `detail` (L9), the read router (L4), and the
 * `spreadsheet-tools` MCP `get_overview` (L3) — so the perimeter-label rules
 * (length, empty-as-`""`, corner duplication) live here ONCE to keep the
 * projections from drifting.
 */

import type { SpreadsheetOverviewDto } from './dto';

/**
 * Enrich a metadata-only overview (dimensions + header flags) with the perimeter
 * header labels read via `cellAt`.
 *
 * `cellAt(r, c)` is 1-based and returns `""` for an empty cell — callers back it
 * with either the sparse DB index (service) or the dense in-memory grid
 * (serializer). Contract:
 *  - `headerRowLabels` is filled IFF `headerRow`, length `= nCols` (row 1).
 *  - `headerColLabels` is filled IFF `headerCol`, length `= nRows` (column 1).
 *  - When both flags are set the corner `(1,1)` feeds both lists' `[0]`, so
 *    `headerRowLabels[0] === headerColLabels[0] === cellAt(1, 1)` by construction.
 */
export function buildOverview(
  base: SpreadsheetOverviewDto,
  cellAt: (r: number, c: number) => string,
): SpreadsheetOverviewDto {
  const overview: SpreadsheetOverviewDto = {
    slug: base.slug,
    name: base.name,
    nRows: base.nRows,
    nCols: base.nCols,
    headerRow: base.headerRow,
    headerCol: base.headerCol,
  };
  if (base.headerRow) {
    overview.headerRowLabels = Array.from({ length: base.nCols }, (_, j) => cellAt(1, j + 1));
  }
  if (base.headerCol) {
    overview.headerColLabels = Array.from({ length: base.nRows }, (_, i) => cellAt(i + 1, 1));
  }
  return overview;
}
