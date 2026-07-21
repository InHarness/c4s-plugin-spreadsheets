/**
 * L4 — Express READ router for `spreadsheet`, mounted under `pathPrefix`
 * (`/spreadsheets`; the host prepends `/api/projects/:id`). The host exposes no
 * generic entity-read endpoint, so the NodeView and agents read through here.
 * Overview-first: a cheap skeleton, then rectangular / row / column windows.
 *
 *   GET /:slug/overview                    → SpreadsheetOverviewDto   200 / 404
 *   GET /:slug/range?r1&c1&r2&c2           → SpreadsheetRangeDto       200 / 400 / 404
 *   GET /:slug/rows?from&to                → SpreadsheetRangeDto       200 / 400 / 404
 *   GET /:slug/columns?from&to             → SpreadsheetRangeDto       200 / 400 / 404
 *
 * All range indices are 1-based inclusive → SQL `BETWEEN` (in the service). This
 * router is READ-ONLY; sheet creation and cell writes go through the host's
 * `entity-tools` (create) and the `spreadsheet-tools` MCP server (cell writes).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { MountContext } from '@c4s/plugin-runtime';
import { SpreadsheetService } from './services';

function notFound(res: Response): Response {
  return res.status(404).json({ error: { code: 'NOT_FOUND' } });
}

function badRequest(res: Response, message: string): Response {
  return res.status(400).json({ error: { code: 'BAD_REQUEST', message } });
}

/** Parse a required positive-integer query param; returns `null` when invalid. */
function posInt(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export function createSpreadsheetRouter(service: SpreadsheetService, _ctx: MountContext): Router {
  const router = Router();

  // GET /:slug/overview — cheap skeleton (dims + header flags + perimeter header
  // labels from row 1 / column 1, no body cells).
  router.get('/:slug/overview', (req: Request, res: Response) => {
    const overview = service.overview(String(req.params.slug));
    if (!overview) return notFound(res);
    res.status(200).json(overview);
  });

  // GET /:slug/range?r1&c1&r2&c2 — rectangular window, 1-based inclusive.
  router.get('/:slug/range', (req: Request, res: Response) => {
    const r1 = posInt(req.query.r1);
    const c1 = posInt(req.query.c1);
    const r2 = posInt(req.query.r2);
    const c2 = posInt(req.query.c2);
    if (r1 === null || c1 === null || r2 === null || c2 === null) {
      return badRequest(res, 'r1, c1, r2, c2 must be integers >= 1');
    }
    if (r2 < r1 || c2 < c1) return badRequest(res, 'r2 >= r1 and c2 >= c1 required');
    const range = service.getRange(String(req.params.slug), r1, c1, r2, c2);
    if (!range) return notFound(res);
    res.status(200).json(range);
  });

  // GET /:slug/rows?from&to — full rows across the whole width.
  router.get('/:slug/rows', (req: Request, res: Response) => {
    const from = posInt(req.query.from);
    const to = posInt(req.query.to);
    if (from === null || to === null) return badRequest(res, 'from, to must be integers >= 1');
    if (to < from) return badRequest(res, 'to >= from required');
    const range = service.getRows(String(req.params.slug), from, to);
    if (!range) return notFound(res);
    res.status(200).json(range);
  });

  // GET /:slug/columns?from&to — full columns across the whole height.
  router.get('/:slug/columns', (req: Request, res: Response) => {
    const from = posInt(req.query.from);
    const to = posInt(req.query.to);
    if (from === null || to === null) return badRequest(res, 'from, to must be integers >= 1');
    if (to < from) return badRequest(res, 'to >= from required');
    const range = service.getColumns(String(req.params.slug), from, to);
    if (!range) return notFound(res);
    res.status(200).json(range);
  });

  return router;
}
