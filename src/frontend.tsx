/**
 * Frontend ENTRY — evaluating this module registers the frontend module as a side
 * effect (`registerFrontendModule`). The host loads it as native ESM via the
 * import-map shim; React/Tiptap are externalized (provided by the host).
 *
 * `spreadsheet` is a HIDDEN entity: it has NO `sidebarTab` and NO `routes`, so it
 * never appears in navigation and has no list/detail screen — omitting those slots
 * IS what hides it (`ac-encja-spreadsheet-jest-ukryta`). Its only surface is the
 * `<spreadsheet/>` NodeView, delivered as a Tiptap extension in `editorExtensions`,
 * plus the `/spreadsheet` slash command.
 *
 * The `FrontendModule` type still REQUIRES the render slots
 * (`renderChip/renderCard/renderRow/detailPanel`); for a hidden entity they are
 * never reached, so they are trivial no-op stubs (see the filed patch). The
 * `<spreadsheet/>` reference tag itself is registered declaratively backend-side
 * via `EntityContribution.frontend.referenceType` (M19 Slot B, `entity/index.ts`).
 */

import { registerFrontendModule } from '@c4s/plugin-runtime';
import type { EditorExtensionRegistration, FrontendModule } from '@c4s/plugin-runtime';
import {
  SPREADSHEET_TYPE,
  SPREADSHEET_TABLE,
  SPREADSHEET_LABEL,
  SPREADSHEET_LABEL_PLURAL,
  SPREADSHEET_DISPLAY_ORDER,
  SPREADSHEET_PATH_PREFIX,
  spreadsheetSlugFrom,
} from './identity';
import { useGetBySlug, listByTags } from './entity/frontend/hooks';
import { spreadsheetSlashCommand } from './entity/frontend/slash-command';
import { spreadsheetNode } from './entity/frontend/node-view';

/**
 * No-op render stubs. A hidden entity is never rendered as a chip / card / row /
 * detail — it appears only through the `<spreadsheet/>` NodeView — but the
 * `FrontendModule` contract requires these slots to be present.
 */
const NullRender = () => null;

/** The `<spreadsheet/>` NodeView, delivered as a Tiptap extension to the host editor. */
const spreadsheetNodeExtension: EditorExtensionRegistration = {
  name: `${SPREADSHEET_TYPE}-nodeview`,
  extension: spreadsheetNode,
};

export const SpreadsheetFrontendModule: FrontendModule = {
  // ── Identity (must match the backend EntityContribution) ──
  type: SPREADSHEET_TYPE,
  table: SPREADSHEET_TABLE,
  label: SPREADSHEET_LABEL,
  labelPlural: SPREADSHEET_LABEL_PLURAL,
  displayOrder: SPREADSHEET_DISPLAY_ORDER,
  pathPrefix: SPREADSHEET_PATH_PREFIX,
  slugFrom: spreadsheetSlugFrom,

  // ── Required render slots — never reached for a hidden entity ──
  renderChip: NullRender as FrontendModule['renderChip'],
  renderCard: NullRender as FrontendModule['renderCard'],
  renderRow: NullRender as FrontendModule['renderRow'],
  detailPanel: NullRender as FrontendModule['detailPanel'],

  // ── Data resolution (overview only; listByTags is a no-op) ──
  useGetBySlug,
  listByTags,

  // ── Editor surface: the NodeView extension + the /spreadsheet slash command ──
  editorExtensions: [spreadsheetNodeExtension, spreadsheetSlashCommand],

  // Intentionally NO `sidebarTab` and NO `routes` — this is what hides the entity.
};

registerFrontendModule(SpreadsheetFrontendModule);

export default SpreadsheetFrontendModule;
