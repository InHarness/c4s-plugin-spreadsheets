#!/usr/bin/env node
/**
 * ONE-OFF RECOVERY — reconstruct spreadsheet entity files from orphan cell rows.
 *
 * Why this exists
 * ---------------
 * Before 0.0.6 the plugin never wrote entity files. The host's `indexAll()`
 * truncates the derived tables and rebuilds them from files on disk, so every
 * rebuild destroyed the `spreadsheet` metadata rows. The CELLS survived only
 * because `spreadsheet_cell` was not declared in `backend.auxTables` and was
 * therefore skipped by the wipe.
 *
 * 0.0.6 declares that aux table (it must — otherwise stale cells would merge into
 * restored sheets). That means the NEXT rebuild deletes the orphan cells too, and
 * they are the last copy: `entity_version` holds only the 29-byte broken stubs
 * `{"slug":"…","cells":[]}`, so history cannot restore them either.
 *
 * So: run this BEFORE the 0.0.6 plugin ever boots against the project. It writes
 * `<entities>/spreadsheet/<slug>.json` for every slug that still has cells, and
 * the next boot indexes those files back into both tables.
 *
 * What is exact and what is a guess
 * ---------------------------------
 *   exact  — cell values, and their (r, c) coordinates.
 *   derived — nRows/nCols from MAX(r)/MAX(c). A sheet whose trailing rows or
 *             columns were entirely empty comes back smaller than it was.
 *   guessed — `name` (from the nearest markdown heading above the sheet's
 *             `<spreadsheet slug="…"/>` embed, else de-slugified) and the header
 *             flags (`headerRow: true`, `headerCol: false` — every one of these
 *             sheets was a converted markdown table). REVIEW THESE.
 *
 * Usage
 * -----
 *   node scripts/recover-orphan-cells.mjs                 # dry run, prints a plan
 *   node scripts/recover-orphan-cells.mjs --write         # actually write files
 *   … --db <path> --skill <path> --out <dir>              # override the defaults
 *
 * Stop the c4s server first: it holds the DB open and would rebuild the index
 * underneath you.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const DEFAULTS = {
  db: path.join(os.homedir(), '.claude4spec/default/3920fbe4457f/db.sqlite'),
  skill: path.join(os.homedir(), 'Code/ctowiec/claude4spec-private/app-spec/SKILL.md'),
  out: path.join(
    os.homedir(),
    'Code/ctowiec/claude4spec-private/app-spec/.claude4spec/entities/spreadsheet',
  ),
};

function parseArgs(argv) {
  const opts = { ...DEFAULTS, write: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') opts.write = true;
    else if (a === '--db') opts.db = argv[++i];
    else if (a === '--skill') opts.skill = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else throw new Error(`unknown argument: ${a}`);
  }
  return opts;
}

/**
 * Map slug → human name by walking SKILL.md and remembering the most recent ATX
 * heading before each `<spreadsheet slug="…">` embed. Trailing parenthetical
 * paths (`Układ kodu źródłowego (\`src/\`)`) and markdown emphasis are kept —
 * they are part of how the author named the section.
 */
function namesFromSkill(skillPath) {
  const names = new Map();
  if (!fs.existsSync(skillPath)) return names;
  let heading = null;
  for (const line of fs.readFileSync(skillPath, 'utf-8').split('\n')) {
    const h = /^#{1,6}\s+(.*\S)\s*$/.exec(line);
    if (h) {
      heading = h[1].replace(/`/g, '').trim();
      continue;
    }
    const m = /<spreadsheet\s+slug="([^"]+)"/.exec(line);
    if (m && heading && !names.has(m[1])) names.set(m[1], heading);
  }
  return names;
}

/** Fallback name: de-slugify (`sub-drzewo-m05` → `Sub drzewo m05`). */
function deslugify(slug) {
  const words = slug.split('-').filter(Boolean).join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const Database = require('better-sqlite3');

  if (!fs.existsSync(opts.db)) throw new Error(`no such database: ${opts.db}`);
  const db = new Database(opts.db, { readonly: true });

  const metaRows = db.prepare('SELECT slug FROM spreadsheet').all();
  if (metaRows.length > 0) {
    console.warn(
      `[recover] NOTE: the spreadsheet table already has ${metaRows.length} row(s). ` +
        'This script only reconstructs sheets from orphan cells; existing sheets are left alone.',
    );
  }
  const existingMeta = new Set(metaRows.map((r) => r.slug));

  const slugs = db
    .prepare('SELECT DISTINCT slug FROM spreadsheet_cell ORDER BY slug')
    .all()
    .map((r) => r.slug)
    .filter((slug) => !existingMeta.has(slug));

  const names = namesFromSkill(opts.skill);
  const cellsFor = db.prepare(
    'SELECT r, c, value FROM spreadsheet_cell WHERE slug = ? ORDER BY r, c',
  );

  const planned = [];
  for (const slug of slugs) {
    const rows = cellsFor.all(slug);
    const nRows = rows.reduce((n, x) => Math.max(n, x.r), 0);
    const nCols = rows.reduce((n, x) => Math.max(n, x.c), 0);

    const map = new Map(rows.map((x) => [`${x.r}:${x.c}`, x.value]));
    const cells = [];
    for (let r = 1; r <= nRows; r++) {
      const row = [];
      for (let c = 1; c <= nCols; c++) row.push(map.get(`${r}:${c}`) ?? '');
      cells.push(row);
    }

    // Key order matches the serializer's `snapshot`, so the first real persist
    // after this produces a byte-identical file (no spurious git diff).
    planned.push({
      slug,
      named: names.has(slug),
      snapshot: {
        slug,
        name: names.get(slug) ?? deslugify(slug),
        nRows,
        nCols,
        headerRow: true,
        headerCol: false,
        cells,
      },
    });
  }
  db.close();

  console.log(`\n[recover] ${planned.length} sheet(s) reconstructable from ${opts.db}\n`);
  console.log('  slug                        dims    cells  name (source)');
  console.log('  ' + '-'.repeat(74));
  for (const p of planned) {
    const s = p.snapshot;
    const nonEmpty = s.cells.flat().filter((v) => v !== '').length;
    console.log(
      `  ${s.slug.padEnd(27)} ${`${s.nRows}x${s.nCols}`.padEnd(7)} ${String(nonEmpty).padEnd(6)} ` +
        `${s.name}  (${p.named ? 'SKILL.md heading' : 'DE-SLUGIFIED — check'})`,
    );
  }

  if (!opts.write) {
    console.log('\n[recover] dry run — nothing written. Re-run with --write to commit these files.');
    console.log('[recover] `name` and the header flags are best-effort; review the JSON after writing.\n');
    return;
  }

  fs.mkdirSync(opts.out, { recursive: true });
  for (const p of planned) {
    const file = path.join(opts.out, `${p.slug}.json`);
    if (fs.existsSync(file)) {
      console.warn(`[recover] SKIP ${p.slug}: ${file} already exists`);
      continue;
    }
    fs.writeFileSync(file, JSON.stringify(p.snapshot, null, 2) + '\n');
    console.log(`[recover] wrote ${file}`);
  }
  console.log(
    `\n[recover] done. Start the host to let indexAll() pull these back into SQLite, ` +
      `then review names/header flags in the UI.\n`,
  );
}

main();
