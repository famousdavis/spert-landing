// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import { apps } from '../data/apps';

/**
 * Every tile's link label ("Map Your Releases →") is drawn in a color taken from
 * `src/data/apps.tsx`, on the tile's own background. Before 2.6.0 that color was
 * the tile's brand color in both themes, and all nine tiles measured under the
 * WCAG AA minimum of 4.5:1 in at least one of them. No single color can pass on
 * both backgrounds — it would need relative luminance ≤ 0.1833 and ≥ 0.2167 at
 * once — so a tile carries `labelColor` / `labelColorDark` where its brand color
 * fails. Nothing else notices a miss: the build, types and lint all pass, and
 * the label simply renders hard to read.
 *
 * This guard holds every entry in `apps` to 4.5:1 in both themes, including
 * any tile added later.
 */

const AA_MINIMUM = 4.5;

/**
 * The tile backgrounds. These are PREMISES, not measurements: they restate
 * `bg-white` and `dark:bg-zinc-900` from `TILE_CLASS`, and the premises test
 * below fails if those classes change. Tailwind 4.2.4 defines zinc-900 as
 * `oklch(21% 0.006 285.885)`, which is exactly `#18181b` in sRGB.
 */
const LIGHT_TILE_BG = '#ffffff';
const DARK_TILE_BG = '#18181b';

const HEX = /^#[0-9a-f]{6}$/i;

/** Parse `#rrggbb`, or throw naming the tile — never compute on input that will not parse. */
function parseHex(value: unknown, where: string): [number, number, number] {
  if (typeof value !== 'string' || !HEX.test(value)) {
    throw new Error(`${where}: color ${JSON.stringify(value)} is not #rrggbb, so its contrast cannot be checked`);
  }
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG 2.2 relative luminance (sRGB linearisation threshold 0.04045). */
function luminance(hex: string, where: string): number {
  const [r, g, b] = parseHex(hex, where).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string, where: string): number {
  const a = luminance(fg, where);
  const b = luminance(bg, `${where} (background)`);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

type Theme = 'light' | 'dark';

const THEMES: Record<Theme, { background: string; label: (app: (typeof apps)[number]) => string }> = {
  light: { background: LIGHT_TILE_BG, label: (app) => app.labelColor ?? app.color },
  dark: { background: DARK_TILE_BG, label: (app) => app.labelColorDark ?? app.color },
};

/** Check every tile in one theme; returns the failures and how many checks ran. */
function checkTheme(theme: Theme): { failures: string[]; checked: number } {
  const { background, label } = THEMES[theme];
  const failures: string[] = [];
  let checked = 0;
  for (const app of apps) {
    const fg = label(app);
    const ratio = contrast(fg, background, `"${app.name}" (${theme} theme)`);
    checked += 1;
    if (ratio < AA_MINIMUM) {
      failures.push(
        `"${app.name}" ${theme} theme: label ${fg} on ${background} is ${ratio.toFixed(2)}:1, under ${AA_MINIMUM}:1`,
      );
    }
  }
  return { failures, checked };
}

describe('tile link labels meet WCAG AA contrast', () => {
  it('computes contrast correctly (self-check against known values)', () => {
    expect(contrast('#000000', '#ffffff', 'self-check').toFixed(2)).toBe('21.00');
    expect(contrast('#767676', '#ffffff', 'self-check').toFixed(2)).toBe('4.54');
  });

  it('refuses a color that is not #rrggbb, naming the tile', () => {
    for (const bad of ['#fff', 'red', '#8b5cf6 ', 'rgb(0, 0, 0)', '', undefined]) {
      expect(() => contrast(bad as string, LIGHT_TILE_BG, '"Some Tile" (light theme)')).toThrow(
        /"Some Tile" \(light theme\): color .* is not #rrggbb/,
      );
    }
  });

  it('still measures against the tile backgrounds AppTile renders', () => {
    const source = readFileSync(new URL('../components/AppTile.tsx', import.meta.url), 'utf8');
    const match = /const TILE_CLASS = "([^"]*)";/.exec(source);
    expect(
      match,
      'could not find `const TILE_CLASS = "…";` in src/components/AppTile.tsx — this guard reads the tile ' +
        'background from it; update the guard to match the new shape',
    ).not.toBeNull();

    const tokens = new Set((match?.[1] ?? '').split(/\s+/));
    const updateMessage = (cls: string, constant: string, value: string) =>
      `TILE_CLASS no longer contains \`${cls}\`. The tile background has changed, so this guard's ` +
      `${constant} (${value}) no longer describes it: update the background constants in ` +
      'src/guards/tile-contrast.test.ts to the new background before trusting its results';

    expect(tokens.has('bg-white'), updateMessage('bg-white', 'LIGHT_TILE_BG', LIGHT_TILE_BG)).toBe(true);
    expect(tokens.has('dark:bg-zinc-900'), updateMessage('dark:bg-zinc-900', 'DARK_TILE_BG', DARK_TILE_BG)).toBe(
      true,
    );
  });

  it.each<Theme>(['light', 'dark'])('every tile’s %s-theme label is at least 4.5:1', (theme) => {
    const { failures, checked } = checkTheme(theme);

    // An empty failure list cannot tell "nothing failed" from "nothing was checked".
    expect(apps.length).toBeGreaterThan(0);
    expect(checked).toBe(apps.length);

    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('ran two checks per tile across both themes', () => {
    const total = checkTheme('light').checked + checkTheme('dark').checked;
    expect(total).toBe(apps.length * 2);
  });
});
