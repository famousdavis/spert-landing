// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import nextConfig from '../../next.config';
import sitemap from '../app/sitemap';
import { apps } from '../data/apps';
import { HELP_APPS, connectAiGuide, guideUrl, helpRobots } from '../data/help';
import { ASSISTANTS, CONNECT_AI_PATH, MCP_SERVER_URL, OTHER_ASSISTANTS_ID } from '../data/connectAi';

/**
 * The Help Center (2.13.0) lists every app's guide PDFs at /help/<slug>. Its
 * data, src/data/help.ts, is checked here against everything it must agree
 * with. Each check below was seen to fail on a deliberate known-bad before it
 * was trusted; the known-bads are recorded in the PR that added them.
 *
 * What these guards cannot see: whether production serves each guide, and what
 * the app repos really contain. The daily workflow help-guides.yml checks both.
 */

/**
 * G1 — the slug and repo contract.
 *
 * Every app links to https://spertsuite.com/help/<slug> (Phase 2), so a slug is
 * a published address. It equals the app's subdomain. RENAMING ONE needs a
 * permanent redirect from the old slug — and note the catch: the redirect guard
 * in suite-artifacts.test.ts resolves destinations to a literal
 * src/app/<dest>/page.tsx, so it will reject /help/<old> → /help/<new> until it
 * is taught the dynamic route. Teach it in the release that first needs it.
 *
 * The repos are pinned here, offline, because the daily list check depends on
 * them and a wrong name does not always fail loudly on its own: the old
 * famousdavis/MyScrumBudget still exists, with no `main` branch and no public/.
 */
const PINNED: readonly (readonly [slug: string, repo: string])[] = [
  ['storymap', 'famousdavis/spert-story-map'],
  ['forecaster', 'famousdavis/spert-forecaster'],
  ['ganttapp', 'famousdavis/GanttApp'],
  ['scheduler', 'famousdavis/spert-scheduler'],
  ['cfd', 'famousdavis/spert-cfd'],
  ['myscrumbudget', 'famousdavis/myscrumbudget-web'],
  ['ahp', 'spert-suite/spert-ahp'],
];

const appTiles = apps.filter((a) => (a.category ?? 'app') === 'app');

/** Filter to app tiles FIRST: a support tile's url is relative, and new URL('/contact') throws. */
function tileSlug(url: string): string {
  return new URL(url).host.split('.')[0] ?? '';
}

describe('Help Center data (src/data/help.ts)', () => {
  it('G1: keeps the published slugs and their GitHub repos', () => {
    expect(HELP_APPS.map((a) => [a.slug, a.repo])).toEqual(PINNED.map(([s, r]) => [s, r]));
  });

  it('G2: agrees with the homepage tiles, and is listed exactly when it has one', () => {
    expect(appTiles.length, 'no app tiles found in apps.tsx — the category check has drifted').toBeGreaterThan(0);

    for (const tile of appTiles) {
      const slug = tileSlug(tile.url);
      const entry = HELP_APPS.find((a) => a.slug === slug);
      expect(entry, `the "${tile.name}" tile has no HELP_APPS entry with slug "${slug}"`).toBeDefined();
      if (!entry) continue;
      expect(entry.name, `${slug}: name differs from its tile`).toBe(tile.name);
      expect(entry.appUrl, `${slug}: appUrl differs from its tile's url`).toBe(tile.url);
      expect(entry.summary, `${slug}: summary differs from its tile's description`).toBe(tile.description);
      expect(entry.listed, `${slug}: has a homepage tile, so it must be listed`).toBe(true);
    }

    const tiled = new Set(appTiles.map((t) => tileSlug(t.url)));
    const untiledButListed = HELP_APPS.filter((a) => !tiled.has(a.slug) && a.listed).map((a) => a.slug);
    expect(untiledButListed, 'these entries have no homepage tile, so they must have listed: false').toEqual([]);
  });

  it('G3: is well-formed', () => {
    for (const app of HELP_APPS) {
      expect(app.appUrl, `${app.slug}: appUrl`).toBe(`https://${app.slug}.spertsuite.com/`);
      expect(app.repo, `${app.slug}: repo must be owner/name`).toMatch(/^[\w.-]+\/[\w.-]+$/);
      for (const g of app.guides) {
        expect(g.file, `${app.slug}: a guide file must be a bare .pdf name`).toMatch(/^[^/]+\.pdf$/i);
        expect(guideUrl(app, g)).toBe(app.appUrl + g.file);
      }
      for (const n of app.notListed ?? []) {
        expect(n.file, `${app.slug}: a notListed file must be a bare .pdf name`).toMatch(/^[^/]+\.pdf$/i);
        expect(n.reason.trim(), `${app.slug}: notListed ${n.file} needs a reason`).not.toBe('');
      }
      if (app.guides.length === 0) {
        expect(app.noGuideNote?.trim(), `${app.slug} has no guides, so it needs a noGuideNote`).toBeTruthy();
      } else {
        expect(
          app.noGuideNote,
          `${app.slug} has guides now: remove its noGuideNote, or the page would deny a guide it lists`,
        ).toBeUndefined();
      }
    }
  });

  it('G4: has at most one "Start here" guide per app', () => {
    const many = HELP_APPS.filter((a) => a.guides.filter((g) => g.startHere).length > 1).map((a) => a.slug);
    expect(many).toEqual([]);
  });

  /**
   * G5. The pages are not rebuilt when a guide is, so a number, version or
   * revision in a description would drift from the PDF it describes. Measured
   * when written: rejects "up to 500 rows", "Guide v0.13.0", "Revision B" and
   * "versions"; accepts "Primavera P6" (no word boundary inside "P6").
   */
  it('G5: carries no drifting facts in its descriptions or notes', () => {
    const DRIFT = [/\b\d+\b/, /\b(version|revision)s?\b/i];
    const words = HELP_APPS.flatMap((a) => [
      ...a.guides.map((g) => [`${a.slug}/${g.file}`, g.description] as const),
      ...(a.noGuideNote ? [[`${a.slug} noGuideNote`, a.noGuideNote] as const] : []),
    ]);
    expect(words.length).toBeGreaterThan(0);
    const drifting = words.filter(([, text]) => DRIFT.some((re) => re.test(text))).map(([where]) => where);
    expect(drifting).toEqual([]);
  });
});

