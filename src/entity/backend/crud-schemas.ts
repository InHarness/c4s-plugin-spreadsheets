// Build backend schemas with the HOST's zod (v4), re-exported by the runtime as a
// VALUE — NOT a bundled `import { z } from 'zod'`. The host introspects these shapes
// via `z.toJSONSchema()` (a zod v4 walker over each node's `.def`); a schema built by a
// second zod instance has no v4-shaped `.def` and the walker throws. One instance
// process-wide keeps `describe_entity_type` working.
import { z } from '@c4s/plugin-runtime';
import type { ZodRawShape } from '@c4s/plugin-runtime';

/**
 * Declared to `backend.crud` — the host's generic `entity-tools` MCP server
 * validates `create_entities` items against this. `slug` is never part of the
 * shape: it is `slugify(name)`, derived server-side. Cell content is NOT created
 * here — a sheet is created empty (or at given dimensions) and cells are written
 * via the `spreadsheet-tools` point-write tools.
 */
export const spreadsheetCreateSchema: ZodRawShape = {
  name: z.string(),
  nRows: z.number().int().nonnegative().optional(),
  nCols: z.number().int().nonnegative().optional(),
  headerRow: z.boolean().optional(),
  headerCol: z.boolean().optional(),
};

/**
 * Metadata update (name / dimensions / header flags). `newSlug` is NOT part of
 * this shape — entity-tools carries it as a sibling field on each
 * `update_entities` item and merges it in before calling `service.update()`.
 */
export const spreadsheetUpdateSchema: ZodRawShape = {
  name: z.string().optional(),
  nRows: z.number().int().nonnegative().optional(),
  nCols: z.number().int().nonnegative().optional(),
  headerRow: z.boolean().optional(),
  headerCol: z.boolean().optional(),
};
