/**
 * Domain service for `spreadsheet` — the working store over the derived SQLite
 * index (`ctx.db`, better-sqlite3). Two tables back it: `spreadsheet` (metadata)
 * and `spreadsheet_cell` (a SPARSE cell index — a row exists only for a non-empty
 * cell; `""` is never stored).
 *
 * Overview-first: `overview()` is a metadata-only read (cheap) and is the entry
 * point; cell content is read by ranges. The dense grid (`getBySlug` / `snapshot`)
 * is materialized only for full-sheet operations (serializer resolution, snapshot,
 * versioning).
 *
 * Index rules (observable ACs):
 *  - `slug = slugify(name)` on create, suffixed `-2`/`-3`… to stay unique; `name`
 *    required (`ac-utworzenie-arkusza-wymaga-name`).
 *  - setting a cell to `""` deletes its row (`ac-ustawienie-komorki-wartoscia-usuwa-je`).
 *  - resize changes only `n_rows`/`n_cols`, never cell rows (`ac-resize-grow-...`).
 *  - insert/delete of a row or column reindexes `r`/`c` of remaining cells
 *    (`ac-wstawienie-lub-usuniecie-wiersza-kolumny`).
 *  - `snapshot()` is deterministic (`ac-snapshot-...`); `restore()` is an idempotent
 *    UPSERT skipping `""` (`ac-restore-jest-idempotentnym-upsert`).
 */

import type { MountContext } from '@c4s/plugin-runtime';
import {
  SPREADSHEET_TABLE,
  SPREADSHEET_CELL_TABLE,
  SPREADSHEET_TYPE,
  slugify,
} from '../../identity';
import type {
  CreateSpreadsheetRequest,
  SpreadsheetListItem,
  SpreadsheetOverviewDto,
  SpreadsheetRangeDto,
  SpreadsheetSnapshot,
  UpdateSpreadsheetRequest,
} from '../dto';
import { buildOverview } from '../overview';

type Actor = 'user' | 'agent';

const SERIALIZER_VERSION = '1.0.0';

/** A row of the `spreadsheet` metadata table (snake_case, booleans as 0/1). */
interface SpreadsheetRow {
  slug: string;
  name: string;
  n_rows: number;
  n_cols: number;
  header_row: number;
  header_col: number;
}

/** A row of the sparse `spreadsheet_cell` index. */
interface CellRow {
  slug: string;
  r: number;
  c: number;
  value: string;
}

export interface SpreadsheetListQuery {
  tags?: string[];
  filter?: 'and' | 'or';
}

function toOverview(row: SpreadsheetRow): SpreadsheetOverviewDto {
  return {
    slug: row.slug,
    name: row.name,
    nRows: row.n_rows,
    nCols: row.n_cols,
    headerRow: row.header_row !== 0,
    headerCol: row.header_col !== 0,
  };
}

const cellKey = (r: number, c: number): string => `${r}:${c}`;

export class SpreadsheetService {
  constructor(
    private readonly db: MountContext['db'],
    private readonly ctx: MountContext,
  ) {}

  // ── Metadata reads ──────────────────────────────────────────────────────

  private metaRow(slug: string): SpreadsheetRow | undefined {
    return this.db
      .prepare(`SELECT * FROM ${SPREADSHEET_TABLE} WHERE slug = ?`)
      .get(slug) as SpreadsheetRow | undefined;
  }

  /**
   * Cheap skeleton: dimensions + header flags + perimeter header labels (row 1 /
   * column 1), NEVER body cells. Labels are a projection of the existing header
   * cells, read here via a single shared builder so the endpoint (L4) and the MCP
   * `get_overview` (L3) — both of which call this — can't drift. When neither
   * header flag is set no cell reads happen at all.
   */
  overview(slug: string): SpreadsheetOverviewDto | null {
    const row = this.metaRow(slug);
    if (!row) return null;
    const base = toOverview(row);
    if (!base.headerRow && !base.headerCol) return base;
    return buildOverview(base, this.perimeterAccessor(slug, base));
  }

  /**
   * A 1-based `cellAt` over just the perimeter (header row 1 and/or header
   * column 1), prefetched in one query per axis. Absent (empty) cells read as
   * `""`. Only the axes whose header flag is set are read.
   */
  private perimeterAccessor(
    slug: string,
    base: SpreadsheetOverviewDto,
  ): (r: number, c: number) => string {
    const map = new Map<string, string>();
    if (base.headerRow && base.nCols > 0) {
      for (const [k, v] of this.cellMap(slug, 1, 1, 1, base.nCols)) map.set(k, v);
    }
    if (base.headerCol && base.nRows > 0) {
      for (const [k, v] of this.cellMap(slug, 1, 1, base.nRows, 1)) map.set(k, v);
    }
    return (r, c) => map.get(cellKey(r, c)) ?? '';
  }

