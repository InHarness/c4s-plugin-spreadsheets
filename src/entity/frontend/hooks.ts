/**
 * Frontend data-resolution for the read-only NodeView. The grid is purely
 * presentational — it fetches the sheet through the plugin's own router
 * (`/api/projects/<id>/spreadsheets/...`), overview-first (cheap skeleton, then a
 * visible range window), and refetches on the `entity:changed` WebSocket event.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpreadsheetOverviewDto, SpreadsheetRangeDto } from '../dto';

/** Resolve the current project id from the host-provided global (default `default`). */
function projectId(): string {
  return (globalThis as { __C4S_PROJECT__?: { id?: string } }).__C4S_PROJECT__?.id ?? 'default';
}

function apiBase(): string {
  return `/api/projects/${projectId()}/spreadsheets`;
}

/** Fetch the cheap overview (dimensions + header flags, no cells). */
export async function fetchOverview(slug: string): Promise<SpreadsheetOverviewDto | null> {
  const res = await fetch(`${apiBase()}/${encodeURIComponent(slug)}/overview`);
  if (res.status === 404 || !res.ok) return null;
  return (await res.json()) as SpreadsheetOverviewDto;
}

/** Fetch a 1-based inclusive rectangular window of cells. */
export async function fetchRange(
  slug: string,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): Promise<SpreadsheetRangeDto | null> {
  const params = new URLSearchParams({
    r1: String(r1),
    c1: String(c1),
    r2: String(r2),
    c2: String(c2),
  });
  const res = await fetch(`${apiBase()}/${encodeURIComponent(slug)}/range?${params.toString()}`);
  if (res.status === 404 || !res.ok) return null;
  return (await res.json()) as SpreadsheetRangeDto;
}

/**
 * `FrontendModule.useGetBySlug` slot — the host requires it. For the hidden
 * spreadsheet entity it resolves the overview (never cells): `undefined` while
 * loading, `null` when the sheet is missing (broken ref), else the overview.
 */
export function useGetBySlug(slug: string | null): {
  data: SpreadsheetOverviewDto | null | undefined;
  isLoading: boolean;
} {
  const [data, setData] = useState<SpreadsheetOverviewDto | null | undefined>(undefined);
  const [isLoading, setLoading] = useState<boolean>(Boolean(slug));

  useEffect(() => {
    if (!slug) {
      setData(undefined);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    fetchOverview(slug)
      .then((ov) => {
        if (alive) setData(ov);
      })
      .catch(() => {
        if (alive) setData(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [slug]);

  return { data, isLoading };
}

/**
 * `FrontendModule.listByTags` slot — the hidden entity has no tag-filtered list
 * surface, so this is a no-op returning no slugs.
 */
export async function listByTags(_args: {
  tags: string[];
  filter: 'and' | 'or';
}): Promise<Array<{ slug: string }>> {
  return [];
}

/**
 * Subscribe to the host WebSocket and invoke `onChange` when THIS sheet changes.
 *
 * The host broadcasts `{ kind: 'entity:changed', entityType, slug }` (see
 * `SpreadsheetService.broadcast`). The exact WS endpoint/envelope for the client
 * is not part of the published Host API (see the filed patch), so this is
 * best-effort: it connects to `/api/projects/<id>/ws`, tolerates other frame
 * shapes, and silently no-ops if the socket can't be opened. React-query is not
 * used here — the NodeView owns its own fetch lifecycle.
 */
export function useEntityChanged(slug: string | null, onChange: () => void): void {
  const cb = useRef(onChange);
  cb.current = onChange;

  useEffect(() => {
    if (!slug || typeof WebSocket === 'undefined') return;
    let socket: WebSocket | null = null;
    try {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/api/projects/${projectId()}/ws`);
    } catch {
      return;
    }
    const handle = (ev: MessageEvent) => {
      try {
        const msg = JSON.parse(String(ev.data)) as {
          kind?: string;
          entityType?: string;
          slug?: string;
        };
        if (msg.kind === 'entity:changed' && msg.entityType === 'spreadsheet' && msg.slug === slug) {
          cb.current();
        }
      } catch {
        // Non-JSON frame — ignore.
      }
    };
    socket.addEventListener('message', handle);
    return () => {
      socket?.removeEventListener('message', handle);
      socket?.close();
    };
  }, [slug]);
}

/** Stable clamp helper for range windows. */
export function useClampedWindow(nRows: number, windowSize: number) {
  return useCallback(
    (start: number): { r1: number; r2: number } => {
      const r1 = Math.max(1, Math.min(start, Math.max(1, nRows)));
      const r2 = Math.min(nRows, r1 + windowSize - 1);
      return { r1, r2 };
    },
    [nRows, windowSize],
  );
}
