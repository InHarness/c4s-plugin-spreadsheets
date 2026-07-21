/**
 * The `<spreadsheet slug caption/>` NodeView — the ONLY frontend surface of the
 * hidden `spreadsheet` entity. A Tiptap `Node` (block, atom, non-editable)
 * carrying `slug` + `caption`, whose `addNodeView` mounts a read-only React grid.
 *
 * The grid is overview-first: it fetches the overview (dimensions + header flags),
 * then a virtualized visible RANGE window (~50 rows), and refetches the visible
 * window on the `entity:changed` WebSocket event for its slug. A missing / broken
 * reference (overview 404) renders a fallback instead of a grid.
 *
 * `@tiptap/core` and `react`/`react-dom` are host-provided peers (externalized in
 * the build). We mount React manually via `react-dom/client` (no `@tiptap/react`
 * dependency — it is not a host peer).
 */

import { Node, mergeAttributes } from '@tiptap/core';
import type { NodeViewRendererProps } from '@tiptap/core';
import { createElement, useEffect, useMemo, useState } from 'react';
import type { FC } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import type { SpreadsheetOverviewDto } from '../dto';
import { fetchOverview, fetchRange, useEntityChanged } from './hooks';
import { renderInlineMarkdown } from './inline-markdown';

/** Working virtualization window (rows) — see `synchronizacja.md`. */
const ROW_WINDOW = 50;

// ── React grid ─────────────────────────────────────────────────────────────

const SpreadsheetGrid: FC<{ slug: string; caption?: string }> = ({ slug, caption }) => {
  const [overview, setOverview] = useState<SpreadsheetOverviewDto | null | undefined>(undefined);
  const [start, setStart] = useState<number>(1);
  const [cells, setCells] = useState<string[][]>([]);
  const [reloadKey, setReloadKey] = useState<number>(0);

  // Overview (cheap). `null` ⇒ broken reference.
  useEffect(() => {
    let alive = true;
    fetchOverview(slug)
      .then((ov) => alive && setOverview(ov))
      .catch(() => alive && setOverview(null));
    return () => {
      alive = false;
    };
  }, [slug, reloadKey]);

  const nRows = overview?.nRows ?? 0;
  const nCols = overview?.nCols ?? 0;

  const window = useMemo(() => {
    const r1 = Math.max(1, Math.min(start, Math.max(1, nRows)));
    const r2 = Math.min(nRows, r1 + ROW_WINDOW - 1);
    return { r1, r2 };
  }, [start, nRows]);

  // Visible range window.
  useEffect(() => {
    if (!overview || nRows < 1 || nCols < 1) {
      setCells([]);
      return;
    }
    let alive = true;
    fetchRange(slug, window.r1, 1, window.r2, nCols)
      .then((range) => alive && setCells(range?.cells ?? []))
      .catch(() => alive && setCells([]));
    return () => {
      alive = false;
    };
  }, [slug, overview, nRows, nCols, window.r1, window.r2, reloadKey]);

  // Refetch on host `entity:changed` for this sheet.
  useEntityChanged(slug, () => setReloadKey((k) => k + 1));

  if (overview === undefined) {
    return createElement('div', { className: 'c4s-spreadsheet c4s-spreadsheet--loading' }, 'Loading spreadsheet…');
  }
  if (overview === null) {
    return createElement(
      'div',
      { className: 'c4s-spreadsheet c4s-spreadsheet--broken', 'data-broken-ref': slug },
      `⚠ Spreadsheet "${slug}" is missing or inactive.`,
    );
  }

  const headerRow = overview.headerRow;
  const headerCol = overview.headerCol;

  const rowEls = cells.map((row, i) => {
    const absR = window.r1 + i;
    const isHeaderRow = headerRow && absR === 1;
    const cellEls = row.map((value, j) => {
      const absC = j + 1;
      const isHeaderCol = headerCol && absC === 1;
      const isHeader = isHeaderRow || isHeaderCol;
      // The cell string is rendered as INLINE markdown (code, bold, links). It is
      // still a plain string in storage/index/serializer — this render is the only
      // place markdown is interpreted.
      return createElement(
        isHeader ? 'th' : 'td',
        {
          key: `${absR}:${absC}`,
          scope: isHeaderRow ? 'col' : isHeaderCol ? 'row' : undefined,
          className: 'c4s-spreadsheet__cell',
        },
        ...renderInlineMarkdown(value, `${absR}:${absC}`),
      );
    });
    return createElement('tr', { key: absR, className: 'c4s-spreadsheet__row' }, cellEls);
  });

  const table = createElement(
    'table',
    { className: 'c4s-spreadsheet__table' },
    createElement('tbody', null, rowEls),
  );

  const windowedBelow = window.r2 < nRows;
  const windowedAbove = window.r1 > 1;
  const controls =
    windowedAbove || windowedBelow
      ? createElement(
          'div',
          { className: 'c4s-spreadsheet__pager' },
          createElement(
            'button',
            {
              type: 'button',
              disabled: !windowedAbove,
              onClick: () => setStart((s) => Math.max(1, s - ROW_WINDOW)),
            },
            '↑ Prev rows',
          ),
          createElement(
            'span',
            { className: 'c4s-spreadsheet__range-label' },
            `rows ${window.r1}–${window.r2} of ${nRows}`,
          ),
          createElement(
            'button',
            {
              type: 'button',
              disabled: !windowedBelow,
              onClick: () => setStart((s) => Math.min(nRows, s + ROW_WINDOW)),
            },
            '↓ Next rows',
          ),
        )
      : null;

  return createElement(
    'div',
    { className: 'c4s-spreadsheet', 'data-slug': slug },
    caption ? createElement('div', { className: 'c4s-spreadsheet__caption' }, caption) : null,
    createElement(
      'div',
      { className: 'c4s-spreadsheet__meta' },
      `${nRows}×${nCols}${headerRow ? ' · header row' : ''}${headerCol ? ' · header col' : ''}`,
    ),
    createElement('div', { className: 'c4s-spreadsheet__scroll' }, table),
    controls,
  );
};

// ── Tiptap node ──────────────────────────────────────────────────────────────

/**
 * The `spreadsheet` Tiptap node. Atom (no editable content), draggable block,
 * parsed from / serialized to the `<spreadsheet slug caption/>` tag. The host
 * adds this extension to its editor via `FrontendModule.editorExtensions`.
 */
export const spreadsheetNode = Node.create({
  name: 'spreadsheet',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      slug: { default: null },
      caption: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'spreadsheet' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['spreadsheet', mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return (props: NodeViewRendererProps) => {
      const dom = document.createElement('div');
      dom.className = 'c4s-spreadsheet-nodeview';
      dom.setAttribute('data-type', 'spreadsheet');
      const slug = String(props.node.attrs.slug ?? '');
      const caption =
        props.node.attrs.caption != null ? String(props.node.attrs.caption) : undefined;

      let root: Root | null = null;
      if (slug) {
        root = createRoot(dom);
        root.render(createElement(SpreadsheetGrid, { slug, caption }));
      } else {
        dom.textContent = '⚠ <spreadsheet/> is missing a slug.';
      }

      return {
        dom,
        // Atom node — ignore all ProseMirror mutations inside our React subtree.
        ignoreMutation: () => true,
        destroy: () => {
          // Defer unmount out of React's render cycle.
          const r = root;
          if (r) setTimeout(() => r.unmount(), 0);
        },
      };
    };
  },
});
