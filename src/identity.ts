/**
 * Central identity for the `spreadsheet` type — kept free of backend/frontend
 * imports so neither entry pulls in the other's deps.
 *
 * `spreadsheet` (type / feature-slice tag slug), `spreadsheet` (SQLite table,
 * snake_case), `/spreadsheets` (pathPrefix). Identity mirrors `database-table`:
 * `name` required, `slug = slugify(name)` is the PK.
 */

/** Entity `type` (kebab-case). Also the feature-slice tag slug. */
export const SPREADSHEET_TYPE = 'spreadsheet';

/** SQLite metadata table identifier (snake_case). */
export const SPREADSHEET_TABLE = 'spreadsheet';

/** Sparse cell-index table identifier. */
export const SPREADSHEET_CELL_TABLE = 'spreadsheet_cell';

/** Router mount prefix (the host prepends `/api/projects/:id`). */
export const SPREADSHEET_PATH_PREFIX = '/spreadsheets';

export const SPREADSHEET_LABEL = 'Spreadsheet';
export const SPREADSHEET_LABEL_PLURAL = 'Spreadsheets';

/** Sidebar ordering hint (unused while the entity is hidden). */
export const SPREADSHEET_DISPLAY_ORDER = 100;

/**
 * Normalize a human name into a kebab-case slug: lowercase, map stroke letters
 * (`\u0142`, which has NO NFKD decomposition) explicitly, NFKD-fold the remaining
 * diacritics, collapse non-alphanumerics to single hyphens, trim edge hyphens.
 * Never returns `""` \u2014 a name that reduces to nothing (all stroke-L / punctuation,
 * or CJK/Cyrillic) falls back to a deterministic `x-<hash>`, so distinct such
 * names don't all collide on the empty string.
 */
export function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/\u0142/g, 'l')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (base) return base;
  let hash = 0;
  for (let i = 0; i < input.length; i++) hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  return `x-${hash.toString(36)}`;
}

/**
 * Create-only slug derivation (host `slugFrom` slot). Prefers an explicit slug,
 * then `slugify(name)`, then a typed random fallback so a nameless create still
 * gets a stable, unique slug. Renames after creation go ONLY through `newSlug`.
 */
export function spreadsheetSlugFrom(data: unknown): string {
  const d = (data ?? {}) as { slug?: unknown; name?: unknown };
  if (typeof d.slug === 'string' && d.slug.trim()) return slugify(d.slug);
  if (typeof d.name === 'string' && d.name.trim()) return slugify(d.name);
  return `${SPREADSHEET_TYPE}-${randomSuffix()}`;
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
