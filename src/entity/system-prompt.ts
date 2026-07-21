/**
 * System prompt contribution (required — without it the entity type is invisible
 * to the agent). Tells the agent what a spreadsheet IS (`roleNoun`), how to count
 * them (`countStat` against the metadata table), which tools it has
 * (`mcpToolsLine`), and — crucially — the overview-first discipline
 * (`narrativeBlock`).
 */

import type { SystemPromptContribution } from '@c4s/plugin-runtime';
import { SPREADSHEET_TABLE, SPREADSHEET_TYPE } from '../identity';

export const spreadsheetSystemPrompt: SystemPromptContribution = {
  roleNoun: 'spreadsheets',
  countStat: {
    placeholder: 'spreadsheetCount',
    sqlQuery: `SELECT count(*) FROM ${SPREADSHEET_TABLE}`,
    label: SPREADSHEET_TYPE,
  },
  mcpToolsLine:
    'Tools under `spreadsheet-tools`: get_overview (dimensions + header flags + perimeter header ' +
    'labels, no body cells), get_range (a 1-based inclusive window of cells), set_cell and set_range ' +
    '(point writes; value "" deletes a cell). Create/rename/resize a sheet with the generic entity tools.',
  narrativeBlock:
    'Spreadsheets are read OVERVIEW-FIRST — a reading discipline that pays off at ANY size, ' +
    'not only for large sheets. Never pull the whole grid when you only need its shape.\n' +
    '1. ALWAYS start from the overview — dimensions (nRows × nCols), the header_row / header_col ' +
    'flags, and the perimeter header labels (names from row 1 and column 1) — before touching any ' +
    'body content. The serializer `detail` projection and `get_overview` both return exactly this ' +
    'skeleton with header labels, never body cells.\n' +
    '2. Because the overview already carries the header names, you do NOT need a separate range read ' +
    'just for labels. Fetch only BODY cell content by RANGES via `spreadsheet-tools` (get_range), in ' +
    'windows sized to what you actually need — never the entire sheet at once. Indices are 1-based ' +
    'and inclusive.\n' +
    '3. Do NOT equate the `detail`/overview projection with body content: the overview is the shape ' +
    'plus header labels. Body cells are always a separate, explicit range read.',
};
