#!/usr/bin/env node
// Second bundling pass over Vite's own dist/index.js output, run by `npm run
// build` right after `vite build` (see package.json). Inlines backend
// runtime deps that Vite/Rollup leaves as bare `import ... from 'express'`
// (see vite.config.ts's EXTERNAL list) so dist/index.js is fully
// self-contained — the host's overlay loader never runs `npm install`
// against a mounted project-local plugin, so an unbundled backend dep fails
// to resolve at runtime (`PLUGIN_IMPORT_FAILED`).
//
// `zod` is deliberately NOT inlined: backend schema code imports the host's
// `z` from `@c4s/plugin-runtime` (host-provided, kept external), so there is
// one zod instance process-wide — see crud-schemas.ts. A bundled second copy
// would break the host's `z.toJSONSchema()` introspection.
//
// Uses esbuild directly (not Vite/Rollup) because express's CJS dependency
// tree hits real interop bugs under Rollup's default commonjs handling
// (bare, unprefixed `require('util')`/`require('fs')` get mis-externalized
// as browser polyfills; some transitive deps produce broken `require$$0`
// helpers). esbuild's `platform: 'node'` bundling handles this class of
// package correctly — it's the standard tool for bundling a Node backend.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const ENTRY = 'dist/index.js';

// Everything vite.config.ts's EXTERNAL list keeps external MINUS `express`
// (which gets inlined here) — the frontend-only peers
// (react/tiptap/tanstack/@c4s/plugin-runtime/ui) never actually appear in
// dist/index.js, but listing them is harmless and keeps this list an
// obvious mirror of vite.config.ts's own EXTERNAL, so the two don't drift.
// `@c4s/plugin-runtime` MUST stay external here too — it provides the host's
// `z`, so inlining it would defeat the single-zod-instance contract.
const KEEP_EXTERNAL = [
  '@c4s/plugin-runtime',
  '@c4s/plugin-runtime/ui',
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  '@tanstack/react-query',
  '@tanstack/react-router',
  'better-sqlite3',
];

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  platform: 'node', // handles Node builtins (bare or `node:`-prefixed) as external automatically
  format: 'esm',
  target: 'es2022',
  write: false,
  external: [...KEEP_EXTERNAL, ...KEEP_EXTERNAL.map((id) => `${id}/*`)],
  // Some of express's CJS dependency tree keeps a literal runtime
  // `require(...)` call in esbuild's ESM output instead of being fully
  // inlined (e.g. a conditionally-required Node builtin) — real ESM has no
  // global `require`, so this shims one in via `createRequire`. Standard
  // esbuild recipe for "Dynamic require of X is not supported".
  banner: { js: "import { createRequire as __c4sCreateRequire } from 'node:module';\nconst require = __c4sCreateRequire(import.meta.url);" },
  // The manifest must keep its default + named `manifest` export — matches
  // vite.config.ts's own `minify: false` for the same reason.
  minify: false,
  sourcemap: false,
  logLevel: 'warning',
});

const [out] = result.outputFiles;
writeFileSync(ENTRY, out.text);

// Sanity check: `express` must actually be gone as a bare import — fail loudly
// rather than silently shipping a broken dist/. `zod` must ALSO never appear as
// a bare import, but for the opposite reason: it is never imported (backend
// schema code uses the host's `z` via `@c4s/plugin-runtime`), so a stray
// `from 'zod'` would mean a bundled second instance slipped in.
const written = readFileSync(ENTRY, 'utf8');
for (const dep of ['express', 'zod']) {
  const re = new RegExp(`from\\s*["']${dep}["']`);
  if (re.test(written)) {
    console.error(`bundle-backend-deps: '${dep}' is still a bare import in ${ENTRY} — bundling failed`);
    process.exit(1);
  }
}
console.log(`bundle-backend-deps: inlined express into ${ENTRY}`);