  // ── Cell reads ──────────────────────────────────────────────────────────

  /** Map of "r:c" → value for cells inside a 1-based inclusive rectangle. */
  private cellMap(slug: string, r1: number, c1: number, r2: number, c2: number): Map<string, string> {
    const rows = this.db
      .prepare(
        `SELECT r, c, value FROM ${SPREADSHEET_CELL_TABLE}
          WHERE slug = ? AND r BETWEEN ? AND ? AND c BETWEEN ? AND ?`,
      )
      .all(slug, r1, r2, c1, c2) as Array<Pick<CellRow, 'r' | 'c' | 'value'>>;
    const map = new Map<string, string>();
    for (const cell of rows) map.set(cellKey(cell.r, cell.c), cell.value);
    return map;
  }

  /** Materialize a dense window (empties as `""`) for a 1-based inclusive range. */
  private denseWindow(
    slug: string,
    r1: number,
    c1: number,
    r2: number,
    c2: number,
  ): string[][] {
    const map = this.cellMap(slug, r1, c1, r2, c2);
    const cells: string[][] = [];
    for (let r = r1; r <= r2; r++) {
      const rowArr: string[] = [];
      for (let c = c1; c <= c2; c++) rowArr.push(map.get(cellKey(r, c)) ?? '');
      cells.push(rowArr);
    }
    return cells;
  }

  /**
   * Rectangular window. Indices are 1-based inclusive → SQL `BETWEEN`
   * (`ac-odczyt-zakresu-przyjmuje-indeksy-1-based`). Returns `null` if the sheet
   * does not exist. Range bounds are echoed back verbatim.
   */
  getRange(slug: string, r1: number, c1: number, r2: number, c2: number): SpreadsheetRangeDto | null {
    const meta = this.metaRow(slug);
    if (!meta) return null;
    return { slug, r1, c1, r2, c2, cells: this.denseWindow(slug, r1, c1, r2, c2) };
  }

  /** Full rows `from..to` across the whole width `n_cols`. */
  getRows(slug: string, from: number, to: number): SpreadsheetRangeDto | null {
    const meta = this.metaRow(slug);
    if (!meta) return null;
    return this.getRange(slug, from, 1, to, meta.n_cols);
  }

  /** Full columns `from..to` across the whole height `n_rows`. */
  getColumns(slug: string, from: number, to: number): SpreadsheetRangeDto | null {
    const meta = this.metaRow(slug);
    if (!meta) return null;
    return this.getRange(slug, 1, from, meta.n_rows, to);
  }

  /** Full dense snapshot: metadata + `nRows`×`nCols` grid, deterministic. */
  getBySlug(slug: string): SpreadsheetSnapshot | null {
    const meta = this.metaRow(slug);
    if (!meta) return null;
    const ov = toOverview(meta);
    const cells =
      meta.n_rows > 0 && meta.n_cols > 0
        ? this.denseWindow(slug, 1, 1, meta.n_rows, meta.n_cols)
        : [];
    return { ...ov, cells };
  }

  /** Alias — the host duck-types `getBySlug` for tags/versions/detail resolution. */
  snapshot(slug: string): SpreadsheetSnapshot | null {
    return this.getBySlug(slug);
  }

  // ── Mutations ───────────────────────────────────────────────────────────

  /**
   * Free slug for a fresh sheet: `slugify(name)`, then suffix `-2`, `-3`… until it
   * doesn't collide with an existing PK. `slug` is never accepted from the caller.
   * Must be called INSIDE the create transaction so the probe + insert are atomic.
   */
  private uniqueSlug(base: string): string {
    let candidate = base;
    let n = 2;
    while (this.db.prepare(`SELECT 1 FROM ${SPREADSHEET_TABLE} WHERE slug = ?`).get(candidate)) {
      candidate = `${base}-${n}`;
      n += 1;
    }
    return candidate;
  }

