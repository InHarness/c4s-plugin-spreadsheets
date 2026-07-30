/**
 * Composes the `spreadsheet` type as an `EntityContribution` (host 1.0.0).
 *
 * Identity (mirrors `database-table`: `name` required, `slug = slugify(name)` PK)
 * plus the slots:
 *  - `serializer` (L9, required) — overview-first `detail` vs full `snapshot`.
 *  - `systemPrompt` (required) — overview-first discipline for the agent.
 *  - `backend`:
 *      - `migrations` (L1) — the two index tables.
 *      - `auxTables` — `spreadsheet_cell`, so the host clears the derived cell
 *        index on a rebuild along with the metadata table.
 *      - `service` — ONE `SpreadsheetCrudAdapter` per `ProjectContext`; the SAME
 *        instance backs DI, the generic `entity-tools` CRUD (via `crud`), the read
 *        `routes` factory, and the custom `mcpServer` factory.
 *      - `crud` — sheet CRUD (metadata) served by the host's `entity-tools`.
 *      - `routes` (L4) — the read-only overview/range/rows/columns router.
 *      - `mcpServer` (L3) — the custom `spreadsheet-tools` server (cell read/write).
 *  - `frontend.referenceType` (M19 Slot B — the "diagram pattern") — registers the
 *    `<spreadsheet slug caption/>` tag. The host auto-injects `entityType:'spreadsheet'`
 *    and wires broken-ref existence checking (`check_consistency`) for free. Typed
 *    `unknown` in the published `EntityContribution.frontend`; the strong shape is
 *    `{ tag, attrOrder, validate? }`.
 *
 * The visual NodeView + slash command live in the separate frontend entry
 * (`src/frontend.tsx`), a side-effect registration, so they are NOT referenced here.
 */

import type { EntityContribution, MountContext } from '@c4s/plugin-runtime';
import {
  SPREADSHEET_TYPE,
  SPREADSHEET_TABLE,
  SPREADSHEET_CELL_TABLE,
  SPREADSHEET_LABEL,
  SPREADSHEET_LABEL_PLURAL,
  SPREADSHEET_DISPLAY_ORDER,
  SPREADSHEET_PATH_PREFIX,
  spreadsheetSlugFrom,
} from '../identity';
import { spreadsheetSerializer } from './serializer';
import { spreadsheetSystemPrompt } from './system-prompt';
import { spreadsheetMigrations } from './backend/migrations';
import { SpreadsheetService } from './backend/services';
import { SpreadsheetCrudAdapter } from './backend/crud-adapter';
import { spreadsheetCreateSchema, spreadsheetUpdateSchema } from './backend/crud-schemas';
import { createSpreadsheetRouter } from './backend/routes';
import { createSpreadsheetMcpServer } from './backend/mcp';

/** M19 Slot B reference-type spec (host injects `entityType`). */
const spreadsheetReferenceType = {
  tag: SPREADSHEET_TYPE,
  attrOrder: ['slug', 'caption'] as const,
  /** A `<spreadsheet/>` tag is well-formed only with a non-empty `slug`. */
  validate: (attrs: Record<string, string>) => {
    const ok = typeof attrs.slug === 'string' && attrs.slug.trim().length > 0;
    return { ok, category: ok ? 'ok' : 'missing-slug' };
  },
};

export const spreadsheetEntity: EntityContribution = {
  // ── Identity (EntityModuleManifest) ──
  type: SPREADSHEET_TYPE,
  table: SPREADSHEET_TABLE,
  label: SPREADSHEET_LABEL,
  labelPlural: SPREADSHEET_LABEL_PLURAL,
  displayOrder: SPREADSHEET_DISPLAY_ORDER,
  pathPrefix: SPREADSHEET_PATH_PREFIX,
  slugFrom: spreadsheetSlugFrom,

  // ── Slots ──
  serializer: spreadsheetSerializer, // L9 (required)
  systemPrompt: spreadsheetSystemPrompt, // required

  backend: {
    // L1 — forward-only idempotent migrations for the two index tables.
    migrations: spreadsheetMigrations,

    // The sparse cell index is DERIVED from the entity files, so an index
    // rebuild must clear it before repopulating — otherwise stale cell rows
    // survive the wipe and merge into freshly restored sheets (a shrunk or
    // renamed sheet would resurrect cells that no file mentions).
    auxTables: [SPREADSHEET_CELL_TABLE],

    // L2 — one instance per ProjectContext; wraps the rich SpreadsheetService.
    service: (ctx: MountContext) =>
      new SpreadsheetCrudAdapter(new SpreadsheetService(ctx.db, ctx)),

    // Sheet CRUD (metadata) served by the host's generic entity-tools.
    crud: {
      createSchema: spreadsheetCreateSchema,
      updateSchema: spreadsheetUpdateSchema,
      descriptions: {
        // Agent-facing one-liner (0.0.3). NOTE: the brief placed this on
        // `EntityModuleManifest.description`, which does not exist in the host
        // contract — the closest real home is this `crud.descriptions.entity`
        // slot. See the filed drift patch.
        entity:
          'Spreadsheets carry tabular data as a read-by-ranges entity — a token-light ' +
          'successor to markdown-tables. Cell values are markdown. Read overview-first: ' +
          'dimensions + header flags + header labels; body cells by range.',
      },
    },

    // L4 — read-only router (overview/range/rows/columns). Same service instance.
    routes: {
      router: (crud: SpreadsheetCrudAdapter, ctx: MountContext) =>
        createSpreadsheetRouter(crud.rich, ctx),
    },

    // L3 — custom `spreadsheet-tools` server (progressive read + point write).
    mcpServer: (crud: SpreadsheetCrudAdapter, ctx: MountContext) =>
      createSpreadsheetMcpServer(crud.rich, ctx),
  },

  // M19 Slot B — the `<spreadsheet slug caption/>` reference tag.
  frontend: {
    referenceType: spreadsheetReferenceType,
  },
};
