/**
 * L8 — the `/spreadsheet` slash command. Since the entity is hidden (no list /
 * detail navigation), this is the ONLY way to put a sheet on a page: it creates
 * the entity (`name → slug = slugify(name)`) and inserts a
 * `<spreadsheet slug caption/>` reference at the cursor. The create + insert flow
 * is dispatched by the host popover keyed on `pluginPopoverKind` (analogous to
 * `/diagram`). Wired into the frontend module via `editorExtensions`.
 */

import type { EditorExtensionRegistration } from '@c4s/plugin-runtime';
import { SPREADSHEET_TYPE } from '../../identity';

export const spreadsheetSlashCommand: EditorExtensionRegistration = {
  name: `${SPREADSHEET_TYPE}-slash`,
  slashCommand: {
    id: SPREADSHEET_TYPE,
    label: '/spreadsheet',
    description: 'Create a spreadsheet and embed it here',
    hint: 'name',
    pluginPopoverKind: `${SPREADSHEET_TYPE}-create`,
  },
};
