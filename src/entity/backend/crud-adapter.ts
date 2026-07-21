/**
 * M13 — thin adapter satisfying the host's generic `EntityCrudService` contract.
 * CRUD tools for `spreadsheet` (create/get/update/delete/list of the SHEET, i.e.
 * metadata: name, dimensions, header flags) are served by the host's own
 * `entity-tools` MCP server through this; the per-type `backend.mcpServer`
 * (`spreadsheet-tools`) carries the NON-CRUD cell tools (progressive read +
 * point write), never these.
 *
 * Delegates to `rich` (`SpreadsheetService`), which keeps its full method surface
 * (cell reads/writes, resize, reindex, snapshot/restore) for the read router and
 * the custom MCP server. Registered as the SINGLE `backend.service` instance
 * (`entity/index.ts`): the host passes this exact object to
 * `ctx.registerEntityService`, entity-tools' CRUD registry, and the
 * `routes`/`mcpServer` factories (which unwrap `.rich`).
 *
 * `getBySlug` (alongside `get`): the host's `entityExists` gate (fronting every
 * `/tags` / `/versions` request) duck-types the service for `getBySlug`
 * specifically, not `get`; without this alias those endpoints 404. Cheap to
 * satisfy both.
 */

import type { EntityCrudService } from '@c4s/plugin-runtime';
import type { CreateSpreadsheetRequest, UpdateSpreadsheetRequest } from '../dto';
import type { SpreadsheetService } from './services';

export class SpreadsheetCrudAdapter implements EntityCrudService {
  constructor(readonly rich: SpreadsheetService) {}

  create(data: unknown) {
    const snapshot = this.rich.create(data as CreateSpreadsheetRequest, 'agent');
    return snapshot; // full SpreadsheetSnapshot, cells included
  }

  get(slug: string) {
    return this.rich.getBySlug(slug);
  }

  /** See class-level doc — satisfies `entityExists`'s duck-typed check. */
  getBySlug(slug: string) {
    return this.get(slug);
  }

  update(slug: string, data: unknown) {
    const result = this.rich.update(slug, data as UpdateSpreadsheetRequest, 'agent');
    if (!result) throw new Error(`spreadsheet not found: ${slug}`);
    return { slug: result.snapshot.slug };
  }

  delete(slug: string): void {
    const result = this.rich.remove(slug, 'agent');
    if (!result.deleted) throw new Error(`spreadsheet not found: ${slug}`);
  }

  list(opts: { tags?: string[]; tagFilter?: 'and' | 'or'; limit: number; offset: number }) {
    const items = this.rich.list({ tags: opts.tags, filter: opts.tagFilter });
    return { items: items.slice(opts.offset, opts.offset + opts.limit), total: items.length };
  }
}