describe('Help Center wiring', () => {
  /** G6. Listed apps' pages are in the sitemap; an unlisted app's page (D2) is not. */
  it('G6: lists /help and every listed app page in the sitemap, and no unlisted one', () => {
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain('https://spertsuite.com/help');
    for (const app of HELP_APPS) {
      const url = `https://spertsuite.com/help/${app.slug}`;
      if (app.listed) expect(urls, `${app.slug} is listed, so it belongs in the sitemap`).toContain(url);
      else expect(urls, `${app.slug} is unlisted (D2), so it must stay out of the sitemap`).not.toContain(url);
    }
  });

  /**
   * G7. /support is the other word people reach for. Like /bug-report and
   * /request in suite-artifacts.test.ts, it is pinned by name: that file's
   * general check proves every redirect lands somewhere, but cannot notice
   * one that was deleted.
   */
  it('G7: keeps /support redirecting permanently to /help', async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    expect(redirects).toContainEqual({ source: '/support', destination: '/help', permanent: true });
  });

  /**
   * G12. D2 says an unlisted app's page carries noindex. The decision lives in
   * helpRobots(), which this checks; and because the page itself cannot be
   * imported here (it uses the '@/' alias), its source is read as text to prove
   * it still hands that decision to Next — the way tile-contrast.test.ts reads
   * TILE_CLASS from AppTile.tsx. Either half alone could pass while the page
   * lost its noindex.
   */
  it('G12: keeps unlisted app pages out of search indexes', () => {
    for (const app of HELP_APPS) {
      if (app.listed) expect(helpRobots(app), `${app.slug} is listed: no robots override`).toBeUndefined();
      else expect(helpRobots(app), `${app.slug} is unlisted: noindex`).toEqual({ index: false });
    }
    const page = readFileSync(join(process.cwd(), 'src', 'app', 'help', '[app]', 'page.tsx'), 'utf-8');
    expect(page, 'the app page no longer sets robots: helpRobots(...) in its metadata').toMatch(
      /robots:\s*helpRobots\(/,
    );
  });
});

/**
 * The Connect AI setup page (2.15.0), /help/connect-ai: one page for every
 * assistant's setup, which the three apps' Connect AI guides used to repeat.
 */
describe('Connect AI setup page', () => {
  const pageSource = readFileSync(join(process.cwd(), 'src', 'app', 'help', 'connect-ai', 'page.tsx'), 'utf-8');

  /**
   * G13. The page is a fixed route beside /help/[app], so an app given the slug
   * 'connect-ai' would be shadowed by it. And it belongs in the sitemap.
   */
  it('G13: has its own address, in the sitemap, which no app slug may take', () => {
    expect(CONNECT_AI_PATH).toBe('/help/connect-ai');
    const slug = CONNECT_AI_PATH.split('/').pop();
    expect(HELP_APPS.map((a) => a.slug)).not.toContain(slug);
    expect(sitemap().map((e) => e.url)).toContain(`https://spertsuite.com${CONNECT_AI_PATH}`);
  });

  /**
   * G14. The section anchors are published addresses: the apps are to link
   * straight to /help/connect-ai#<assistant>. Renaming one breaks those links,
   * so a change here should be deliberate, and the apps told.
   */
  it('G14: keeps the published section anchors', () => {
    expect([...ASSISTANTS.map((a) => a.id), OTHER_ASSISTANTS_ID]).toEqual([
      'claude',
      'chatgpt',
      'gemini',
      'grok',
      'claude-code',
      'copilot-studio',
      'other',
    ]);
    // Every assistant has its steps on the page, keyed by the same id.
    for (const a of ASSISTANTS) {
      expect(pageSource, `no steps for ${a.id}`).toMatch(new RegExp(`^  '?${a.id}'?: \\(`, 'm'));
    }
  });

  /**
   * G15. The address is written in one place. The page reads MCP_SERVER_URL; a
   * literal copy in the page could be mistyped, or left behind if the address
   * ever moves.
   */
  it('G15: takes the server address from MCP_SERVER_URL, never a literal', () => {
    expect(MCP_SERVER_URL).toBe('https://mcp.spertsuite.com');
    expect(pageSource).not.toContain('mcp.spertsuite.com');
    expect(pageSource).toContain('MCP_SERVER_URL');
  });

  /**
   * G16. Which apps have Connect AI is derived from their published guides
   * (connectAiGuide in help.ts), and pinned here. When another app gains
   * Connect AI this fails: check the setup page's wording, which names the apps
   * by kind of work ("Which assistant for which job"), and the Copilot Studio
   * server description.
   */
  it('G16: knows which apps have Connect AI', () => {
    expect(HELP_APPS.filter((a) => connectAiGuide(a)).map((a) => a.slug)).toEqual([
      'storymap',
      'forecaster',
      'scheduler',
    ]);
  });
});
