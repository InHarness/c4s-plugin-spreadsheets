/**
 * L3 — the custom `spreadsheet-tools` MCP server (host registers it as
 * `${type}-tools`). It carries ONLY this type's non-CRUD tools; CRUD of the sheet
 * itself (create/update/delete/list metadata) stays in the host's generic
 * `entity-tools`. Two mirrored modes, same overview-first contract as the router:
 *
 *   - Progressive read: `get_overview` (cheap skeleton — dims + flags + perimeter
 *     header labels, no body cells) → `get_range` (a 1-based inclusive window).
 *   - Point write: `set_cell` (a single cell; `""` deletes it from the sparse
 *     index) and `set_range` (a block anchored at r1,c1).
 *
 * Declared as a factory `(service, ctx) => McpServerFactory` where
 * `McpServerFactory = () => McpServerInstance` (see `entity/index.ts`).
 */

// `z` from the runtime (host's zod v4 instance), not a bundled `import … from 'zod'` —
// tool input shapes are introspected via `z.toJSONSchema()`, which needs the host's
// single zod instance. See crud-schemas.ts for the full rationale.
import { z, createMcpServer, mcpTool } from '@c4s/plugin-runtime';
import type { MountContext } from '@c4s/plugin-runtime';
import type { SpreadsheetService } from './services';

/** Wrap any JSON payload as a single text content block. */
function jsonResult(payload: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

function errorResult(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function createSpreadsheetMcpServer(service: SpreadsheetService, _ctx: MountContext) {
  // McpServerFactory: () => McpServerInstance.
  return () =>
    createMcpServer({
      name: 'spreadsheet-tools',
      tools: [
        mcpTool(
          'get_overview',
          'Get the cheap overview of a spreadsheet (dimensions + header flags + perimeter header labels from row 1 / column 1, NO body cell content). Start here — the labels come back with the overview, so you never need a separate range read just for header names; fetch only body cells by range afterwards.',
          { slug: z.string().describe('Spreadsheet slug (PK).') },
          async (input: unknown) => {
            const args = input as Record<string, unknown>;
            const overview = service.overview(String(args.slug));
            if (!overview) return errorResult(`spreadsheet not found: ${String(args.slug)}`);
            return jsonResult(overview);
          },
        ),
        mcpTool(
          'get_range',
          'Read a rectangular window of cells. Indices are 1-based and inclusive. Empty cells come back as "". Fetch in windows; never pull the whole sheet at once.',
          {
            slug: z.string().describe('Spreadsheet slug (PK).'),
            r1: z.number().int().min(1).describe('First row (1-based, inclusive).'),
            c1: z.number().int().min(1).describe('First column (1-based, inclusive).'),
            r2: z.number().int().min(1).describe('Last row (1-based, inclusive).'),
            c2: z.number().int().min(1).describe('Last column (1-based, inclusive).'),
          },
          async (input: unknown) => {
            const args = input as Record<string, unknown>;
            const r1 = Number(args.r1);
            const c1 = Number(args.c1);
            const r2 = Number(args.r2);
            const c2 = Number(args.c2);
            if (r2 < r1 || c2 < c1) return errorResult('r2 >= r1 and c2 >= c1 required');
            const range = service.getRange(String(args.slug), r1, c1, r2, c2);
            if (!range) return errorResult(`spreadsheet not found: ${String(args.slug)}`);
            return jsonResult(range);
          },
        ),
        mcpTool(
          'set_cell',
          'Write a single cell (1-based r, c). Setting value to "" DELETES the cell from the sparse index.',
          {
            slug: z.string().describe('Spreadsheet slug (PK).'),
            r: z.number().int().min(1).describe('Row (1-based).'),
            c: z.number().int().min(1).describe('Column (1-based).'),
            value: z.string().describe('Cell content; "" clears/deletes the cell.'),
          },
          async (input: unknown) => {
            const args = input as Record<string, unknown>;
            const slug = String(args.slug);
            if (!service.overview(slug)) return errorResult(`spreadsheet not found: ${slug}`);
            const r = Number(args.r);
            const c = Number(args.c);
            const value = String(args.value);
            service.setCell(slug, r, c, value);
            return jsonResult({ slug, r, c, value });
          },
        ),
        mcpTool(
          'set_range',
          'Write a rectangular block of cells anchored at (r1, c1), row-major. Each "" clears/deletes that cell.',
          {
            slug: z.string().describe('Spreadsheet slug (PK).'),
            r1: z.number().int().min(1).describe('Anchor row (1-based).'),
            c1: z.number().int().min(1).describe('Anchor column (1-based).'),
            cells: z
              .array(z.array(z.string()))
              .describe('Row-major block; cells[i][j] → (r1+i, c1+j).'),
          },
          async (input: unknown) => {
            const args = input as Record<string, unknown>;
            const slug = String(args.slug);
            if (!service.overview(slug)) return errorResult(`spreadsheet not found: ${slug}`);
            const r1 = Number(args.r1);
            const c1 = Number(args.c1);
            const cells = args.cells as string[][];
            service.setRange(slug, r1, c1, cells);
            return jsonResult({ slug, r1, c1, rows: cells.length });
          },
        ),
      ],
    });
}
