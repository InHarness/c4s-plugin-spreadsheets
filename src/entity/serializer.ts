/**
 * L9 — serializer for `spreadsheet`. Overview-first: `detail` and `snapshot` are
 * two DISJOINT projections and must not be conflated.
 *
 *  - `detail` = the OVERVIEW projection: dimensions + header flags ONLY, never a
 *    single cell. Narrows `get_entities` and the L9 detail view
 *    (`ac-projekcja-detail-serializera-zwraca-wyla`).
 *  - `snapshot` = the FULL deterministic dump: metadata + a dense `cells` grid.
 *    Row order of the sparse index must not affect the result — it doesn't,
 *    because the entity object handed in already has `cells` built row-major
 *    (`ac-snapshot-zwraca-pelny-deterministyczn`).
 *  - `restore` = idempotent UPSERT, empty source cells (`""`) create no rows
 *    (`ac-restore-jest-idempotentnym-upsert`).
 *
 * `T` is `SpreadsheetSnapshot` (metadata + dense cells).
 */

import type {
  EntityDiff,
  EntitySerializer,
  RestoreContext,
  RestoreResult,
  SerializeContext,
  SnapshotData,
} from '@c4s/plugin-runtime';
import { SPREADSHEET_TYPE } from '../identity';
import type { SpreadsheetSnapshot } from './dto';
import { buildOverview } from './overview';

/** Dimensions summary for compact views, e.g. "12×5". */
function dims(e: SpreadsheetSnapshot): string {
  return `${e.nRows}×${e.nCols}`;
}

/**
 * Full deterministic dump with a STABLE key order. All fields are always present
 * (no optionals), so equal state serializes to byte-identical JSON. `cells` is
 * copied row-major exactly as materialized by the service.
 */
function toSnapshot(e: SpreadsheetSnapshot): SpreadsheetSnapshot {
  return {
    slug: e.slug,
    name: e.name,
    nRows: e.nRows,
    nCols: e.nCols,
    headerRow: e.headerRow,
    headerCol: e.headerCol,
    cells: (e.cells ?? []).map((row) => row.slice()),
  };
}

export const spreadsheetSerializer: EntitySerializer<SpreadsheetSnapshot> = {
  type: SPREADSHEET_TYPE,
  version: '1.0.0',

  // ── Data views — overview-based, NEVER cell content ──
  inlineMention: (e: SpreadsheetSnapshot, _ctx: SerializeContext) => ({
    kind: 'inline_mention',
    type: SPREADSHEET_TYPE,
    slug: e.slug,
    label: e.name,
  }),

  singleElement: (e: SpreadsheetSnapshot, _ctx: SerializeContext) => ({
    kind: 'single_element',
    type: SPREADSHEET_TYPE,
    slug: e.slug,
    title: e.name,
    subtitle: `${dims(e)} grid`,
  }),

  elementListItem: (e: SpreadsheetSnapshot, _ctx: SerializeContext) => ({
    kind: 'element_list_item',
    type: SPREADSHEET_TYPE,
    slug: e.slug,
    title: e.name,
    tags: [],
  }),

  taggedListItem: (e: SpreadsheetSnapshot, _ctx: SerializeContext) => ({
    kind: 'tagged_list_item',
    type: SPREADSHEET_TYPE,
    slug: e.slug,
    title: e.name,
    tags: [],
  }),

  /**
   * OVERVIEW projection ONLY — dimensions + header flags + perimeter header
   * labels (row 1 / column 1). Never returns BODY cell content, even though the
   * resolved entity carries the dense grid. Labels are computed from that grid
   * via the same shared `buildOverview` builder the service uses, so the L9
   * projection matches the L4/L3 ones (`ac-projekcja-detail-serializera-zwraca-wyla`).
   */
  detail: (e: SpreadsheetSnapshot, _ctx: SerializeContext) => {
    const ov = buildOverview(
      {
        slug: e.slug,
        name: e.name,
        nRows: e.nRows,
        nCols: e.nCols,
        headerRow: e.headerRow,
        headerCol: e.headerCol,
      },
      (r, c) => (e.cells ?? [])[r - 1]?.[c - 1] ?? '',
    );
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
    return { kind: 'detail', type: SPREADSHEET_TYPE, slug: e.slug, title: e.name, fields };
  },

  // ── Release ops ──
  snapshot: (e: SpreadsheetSnapshot, _ctx: SerializeContext): SnapshotData => toSnapshot(e),

  /**
   * Idempotent UPSERT from a snapshot. Persistence is delegated to the host's
   * release writer (guarded for hosts without one); the registered
   * `SpreadsheetService.restore` does the sparse-index rebuild (delete-all then
   * insert non-`""` cells), so replaying the same snapshot yields the same state.
   */
  restore: (data: SnapshotData, ctx: RestoreContext): RestoreResult => {
    const snapshot = data as SpreadsheetSnapshot;
    const writer = ctx.writer as { upsert?: (type: string, snap: unknown) => unknown } | undefined;
    writer?.upsert?.(SPREADSHEET_TYPE, snapshot);
    return { op: 'updated', entity: snapshot };
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
