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
import type {
  CreateSpreadsheetRequest,
  SpreadsheetSnapshot,
  UpdateSpreadsheetRequest,
} from '../dto';
import type { SpreadsheetService } from './services';

/** Write options the host's `HostEntityWriter` passes down to a service upsert. */
interface WriteOpts {
  /** `false` on the index-rebuild / restore path — do NOT re-derive the file. */
  writeFile?: boolean;
  capture?: boolean;
}

/**
 * Coerce a snapshot read back from `<slug>.json` into a `SpreadsheetSnapshot`.
 *
 * `slug` comes from the caller (the FILENAME is authoritative), not from the
 * payload — a file whose inner slug disagrees with its name must index under the
 * name, or the rebuild would silently fork the sheet in two.
 *
 * Malformed input throws rather than being defaulted into existence: the indexer
 * catches per-entity, warns, and skips that one file. Quietly indexing a sheet
 * named `""` with zero dimensions would look like success and read like data loss.
 */
function toSnapshot(slug: string, input: unknown): SpreadsheetSnapshot {
  if (!input || typeof input !== 'object') {
    throw new Error(`spreadsheet '${slug}': snapshot is not an object`);
  }
  const s = input as Partial<SpreadsheetSnapshot>;
  if (typeof s.name !== 'string') {
    throw new Error(`spreadsheet '${slug}': snapshot has no string 'name'`);
  }
  if (!Array.isArray(s.cells)) {
    throw new Error(`spreadsheet '${slug}': snapshot has no 'cells' array`);
  }
  return {
    slug,
    name: s.name,
    nRows: Number(s.nRows ?? 0) || 0,
    nCols: Number(s.nCols ?? 0) || 0,
    headerRow: s.headerRow === true,
    headerCol: s.headerCol === true,
    cells: s.cells.map((row) => (Array.isArray(row) ? row.map((v) => String(v ?? '')) : [])),
  };
}

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

  /**
   * The host's generic WRITE DOOR — `HostEntityWriter.upsert` resolves this
   * service by type and calls `upsert(slug, input, actor, {capture, writeFile})`.
   * Everything that rebuilds the index from files goes through here: boot
   * `indexAll()`, a git-checkout / config-change context rebuild, plugin
   * hot-reload, and M17 release restore. Without this method the whole restore
   * path is a no-op and every sheet on disk stays unindexed.
   *
   * `SpreadsheetService.restore` is already correct reconciliation (upsert
   * metadata, drop the slug's cells, reinsert the non-`""` ones), so this is a
   * validate-and-delegate.
   *
   * `writeFile === false` (which the host ALWAYS passes on the restore path) means
   * "the file is the input — don't re-derive it". Honouring it is what keeps the
   * rebuild from writing back over the very files it is reading.
   */
  upsert(slug: string, input: unknown, _actor: 'user' | 'agent', opts?: WriteOpts) {
    const snapshot = toSnapshot(slug, input);
    const { op } = this.rich.restore(snapshot);
    if (opts?.writeFile !== false) this.rich.persist(slug);
    // `entity` is the canonical payload alias the host's `pickEntity` looks for.
    return { op, entity: this.rich.getBySlug(slug) };
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