  /**
   * Create: `slug = uniqueSlug(slugify(name))` — dedupes so two sheets whose names
   * slugify alike (or a retry of the same name) don't hit the `slug` PK. Slug
   * derivation, the INSERT, and version capture run in ONE transaction: if version
   * capture throws, the row rolls back rather than leaving a committed orphan that
   * would collide on the next attempt. Broadcast (a WS push, not a DB write) runs
   * only after the transaction commits.
   */
  create(input: CreateSpreadsheetRequest, actor: Actor = 'user'): SpreadsheetSnapshot {
    const apply = this.db.transaction((): string => {
      const slug = this.uniqueSlug(slugify(input.name));
      this.db
        .prepare(
          `INSERT INTO ${SPREADSHEET_TABLE} (slug, name, n_rows, n_cols, header_row, header_col)
           VALUES (@slug, @name, @n_rows, @n_cols, @header_row, @header_col)`,
        )
        .run({
          slug,
          name: input.name,
          n_rows: input.nRows ?? 0,
          n_cols: input.nCols ?? 0,
          header_row: input.headerRow ? 1 : 0,
          header_col: input.headerCol ? 1 : 0,
        });
      this.captureVersion(slug, 'create', actor, 'Created');
      return slug;
    });
    const slug = apply();
    this.broadcast(slug);
    return this.getBySlug(slug)!;
  }

  /** Metadata update. `name` change does NOT move the slug; rename via `newSlug`. */
  update(
    slug: string,
    patch: UpdateSpreadsheetRequest,
    actor: Actor = 'user',
  ): { snapshot: SpreadsheetSnapshot; previousSlug: string } | null {
    const existing = this.metaRow(slug);
    if (!existing) return null;

    const renaming = typeof patch.newSlug === 'string' && patch.newSlug.trim().length > 0;
    const targetSlug = renaming ? slugify(patch.newSlug as string) : slug;

    const next = {
      slug,
      targetSlug,
      name: patch.name ?? existing.name,
      n_rows: patch.nRows ?? existing.n_rows,
      n_cols: patch.nCols ?? existing.n_cols,
      header_row: patch.headerRow !== undefined ? (patch.headerRow ? 1 : 0) : existing.header_row,
      header_col: patch.headerCol !== undefined ? (patch.headerCol ? 1 : 0) : existing.header_col,
    };

    const apply = this.db.transaction(() => {
      this.db
        .prepare(
          `UPDATE ${SPREADSHEET_TABLE}
              SET slug = @targetSlug, name = @name, n_rows = @n_rows, n_cols = @n_cols,
                  header_row = @header_row, header_col = @header_col
            WHERE slug = @slug`,
        )
        .run(next);
      if (renaming && targetSlug !== slug) {
        // Repoint the sparse cell index to the new slug, then external refs.
        this.db
          .prepare(`UPDATE ${SPREADSHEET_CELL_TABLE} SET slug = ? WHERE slug = ?`)
          .run(targetSlug, slug);
      }
    });
    apply();

    if (renaming && targetSlug !== slug) {
      this.ctx.referencesService?.repoint?.(SPREADSHEET_TYPE, slug, targetSlug);
      this.broadcast(slug);
    }
    this.broadcast(targetSlug);
    this.captureVersion(targetSlug, 'update', actor, 'Updated');
    return { snapshot: this.getBySlug(targetSlug)!, previousSlug: slug };
  }

  /**
   * Point write. `value === ""` DELETES the cell's row from the sparse index;
   * any other value UPSERTs it (`ac-ustawienie-komorki-wartoscia-usuwa-je`).
   */
  setCell(slug: string, r: number, c: number, value: string): void {
    this.writeCell(slug, r, c, value);
    this.broadcast(slug);
  }

