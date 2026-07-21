/**
 * L1 — migrations that build the DERIVED SQLite index for `spreadsheet`.
 *
 * Two tables:
 *   - `spreadsheet`      — one row per sheet: identity + grid dimensions + header flags.
 *   - `spreadsheet_cell` — a SPARSE cell index (composite PK `(slug, r, c)`): a row
 *     exists only for a non-empty cell. `""` is never stored; setting a cell to `""`
 *     deletes its row; a rebuild skips `""`.
 *
 * The source of truth is the dense per-sheet file (`cells: string[][]`); these tables
 * are a queryable projection. The schema is FORWARD-ONLY and IDEMPOTENT (`IF NOT
 * EXISTS`): replaying it changes neither schema nor data. The host owns applied-version
 * bookkeeping; each migration just declares its `version` + idempotent `up` SQL.
 * (`ac-migracje-pluginu-sa-tylko-naprzod-i-idem`.)
 *
 * SQLite has no native boolean — `header_row` / `header_col` are INTEGER 0/1.
 */

import type { SqlMigration } from '@c4s/plugin-runtime';
import { SPREADSHEET_TABLE, SPREADSHEET_CELL_TABLE } from '../../identity';

export const spreadsheetMigrations: SqlMigration[] = [
  {
    version: 1,
    name: `create_${SPREADSHEET_TABLE}`,
    up: `
      CREATE TABLE IF NOT EXISTS ${SPREADSHEET_TABLE} (
        slug        TEXT PRIMARY KEY NOT NULL,
        name        TEXT NOT NULL,
        n_rows      INTEGER NOT NULL DEFAULT 0,
        n_cols      INTEGER NOT NULL DEFAULT 0,
        header_row  INTEGER NOT NULL DEFAULT 0,
        header_col  INTEGER NOT NULL DEFAULT 0
      );
    `,
  },
  {
    version: 2,
    name: `create_${SPREADSHEET_CELL_TABLE}`,
    up: `
      CREATE TABLE IF NOT EXISTS ${SPREADSHEET_CELL_TABLE} (
        slug   TEXT    NOT NULL,
        r      INTEGER NOT NULL,
        c      INTEGER NOT NULL,
        value  TEXT    NOT NULL,
        PRIMARY KEY (slug, r, c)
      );
      CREATE INDEX IF NOT EXISTS idx_${SPREADSHEET_CELL_TABLE}_slug_r
        ON ${SPREADSHEET_CELL_TABLE} (slug, r);
    `,
  },
];
