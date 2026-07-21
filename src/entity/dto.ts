/**
 * DTOs of the `spreadsheet` data model. All indices are 1-based and inclusive.
 *
 * Overview-first: the cheap `SpreadsheetOverviewDto` (dimensions + header flags +
 * perimeter header labels, no body cells) is the entry point; body cell content
 * is fetched by ranges (`SpreadsheetRangeDto`) or single points
 * (`SpreadsheetCellDto`). The dense `SpreadsheetSnapshot` is the full projection
 * used by `snapshot()` / `restore()` and as the entity object the host resolves
 * for the serializer.
 */

/**
 * Cheap sheet skeleton: dimensions + header flags + perimeter header labels,
 * NEVER body cells. Output of the serializer `detail` projection and of
 * `GET /:slug/overview`.
 */
export interface SpreadsheetOverviewDto {
  /** PK = `slugify(name)`. */
  slug: string;
  name: string;
  nRows: number;
  nCols: number;
  headerRow: boolean;
  headerCol: boolean;
  /**
   * Labels of row 1 — present IFF `headerRow === true`; length `= nCols`.
   * Markdown strings; an empty header cell is `""`. When both flags are `true`
   * the corner cell (1,1) is duplicated: `headerRowLabels[0] === headerColLabels[0]`.
   */
  headerRowLabels?: string[];
  /**
   * Labels of column 1 — present IFF `headerCol === true`; length `= nRows`.
   * Markdown strings; an empty header cell is `""`. See the corner-duplication
   * note on `headerRowLabels`.
   */
  headerColLabels?: string[];
}

/**
 * A rectangular window of cells. Indices are 1-based inclusive (SQL `BETWEEN`).
 * `cells` is row-major and DENSE within the window — empty cells are `""`.
 */
export interface SpreadsheetRangeDto {
  slug: string;
  /** First row (1-based, inclusive). */
  r1: number;
  /** First column (1-based, inclusive). */
  c1: number;
  /** Last row (1-based, inclusive). */
  r2: number;
  /** Last column (1-based, inclusive). */
  c2: number;
  /** Row-major window; empty cells as `""`. */
  cells: string[][];
}

/**
 * A single cell — point read/write. `value === ""` means empty: on write it
 * deletes the cell's row from the sparse index.
 */
export interface SpreadsheetCellDto {
  slug: string;
  /** 1-based. */
  r: number;
  /** 1-based. */
  c: number;
  value: string;
}

/**
 * Full, dense sheet projection: metadata + `cells: string[][]` (one array per
 * row, `nRows`×`nCols`, empty cells as `""`). Doubles as the `snapshot()` output
 * / `restore()` input and as the entity object the host resolves for the
 * serializer. `snapshot()` emits it with a STABLE key order (determinism).
 */
export interface SpreadsheetSnapshot {
  slug: string;
  name: string;
  nRows: number;
  nCols: number;
  headerRow: boolean;
  headerCol: boolean;
  /** Row-major dense grid, `nRows`×`nCols`; empty cells as `""`. */
  cells: string[][];
}

/** Create body. `slug` is NOT accepted — it is `slugify(name)`. */
export interface CreateSpreadsheetRequest {
  name: string;
  nRows?: number;
  nCols?: number;
  headerRow?: boolean;
  headerCol?: boolean;
}

/** Metadata update body. A name change does NOT move the slug; use `newSlug`. */
export interface UpdateSpreadsheetRequest {
  name?: string;
  nRows?: number;
  nCols?: number;
  headerRow?: boolean;
  headerCol?: boolean;
  /** Explicit rename — repoints page references and FKs. */
  newSlug?: string;
}

/** List projection — lightweight metadata (dimensions + flags, no cells). */
export interface SpreadsheetListItem {
  slug: string;
  name: string;
  nRows: number;
  nCols: number;
  headerRow: boolean;
  headerCol: boolean;
  tags?: string[];
}
