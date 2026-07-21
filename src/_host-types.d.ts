/**
 * Pull in the host's PUBLISHED Host API types. This single reference types both
 * the `@c4s/plugin-runtime` (+ `/ui`) value specifiers a plugin imports AND all
 * the type names — replacing the old vendored `c4s-runtime.d.ts`. Requires the
 * `@inharness-ai/claude4spec` devDependency. Offline? See
 * `fallback/c4s-runtime.fallback.d.ts`.
 */
/// <reference types="@inharness-ai/claude4spec/plugin-runtime/ambient" />
