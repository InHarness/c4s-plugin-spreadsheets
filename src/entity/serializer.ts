/**
 * L9 — serializer for `spreadsheet`. Overview-first: `detail` and `snapshot` are
 * two DISJOINT projections and must not be conflated.
 *
 *  - `detail` = the OVERVIEW projection: dimensions + header flags + perimeter
 *    labels ONLY, never a body cell. Narrows `get_entities` and the L9 detail
 *    view (`ac-projekcja-detail-serializera-zwraca-wyla`).
 *  - `snapshot` = the FULL deterministic dump: metadata + a dense `cells` grid.
 *    This is what gets written to `.claude4spec/entities/spreadsheet/<slug>.json`,
 *    i.e. the source of truth (`ac-snapshot-zwraca-pelny-deterministyczn`).
 *  - `restore` = idempotent UPSERT, empty source cells (`""`) create no rows
 *    (`ac-restore-jest-idempotentnym-upsert`).
 *
 * `T` is the HOST ROW, not the plugin's domain object. The host hands every view
 * a `RawEntity` — `{type, slug, data: {…table columns…}, tags}` — read straight
 * off the metadata table, with booleans as INTEGER 0/1 and NO auxiliary-table
 * hydration. That type is not exported to plugins, so it is mirrored below.
 *
 * Getting this wrong was not a typing nicety: reading `e.name` / `e.cells` off a
 * `RawEntity` yields `undefined`, which is how every embed lost its title and
 * every snapshot collapsed to the 29-byte stub `{"slug":"…","cells":[]}`. Cells
 * live in the sparse aux table and must be read explicitly via `ctx.reader.db`.
 */

import type {
  EntityDiff,
  EntitySerializer,
  RestoreContext,
  RestoreResult,
  SerializeContext,
  SnapshotData,
} from '@c4s/plugin-runtime';
import { SPREADSHEET_CELL_TABLE, SPREADSHEET_TYPE } from '../identity';
import { cellKey, densify, type SparseCell } from './cells';
import type { SpreadsheetOverviewDto, SpreadsheetSnapshot } from './dto';
import { buildOverview } from './overview';

/**
 * Local mirror of the host's `RawEntity` — the shape every serializer view is
 * called with. `data` carries the `spreadsheet` table's columns verbatim
 * (snake_case, booleans as 0/1).
 */
