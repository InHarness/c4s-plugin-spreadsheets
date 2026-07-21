# c4s-plugin-scaffold

An empty-but-working **claude4spec (C4S) host plugin** scaffold for the **host
1.0.0 contract**. It ships a single, generic placeholder entity type —
`example-entity` — wired through the full plugin anatomy (envelope → `contributes`
→ slots; layers L1–L9 + M05). `degit` it, run the rename-map below, and replace
the placeholder with your own entity type.

```sh
npx degit <this-repo> my-plugin
cd my-plugin && npm install
npm run build       # emits dist/index.js (backend) + dist/frontend.js (frontend)
```

## Anatomy

The plugin **envelope** is a `PluginManifest` (`src/manifest.ts`): `name`,
`version`, `hostApiVersion`, `engines`, idempotent `onUnregister()`, and
`contributes`. Only `contributes.entities` is filtered by `config.entities`;
`writingStyles` / `settings` / `commands` are always registered.

The one entity contribution (`src/entity/index.ts`) fills four slots — `serializer`
(L9, **required**), `systemPrompt` (**required**), `backend?` (L1 migrations /
L3 MCP / L4 router), `frontend?` (M05).

| Layer | Where |
|---|---|
| L1 — migrations (derived SQLite index; `.json` is source of truth) | `src/entity/backend/migrations.ts` |
| L3 — MCP tools server (registered as a **factory**) | `src/entity/backend/mcp-server.ts` |
| L4 — Express router (6 routes under `pathPrefix`) | `src/entity/backend/routes.ts`, `services.ts` |
| L9 — serializer (views + snapshot/restore/diff) | `src/entity/serializer.ts` |
| M05 — frontend (render slots, list/detail screens, editor + slash) | `src/frontend.tsx`, `src/entity/frontend/*` |

## Rename-map (the only manual step)

After `degit`, swap these tokens for your own entity type. The structure rules
carry over 1:1; only the names change.

| Token | What it is | Replace with |
|---|---|---|
| `example-entity` | entity `type`, feature-slice tag | your type (kebab-case) |
| `example_entity` | SQL table id (snake_case, never `table`) | your table (snake_case) |
| `/example-entities` | router `pathPrefix` | your `pathPrefix` |
| `ExampleEntity*` | DTO / symbol names (PascalCase) | your DTO names |
| `/example-entity` | editor slash-command | your slash-command |
| `styl-specyfikacji-pluginu-c4s` | writing-style slug | your slug |

Concrete edit targets:

- **Manifest** (`src/manifest.ts`): set `name`, `version`, `hostApiVersion`
  (range vs `HOST_API_VERSION = 1.0.0`); implement an idempotent `onUnregister()`.
- **Identity** (`src/identity.ts`): `type`, `table`, `pathPrefix`, labels.
- **L1** (`migrations.ts`): forward-only, idempotent (`CREATE TABLE IF NOT EXISTS`)
  columns mirroring `ExampleEntitySnapshot`.
- **L3** (`mcp-server.ts`): registered via the factory
  `ctx.registerMcpServer('<type>-tools', factory)`.
- **L4** (`routes.ts`): list returns `*ListItem` (no `data`); `slug = slugify(name)`;
  rename only via `newSlug`; `restore` = idempotent UPSERT; `DELETE` no FK cascade.
- **L9** (`serializer.ts`): deterministic `snapshot()`, idempotent `restore()`.
- **System prompt** (`system-prompt.ts`): `countStat.sqlQuery`, `roleNoun`,
  `mcpToolsLine`.
- **M05** (`src/entity/frontend/*`): required `detailPanel` (`useGetBySlug`,
  loading / not-found); `renderChip` handles `entity = null` (broken state);
  list screen composed from the Host UI Kit; keep `@c4s/plugin-runtime/ui`
  externalized in Vite.

## Host API contract

The single source of truth for concrete contract values is the spec page
`pages/synchronizacja.md`: `HOST_API_VERSION = 1.0.0`, runtime package
`@inharness-ai/claude4spec`. The version gate is
`semver.satisfies(HOST_API_VERSION, manifest.hostApiVersion)`; a mismatch raises
`PLUGIN_HOST_API_MISMATCH` (plugin installed but inactive). The `engines.node`
gate raises `PLUGIN_ENGINE_UNSATISFIED`.

## Local dev against a host

```sh
npm run dev          # vite build --watch
```

Expose the built `dist/` to a local host (e.g. a project-local overlay under
`<project>/.claude4spec/plugins/c4s-plugin-scaffold/`), trust the project's plugins,
add the entity type to `config.entities`, and verify via the **per-project**
routes — `GET /api/projects/:id/_meta/plugins` (this package's entry should show
`status: "loaded"` and the response's top-level `trust: true`; the bare
`GET /api/_meta/plugins` only reports base-tier packages and never reflects an
overlay/plugin mount, so it's useless here) and
`GET /api/projects/:id/_meta/entities` (the entity type should appear under
`active`, not `inactive`/`unknown`).

`docker/plugin-smoke.sh` automates this whole loop against a real, running host in
Docker — see the `c4s-brief-implementer` skill's "Smoke-test in Docker" step.
