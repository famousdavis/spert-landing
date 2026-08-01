// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { describe, it, expect } from 'vitest';

import { changelog } from '../data/changelog';
import { APP_VERSION } from '../config';

/**
 * The changelog page renders `src/data/changelog.ts` directly. Unlike the rest
 * of the suite there is no `CHANGELOG.md` here, so this single file is the only
 * surface — which removes a whole class of drift, but leaves the other one:
 *
 * An entry with no sections, or a section with no items, renders as a bare
 * version heading with nothing beneath it. The data file is valid TypeScript
 * either way, so `next build` succeeds, types check and lint passes. Nothing
 * but a person opening the page would notice.
 *
 * SPERT Forecaster shipped exactly that: v0.38.2 and v0.38.3 were written as
 * prose, parsed to nothing, and displayed as empty headings for weeks.
 *
 * Note this file's section key is `heading`, where every other app in the suite
 * uses `title`. That is a real difference, not a mistake — do not "fix" it, and
 * do not copy a guard from a sibling repo without adjusting for it.
 */
describe('changelog renders non-empty', () => {
  it('has entries', () => {
    expect(changelog.length).toBeGreaterThan(0);
  });

  it('gives every entry at least one section', () => {
    const empty = changelog.filter((e) => e.sections.length === 0).map((e) => e.version);

    expect(
      empty,
      `these versions render as a bare heading with no content: ${empty.join(', ')}`,
    ).toEqual([]);
  });

  it('gives every section at least one item', () => {
    const empty = changelog.flatMap((e) =>
      e.sections.filter((s) => s.items.length === 0).map((s) => `v${e.version} → "${s.heading}"`),
    );

    expect(
      empty,
      `these sections render as a heading with nothing beneath it: ${empty.join('; ')}`,
    ).toEqual([]);
  });

  it('is ordered newest-first', () => {
    const parse = (v: string): number[] => v.split('.').map(Number);
    const compare = (a: number[], b: number[]): number => {
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    };

    const outOfOrder: string[] = [];
    for (let i = 1; i < changelog.length; i++) {
      const prev = changelog[i - 1];
      const cur = changelog[i];
      if (prev === undefined || cur === undefined) continue;
      if (compare(parse(cur.version), parse(prev.version)) >= 0) {
        outOfOrder.push(`${prev.version} is followed by ${cur.version}`);
      }
    }

    expect(outOfOrder, outOfOrder.join('; ')).toEqual([]);
  });

  /**
   * The displayed version and the changelog are the same release surface here:
   * the footer shows APP_VERSION and the changelog page lists the entries, so a
   * mismatch means the site advertises a version it has no notes for.
   *
   * This is an always-true assertion rather than a release-boundary one because
   * `APP_VERSION` and the changelog live in the same repository and are bumped
   * in the same commit — unlike `package.json`, which the ship gate checks.
   */
  it('newest entry matches the displayed APP_VERSION', () => {
    expect(changelog[0]?.version).toBe(APP_VERSION);
  });
});