interface SpreadsheetEntityRow {
  type: string;
  slug: string;
  data: Record<string, unknown>;
  tags: string[];
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
/** SQLite has no boolean — the column is INTEGER 0/1. */
const bool = (v: unknown): boolean => v !== 0 && v != null && v !== false;

/** Metadata-only projection of the host row (no cell reads). */
function metaOf(e: SpreadsheetEntityRow): SpreadsheetOverviewDto {
  return {
    slug: e.slug,
    name: typeof e.data.name === 'string' ? e.data.name : '',
    nRows: num(e.data.n_rows),
    nCols: num(e.data.n_cols),
    headerRow: bool(e.data.header_row),
    headerCol: bool(e.data.header_col),
  };
}

/** Dimensions summary for compact views, e.g. "12×5". */
function dims(m: SpreadsheetOverviewDto): string {
  return `${m.nRows}×${m.nCols}`;
}

/**
 * Sparse cell rows for one sheet, ordered so the read is deterministic
 * independent of physical row order. `ctx.reader.db` is the project database —
 * this module's own aux table is exactly what a plugin may touch there.
 */
function readCells(ctx: SerializeContext, slug: string, and = ''): SparseCell[] {
  return ctx.reader.db
    .prepare(
      `SELECT r, c, value FROM ${SPREADSHEET_CELL_TABLE}
        WHERE slug = ?${and ? ` AND ${and}` : ''} ORDER BY r, c`,
    )
    .all(slug) as SparseCell[];
}

/**
 * A 1-based `cellAt` over just the perimeter (header row 1 and/or column 1),
 * prefetched in ONE query. Absent (empty) cells read as `""`.
 */
function perimeterAccessor(
  ctx: SerializeContext,
  m: SpreadsheetOverviewDto,
): (r: number, c: number) => string {
  const map = new Map<string, string>();
  for (const cell of readCells(ctx, m.slug, '(r = 1 OR c = 1)')) {
    map.set(cellKey(cell.r, cell.c), cell.value);
  }
  return (r, c) => map.get(cellKey(r, c)) ?? '';
}

export const spreadsheetSerializer: EntitySerializer<SpreadsheetEntityRow> = {
  type: SPREADSHEET_TYPE,
  version: '1.0.0',

  // ── Data views — overview-based, NEVER cell content ──
  inlineMention: (e: SpreadsheetEntityRow, _ctx: SerializeContext) => ({
    kind: 'inline_mention',
    type: SPREADSHEET_TYPE,
    slug: e.slug,
    label: metaOf(e).name,
  }),

  singleElement: (e: SpreadsheetEntityRow, _ctx: SerializeContext) => {
    const m = metaOf(e);
    return {
      kind: 'single_element',
      type: SPREADSHEET_TYPE,
      slug: m.slug,
      title: m.name,
      subtitle: `${dims(m)} grid`,
    };
  },

  elementListItem: (e: SpreadsheetEntityRow, _ctx: SerializeContext) => ({
    kind: 'element_list_item',
    type: SPREADSHEET_TYPE,
    slug: e.slug,
    title: metaOf(e).name,
    tags: e.tags ?? [],
  }),

  taggedListItem: (e: SpreadsheetEntityRow, _ctx: SerializeContext) => ({
    kind: 'tagged_list_item',
    type: SPREADSHEET_TYPE,
    slug: e.slug,
    title: metaOf(e).name,
    tags: e.tags ?? [],
  }),

  /**
   * OVERVIEW projection ONLY — dimensions + header flags + perimeter header
   * labels (row 1 / column 1). Never returns BODY cell content
   * (`ac-projekcja-detail-serializera-zwraca-wyla`). Labels come from the same
   * shared `buildOverview` builder the L4 router and the L3 `get_overview` use,
   * so the three projections cannot drift.
   *
   * Cheap by construction: with neither header flag set no cell query runs at
   * all, and when one is set the read is restricted to the perimeter
   * (`r = 1 OR c = 1`) rather than the whole grid — mirroring
   * `SpreadsheetService.perimeterAccessor`.
   */
  detail: (e: SpreadsheetEntityRow, ctx: SerializeContext) => {
    const m = metaOf(e);
    const ov = m.headerRow || m.headerCol ? buildOverview(m, perimeterAccessor(ctx, m)) : m;
    const fields = [
      { label: 'Slug', value: ov.slug },
      { label: 'Name', value: ov.name },
      { label: 'Rows', value: String(ov.nRows) },
      { label: 'Columns', value: String(ov.nCols) },
      { label: 'Header row', value: ov.headerRow ? 'yes' : 'no' },
      { label: 'Header column', value: ov.headerCol ? 'yes' : 'no' },
    ];
    if (ov.headerRowLabels) {
      fields.push({ label: 'Header row labels', value: ov.headerRowLabels.join(' | ') });
    }
    if (ov.headerColLabels) {
      fields.push({ label: 'Header column labels', value: ov.headerColLabels.join(' | ') });
    }
    return { kind: 'detail', type: SPREADSHEET_TYPE, slug: ov.slug, title: ov.name, fields };
  },

  // ── Release ops ──

  /**
   * Full deterministic dump with a STABLE key order. All fields are always
   * present (no optionals), so equal state serializes to byte-identical JSON.
   * `cells` is materialized row-major from the sparse index through the shared
   * `densify` helper and CLAMPED to `nRows × nCols`, so a shrink that left
   * out-of-bounds rows behind cannot leak them into the file — matching
   * `SpreadsheetService.getBySlug`.
   */
  snapshot: (e: SpreadsheetEntityRow, ctx: SerializeContext): SnapshotData => {
    const m = metaOf(e);
    const snapshot: SpreadsheetSnapshot = {
      slug: m.slug,
      name: m.name,
      nRows: m.nRows,
      nCols: m.nCols,
      headerRow: m.headerRow,
      headerCol: m.headerCol,
      cells:
        m.nRows > 0 && m.nCols > 0 ? densify(readCells(ctx, m.slug), 1, 1, m.nRows, m.nCols) : [],
    };
    return snapshot;
  },

  /**
   * Idempotent UPSERT from a snapshot, through the host's generic write door.
   * `writer.upsert(type, slug, input, actor)` reaches
   * `SpreadsheetCrudAdapter.upsert` with `{capture, writeFile: false}`, which
   * delegates the sparse-index rebuild to `SpreadsheetService.restore` (delete-all
   * then insert non-`""` cells) — so replaying the same snapshot yields the same
   * state.
   *
   * The returned `op` is DERIVED from the writer's result, never hard-coded: a
   * `null` result means no service answered, and reporting `{op:'noop',
   * entity:null}` is what makes the indexer warn out loud instead of counting a
   * silently-lost entity as indexed.
   */
  restore: (data: SnapshotData, ctx: RestoreContext): RestoreResult => {
    const snapshot = data as SpreadsheetSnapshot;
    const result = ctx.writer.upsert(
      SPREADSHEET_TYPE,
      snapshot.slug,
      snapshot,
      ctx.actor,
    ) as { op: RestoreResult['op']; entity?: unknown; warnings?: string[] } | null | undefined;
    if (!result) {
      return {
        op: 'noop',
        entity: null,
        warnings: [
          `no entity service answered upsert for ${SPREADSHEET_TYPE}/${snapshot.slug} — ` +
            'the sheet was NOT restored',
        ],
      };
    }
    return {
      op: result.op,
      entity: result.entity ?? snapshot,
      ...(result.warnings ? { warnings: result.warnings } : {}),
    };
  },

  /** Field-level diff between two snapshots (metadata + cells). */
  diff: (a: SnapshotData, b: SnapshotData, slug: string): EntityDiff => {
    const prev = (a ?? {}) as Partial<SpreadsheetSnapshot>;
    const next = (b ?? {}) as Partial<SpreadsheetSnapshot>;
    const keys: Array<keyof SpreadsheetSnapshot> = [
      'name',
      'nRows',
      'nCols',
      'headerRow',
      'headerCol',
      'cells',
    ];
    const changes: Record<string, unknown> = {};
    for (const k of keys) {
      if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) {
        changes[k] = { from: prev[k], to: next[k] };
      }
    }
    const op: EntityDiff['op'] =
      a == null ? 'created' : b == null ? 'deleted' : Object.keys(changes).length ? 'modified' : 'noop';
    return { type: SPREADSHEET_TYPE, slug, op, changes };
  },
};
