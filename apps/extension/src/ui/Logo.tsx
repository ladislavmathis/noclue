import React, { useId } from 'react';

/** Stroke compensation from the design manual for small sizes. */
function stroke(size: number) {
  if (size <= 16) return { width: 16, dot: 9 };
  if (size <= 32) return { width: 15, dot: 8.5 };
  if (size <= 64) return { width: 14, dot: 8 };
  return { width: 13, dot: 7.5 };
}

/** The question-mark glyph alone, in currentColor (empty states, inline marks). */
export function Glyph({ size = 24 }: { size?: number }) {
  const s = stroke(size);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <path
        d="M30 34 A20 20 0 1 1 58 52 Q50 57 50 66 L50 70"
        fill="none"
        stroke="currentColor"
        strokeWidth={s.width}
        strokeLinecap="round"
      />
      <circle cx="50" cy="88" r={s.dot} fill="currentColor" />
    </svg>
  );
}

/** App icon tile: radius 25 % of the side, glyph ~62 % of the tile. */
export function IconTile({ size = 32, dark = false }: { size?: number; dark?: boolean }) {
  const id = useId().replace(/:/g, '');
  const s = stroke(size);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id={`nc-g-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF7A3C" />
          <stop offset="1" stopColor="#F35216" />
        </linearGradient>
      </defs>
      <rect width="100" height="100" rx="25" fill={dark ? '#171717' : `url(#nc-g-${id})`} />
      <g transform="translate(19 19) scale(.62)">
        <path
          d="M30 34 A20 20 0 1 1 58 52 Q50 57 50 66 L50 70"
          fill="none"
          stroke={dark ? '#F35216' : '#FFFFFF'}
          strokeWidth={s.width}
          strokeLinecap="round"
        />
        <circle cx="50" cy="88" r={s.dot} fill={dark ? '#F35216' : '#FFFFFF'} />
      </g>
    </svg>
  );
}

/**
 * Horizontal lockup, scaled from the 96 px reference (gap 22, wordmark 52, subtitle 20).
 * The subtitle "by ignition" may be left out inside the app itself (manual §01).
 */
export function Logo({ icon = 32, subtitle = false }: { icon?: number; subtitle?: boolean }) {
  const k = icon / 96;
  return (
    <span
      className="nc-logo"
      style={{ gap: 22 * k }}
      role="img"
      aria-label={subtitle ? 'noclue by ignition' : 'noclue'}
    >
      <IconTile size={icon} />
      <span className="nc-wordmark" style={{ gap: 4 * k }} aria-hidden="true">
        <span className="nc-name" style={{ fontSize: 52 * k }}>
          noclue
        </span>
        {subtitle && (
          <span className="nc-by" style={{ fontSize: 20 * k }}>
            by <b>ignition</b>
          </span>
        )}
      </span>
    </span>
  );
}
