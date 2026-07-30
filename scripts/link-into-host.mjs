#!/usr/bin/env node
/**
 * Local dev install (pool tier): expose this package to a locally running
 * claude4spec host by symlinking the package DIRECTORY into the host's
 * `node_modules/`, so `import("<name>")` resolves.
 *
 * The host's M33 loader imports every package listed in
 * `resolvePluginPackages(ws) = PREDEFINED_PLUGINS ∪ ws.plugins` by BARE
 * specifier from its own `node_modules` — hence a symlink rather than a copy:
 * the link targets the directory, so a later `npm run build` here propagates
 * without re-linking. Only a fresh `npm install` in the host wipes it.
 *
 * Host dir: `C4S_HOST_DIR`, defaulting to the sibling checkout `../../claude4spec`.
 *
 * This does NOT enable the plugin — add the package name to
 * `workspaces[<ws>].plugins` in `~/.claude4spec/workspaces.json` and restart the
 * host. Verify per-project, never via the base `GET /api/_meta/plugins`:
 *   GET /api/projects/:id/_meta/plugins   → this package, status "loaded"
 *   GET /api/projects/:id/_meta/entities  → "database-table" under `active`
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { name } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));

const hostDir = path.resolve(process.env.C4S_HOST_DIR ?? path.join(pkgDir, '..', '..', 'claude4spec'));
if (!fs.existsSync(path.join(hostDir, 'package.json'))) {
  console.error(`link:host — no claude4spec checkout at ${hostDir}. Set C4S_HOST_DIR.`);
  process.exit(1);
}

const linkPath = path.join(hostDir, 'node_modules', name);
fs.mkdirSync(path.dirname(linkPath), { recursive: true });

// lstat, not existsSync: a symlink pointing at a moved/renamed directory is
// "not existing" to existsSync yet still occupies the path and would make
// symlinkSync throw EEXIST.
const current = fs.lstatSync(linkPath, { throwIfNoEntry: false });
if (current) {
  if (current.isSymbolicLink() && fs.readlinkSync(linkPath) === pkgDir) {
    console.log(`link:host — already linked: ${linkPath} -> ${pkgDir}`);
    process.exit(0);
  }
  // A real directory here is an npm-installed copy of the same package; replacing
  // it is the point of this script, but say so loudly.
  console.log(`link:host — replacing existing ${current.isSymbolicLink() ? 'symlink' : 'directory'} at ${linkPath}`);
  fs.rmSync(linkPath, { recursive: true, force: true });
}

fs.symlinkSync(pkgDir, linkPath, 'dir');
console.log(`link:host — linked ${linkPath} -> ${pkgDir}`);
console.log(`link:host — now add "${name}" to workspaces[<name>].plugins in ~/.claude4spec/workspaces.json and restart the host.`);
