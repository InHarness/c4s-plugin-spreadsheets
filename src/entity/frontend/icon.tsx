/**
 * The `spreadsheet` type glyph — a grid icon. The hidden entity has no sidebar tab
 * or list header, so this is available for the slash-command menu / NodeView chrome
 * where an icon is wanted. Inline SVG (no `lucide-react` dependency);
 * `stroke="currentColor"` + a forwarded `style` let each call site tint it.
 */

import type { CSSProperties, FC } from 'react';
export const SpreadsheetIcon: FC<{
  className?: string;
  size?: number | string;
  style?: CSSProperties;
}> = ({ className, size = 16, style }) => (
  <svg
    className={className}
    style={style}
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    aria-hidden="true"
  >
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
    <path d="M5 8h6M5 5.5h6M5 10.5h3" />
  </svg>
);