  /** Same semantics as `setCell` but without broadcasting (batch helper). */
  private writeCell(slug: string, r: number, c: number, value: string): void {
    if (value === '') {
      this.db
        .prepare(`DELETE FROM ${SPREADSHEET_CELL_TABLE} WHERE slug = ? AND r = ? AND c = ?`)
        .run(slug, r, c);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO ${SPREADSHEET_CELL_TABLE} (slug, r, c, value)
         VALUES (@slug, @r, @c, @value)
         ON CONFLICT(slug, r, c) DO UPDATE SET value = excluded.value`,
      )
      .run({ slug, r, c, value });
  }

  /**
   * Block write anchored at `(r1, c1)`: `cells[i][j]` is applied to
   * `(r1 + i, c1 + j)` with per-cell `""`-deletes semantics.
   */
  setRange(slug: string, r1: number, c1: number, cells: string[][]): void {
    const apply = this.db.transaction(() => {
      for (let i = 0; i < cells.length; i++) {
        const row = cells[i];
        for (let j = 0; j < row.length; j++) this.writeCell(slug, r1 + i, c1 + j, row[j]);
      }
    });
    apply();
    this.broadcast(slug);
  }

  /**
   * Resize the grid. Changes ONLY `n_rows`/`n_cols` metadata — creates no cell
   * rows (`ac-resize-grow-arkusza-zmienia-wylacznie-me`). Shrinking does not
   * prune out-of-bounds cells here (they simply fall outside every window);
   * `snapshot`/reads are always clamped to the current dimensions.
   */
  resize(slug: string, nRows: number, nCols: number, actor: Actor = 'user'): SpreadsheetOverviewDto | null {
    const existing = this.metaRow(slug);
    if (!existing) return null;
    this.db
      .prepare(`UPDATE ${SPREADSHEET_TABLE} SET n_rows = ?, n_cols = ? WHERE slug = ?`)
      .run(nRows, nCols, slug);
    this.broadcast(slug);
    this.captureVersion(slug, 'update', actor, 'Resized');
    return this.overview(slug);
  }

  /**
   * Reindex the sparse cell index in one transaction: read every cell, delete
   * all, re-insert those the `map` keeps (returning `null` drops a cell). Used by
   * row/column insert & delete so `r`/`c` of the remaining cells stay consistent.
   */
  private reindexCells(slug: string, map: (r: number, c: number) => { r: number; c: number } | null): void {
    const apply = this.db.transaction(() => {
      const rows = this.db
        .prepare(`SELECT r, c, value FROM ${SPREADSHEET_CELL_TABLE} WHERE slug = ?`)
        .all(slug) as Array<Pick<CellRow, 'r' | 'c' | 'value'>>;
      this.db.prepare(`DELETE FROM ${SPREADSHEET_CELL_TABLE} WHERE slug = ?`).run(slug);
      const insert = this.db.prepare(
        `INSERT INTO ${SPREADSHEET_CELL_TABLE} (slug, r, c, value) VALUES (?, ?, ?, ?)`,
      );
      for (const cell of rows) {
        const next = map(cell.r, cell.c);
        if (next) insert.run(slug, next.r, next.c, cell.value);
      }
    });
    apply();
  }

  /** Insert a blank row before 1-based `at`; shifts rows `>= at` down, `n_rows`++. */
  insertRow(slug: string, at: number, actor: Actor = 'user'): void {
    const meta = this.metaRow(slug);
    if (!meta) return;
    this.reindexCells(slug, (r, c) => ({ r: r >= at ? r + 1 : r, c }));
    this.db.prepare(`UPDATE ${SPREADSHEET_TABLE} SET n_rows = n_rows + 1 WHERE slug = ?`).run(slug);
    this.broadcast(slug);
    this.captureVersion(slug, 'update', actor, 'Inserted row');
  }

  /** Delete 1-based row `at`; drops its cells, shifts rows `> at` up, `n_rows`--. */
  deleteRow(slug: string, at: number, actor: Actor = 'user'): void {
    const meta = this.metaRow(slug);
    if (!meta) return;
    this.reindexCells(slug, (r, c) => (r === at ? null : { r: r > at ? r - 1 : r, c }));
    this.db
      .prepare(`UPDATE ${SPREADSHEET_TABLE} SET n_rows = MAX(0, n_rows - 1) WHERE slug = ?`)
      .run(slug);
    this.broadcast(slug);
    this.captureVersion(slug, 'update', actor, 'Deleted row');
  }

  /** Insert a blank column before 1-based `at`; shifts cols `>= at` right, `n_cols`++. */
  insertColumn(slug: string, at: number, actor: Actor = 'user'): void {
    const meta = this.metaRow(slug);
    if (!meta) return;
    this.reindexCells(slug, (r, c) => ({ r, c: c >= at ? c + 1 : c }));
    this.db.prepare(`UPDATE ${SPREADSHEET_TABLE} SET n_cols = n_cols + 1 WHERE slug = ?`).run(slug);
    this.broadcast(slug);
    this.captureVersion(slug, 'update', actor, 'Inserted column');
  }

  /** Delete 1-based column `at`; drops its cells, shifts cols `> at` left, `n_cols`--. */
  deleteColumn(slug: string, at: number, actor: Actor = 'user'): void {
    const meta = this.metaRow(slug);
    if (!meta) return;
    this.reindexCells(slug, (r, c) => (c === at ? null : { r, c: c > at ? c - 1 : c }));
    this.db
      .prepare(`UPDATE ${SPREADSHEET_TABLE} SET n_cols = MAX(0, n_cols - 1) WHERE slug = ?`)
      .run(slug);
    this.broadcast(slug);
    this.captureVersion(slug, 'update', actor, 'Deleted column');
  }

  /** Hard delete: metadata row + all its cells. No external-ref cascade. */
  remove(slug: string, actor: Actor = 'user'): { deleted: boolean; danglingRefs: unknown[] } {
    const danglingRefs: unknown[] =
      this.ctx.referencesService?.findReferrers?.(SPREADSHEET_TYPE, slug) ?? [];
    this.captureVersion(slug, 'delete', actor, 'Deleted');
    const apply = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM ${SPREADSHEET_CELL_TABLE} WHERE slug = ?`).run(slug);
      return this.db.prepare(`DELETE FROM ${SPREADSHEET_TABLE} WHERE slug = ?`).run(slug) as {
        changes: number;
      };
    });
    const info = apply();
    const deleted = info.changes > 0;
    if (deleted) this.broadcast(slug);
    return { deleted, danglingRefs };
  }

  /** Lightweight list (metadata only), by name, optionally filtered by tags. */
  list(query: SpreadsheetListQuery = {}): SpreadsheetListItem[] {
    const tags = query.tags ?? [];
    const filter: 'and' | 'or' = query.filter ?? 'or';
    const rows = this.db
      .prepare(`SELECT * FROM ${SPREADSHEET_TABLE} ORDER BY name ASC`)
      .all() as SpreadsheetRow[];
    const items = rows.map((row) => this.rowToListItem(row));
    if (!tags.length) return items;
    return items.filter((item) => {
      const itemTags = new Set(item.tags ?? []);
      return filter === 'and' ? tags.every((t) => itemTags.has(t)) : tags.some((t) => itemTags.has(t));
    });
  }

  private rowToListItem(row: SpreadsheetRow): SpreadsheetListItem {
    return {
      ...toOverview(row),
      tags: this.ctx.tagsService?.getEntityTagSlugs?.(SPREADSHEET_TYPE, row.slug) ?? [],
    };
  }

  /**
   * Idempotent UPSERT from a full dense snapshot: upsert metadata, replace the
   * sparse cell index (delete-all then insert non-`""` cells). Repeating with the
   * same snapshot yields the same state regardless of the starting point
   * (`ac-restore-jest-idempotentnym-upsert`); `""` never creates a row.
   */
  restore(snapshot: SpreadsheetSnapshot): { op: 'created' | 'updated' } {
    const before = this.metaRow(snapshot.slug);
    const apply = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO ${SPREADSHEET_TABLE} (slug, name, n_rows, n_cols, header_row, header_col)
           VALUES (@slug, @name, @n_rows, @n_cols, @header_row, @header_col)
           ON CONFLICT(slug) DO UPDATE SET
             name = excluded.name, n_rows = excluded.n_rows, n_cols = excluded.n_cols,
             header_row = excluded.header_row, header_col = excluded.header_col`,
        )
        .run({
          slug: snapshot.slug,
          name: snapshot.name,
          n_rows: snapshot.nRows,
          n_cols: snapshot.nCols,
          header_row: snapshot.headerRow ? 1 : 0,
          header_col: snapshot.headerCol ? 1 : 0,
        });
      this.db.prepare(`DELETE FROM ${SPREADSHEET_CELL_TABLE} WHERE slug = ?`).run(snapshot.slug);
      const insert = this.db.prepare(
        `INSERT INTO ${SPREADSHEET_CELL_TABLE} (slug, r, c, value) VALUES (?, ?, ?, ?)`,
      );
      for (let i = 0; i < snapshot.cells.length; i++) {
        const row = snapshot.cells[i];
        for (let j = 0; j < row.length; j++) {
          const value = row[j];
          if (value !== '') insert.run(snapshot.slug, i + 1, j + 1, value);
        }
      }
    });
    apply();
    this.broadcast(snapshot.slug);
    return { op: before ? 'updated' : 'created' };
  }

  private captureVersion(slug: string, op: 'create' | 'update' | 'delete', actor: Actor, message: string): void {
    try {
      this.ctx.versionService?.captureEntitySnapshot?.(
        SPREADSHEET_TYPE,
        slug,
        op,
        actor,
        message,
        SERIALIZER_VERSION,
      );
    } catch (err) {
      console.error(`[spreadsheet] captureEntitySnapshot failed for ${slug} (op=${op}):`, err);
      throw err;
    }
  }

  private broadcast(slug: string): void {
    this.ctx.ws?.broadcast?.({ kind: 'entity:changed', entityType: SPREADSHEET_TYPE, slug });
  }
}
