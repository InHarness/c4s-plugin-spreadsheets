/**
 * `PluginManifest` — the plugin envelope (host 1.0.0 contract).
 *
 * The host loader does `await import(pkg)`, extracts the manifest (`export manifest`
 * or `default`), gates `hostApiVersion` / `engines`, then fans out per capability
 * kind. The package ONLY exports the manifest — the host drives registration.
 *
 * The `spreadsheet` plugin is base-tier and contributes a single hidden entity
 * type; it brings no gating `settings` and no writing styles / commands.
 *
 *  - `onUnregister` is REQUIRED, lives HERE (on the manifest), must be idempotent,
 *    must NOT throw, and must NOT drop the index tables — sheet data survives
 *    unregister (`ac-onunregister-pluginu-jest-idempotentny`).
 *  - `hostApiVersion` must satisfy `semver.satisfies(HOST_API_VERSION, range)`;
 *    a mismatch raises `PLUGIN_HOST_API_MISMATCH` and the plugin stays inactive.
 */

import type { PluginManifest } from '@c4s/plugin-runtime';
import { spreadsheetEntity } from './entity';

export const manifest: PluginManifest = {
  // KEEP in sync with package.json "name".
  name: 'c4s-plugin-spreadsheets',
  version: '0.0.3',
  // Host API range. Host 1.0.0 must satisfy this.
  hostApiVersion: '^1.0.0',
  engines: { node: '>=20' },

  /**
   * REQUIRED teardown. Called on the OLD version before re-register during
   * hot-reload. Idempotent and never throws. The host already drops the entity /
   * MCP / routes registrations on unregister; we deliberately do NOT drop the
   * `spreadsheet` / `spreadsheet_cell` index tables — sheet data outlives the
   * plugin's registration. No global resources of our own to detach.
   */
  onUnregister(): void {
    // Intentionally empty and idempotent. Never drop index tables here.
  },

  contributes: {
    entities: [spreadsheetEntity],
  },
};

export default manifest;
