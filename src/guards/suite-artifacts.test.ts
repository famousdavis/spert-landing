import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * This repository is the canonical home for artifacts the other eight SPERT®
 * Suite apps depend on. When something here changes, it breaks *elsewhere* —
 * which is the hardest kind of failure to notice, because nothing in this repo
 * looks wrong and nothing in the consuming repo can see the cause.
 *
 * These guards cover the three cross-repo contracts this repository owns:
 *
 *   1. LICENSE — the file all nine repos copy verbatim.
 *   2. The legal PDFs — every other app's footer links to
 *      https://spertsuite.com/TOS.pdf and /PRIVACY.pdf, and the Connect AI
 *      consent flow links to /ai-privacy and /ai-consent-notice, which are
 *      rewrites onto PDFs served from public/ here.
 *   3. The rewrite destinations themselves, which live in next.config.ts —
 *      configuration, not code, so no build error or type error can catch a
 *      rename.
 */

// ---------------------------------------------------------------------------
// LICENSE
// ---------------------------------------------------------------------------

/**
 * The canonical SPERT® Suite licence body, with line 4 (the repository URL, the
 * only line that legitimately differs between repos) normalised.
 *
 * This repository holds the master copy. On 2026-07-29 all nine were audited
 * and only MyScrumBudget matched it exactly: GanttApp shipped 48 lines and
 * spert-cfd 64, neither carrying the GNU GPL v3 at all — just a short notice
 * and a gnu.org link, with none of Sections 0–17, no patent grant, no warranty
 * disclaimer. GPL §4 requires giving recipients a copy of the licence. Five
 * repos carried a brand retired in March 2026, six carried weaker additional
 * terms, and spert-ssv had no repository URL at all.
 *
 * All nine now assert this same constant. That is the point: a drift here is a
 * drift in the master, and the eight copies will disagree with it — so the
 * suite fails loudly rather than quietly diverging again.
 *
 * The clause directions in ADDITIONAL TERMS are deliberately opposite: a)/b)
 * *compel* retention of the author name, c)/d) *withhold* the brand (GPL §7(e)
 * and §7(c)). Never add a project or brand name to clause a) — it reads
 * naturally as "keep branding consistent" but would obligate every fork to
 * carry the brand, the exact opposite of reserving it.
 *
 * Changing this constant means changing the licence for the whole suite, and
 * all nine repos must be updated in the same pass.
 */
const SUITE_LICENSE_BODY_SHA256 =
  'e9983ebfb14c08d7abeaef6d685f37348bcddbaffe92b6b4391914cd0454f64f';

const REPO_URL = 'https://github.com/famousdavis/spert-landing';

describe('LICENSE — the canonical copy for all nine repos', () => {
  const lines = readFileSync(join(process.cwd(), 'LICENSE'), 'utf-8').split('\n');

  it('names this repository on line 4', () => {
    expect(lines[3]).toBe(`Project repository: ${REPO_URL}`);
  });

  it('matches the digest every other repo in the suite asserts', () => {
    const normalised = [...lines];
    normalised[3] = 'Project repository: <REPO-URL>';

    const actual = createHash('sha256').update(normalised.join('\n')).digest('hex');

    expect(
      actual,
      'LICENSE has changed. This is the canonical copy — the other eight repos ' +
        'assert this same digest, so they will now all fail. If the change is ' +
        'intended, update the constant here AND in all eight copies in the same pass.',
    ).toBe(SUITE_LICENSE_BODY_SHA256);
  });
});

// ---------------------------------------------------------------------------
// Legal PDFs and rewrite destinations
// ---------------------------------------------------------------------------

/**
 * URLs the other apps hard-code. Verified on 2026-07-30 by grepping the eight
 * sibling repositories: TOS.pdf and PRIVACY.pdf are each referenced 8 times,
 * /ai-privacy 3 times, /ai-consent-notice once.
 *
 * Renaming any of these files silently 404s a footer link in up to eight
 * deployed applications, and nothing in those repositories can detect it —
 * their own asset guards only check their own public/ directory.
 */
const CROSS_APP_PATHS = [
  '/TOS.pdf',
  '/PRIVACY.pdf',
  '/AI-PRIVACY.pdf',
  '/AI-CONSENT.pdf',
];

describe('legal documents the rest of the suite links to', () => {
  it('serves every PDF the other apps reference', () => {
    const missing = CROSS_APP_PATHS.filter(
      (p) => !existsSync(join(process.cwd(), 'public', p)),
    );

    expect(
      missing,
      `missing from public/: ${missing.join(', ')}. Other SPERT apps link to these ` +
        `directly; removing one 404s their footers with no error anywhere.`,
    ).toEqual([]);
  });

  /**
   * The rewrites in next.config.ts are configuration, not code: no build error,
   * type error or lint rule can catch a destination that no longer exists.
   *
   * `/aiprivacy` (unhyphenated) is a PERMANENT compatibility alias — Privacy
   * Policy editions before v1.1 cited it, and those PDFs are already in
   * circulation and cannot be recalled. Never remove it.
   */
  it('resolves every rewrite destination in next.config.ts', () => {
    const config = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf-8');
    const rewrites = [...config.matchAll(/destination:\s*["']([^"']+)["']/g)]
      .map((m) => m[1])
      .filter((d): d is string => d !== undefined)
      .filter((d) => d.startsWith('/'));

    expect(
      rewrites.length,
      'no rewrite destinations found — the parser has drifted from next.config.ts',
    ).toBeGreaterThan(0);

    const broken = rewrites.filter((d) => !existsSync(join(process.cwd(), 'public', d)));

    expect(
      broken,
      `these rewrite destinations do not exist in public/: ${broken.join(', ')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Assets referenced from source
// ---------------------------------------------------------------------------

const ASSET_HREF = /['"`](\/[A-Za-z0-9._~/-]+\.(?:pdf|md|png|jpg|jpeg|svg|ico|csv|webp))['"`]/g;

/**
 * Test files are excluded deliberately. `CROSS_APP_PATHS` above lists asset
 * paths as string literals, so a scan that included this file would match its
 * own constants and report the guard as the referrer — self-validating noise
 * that obscures which application code actually links to what.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('static assets referenced from source exist in public/', () => {
  const root = process.cwd();
  const references = new Map<string, string[]>();

  for (const file of sourceFiles(join(root, 'src'))) {
    for (const match of readFileSync(file, 'utf-8').matchAll(ASSET_HREF)) {
      const href = match[1];
      if (href === undefined) continue;
      const list = references.get(href) ?? [];
      list.push(relative(root, file));
      references.set(href, list);
    }
  }

  it('finds at least one referenced asset, so the scan is doing something', () => {
    expect(references.size).toBeGreaterThan(0);
  });

  it('resolves every referenced asset', () => {
    const missing: string[] = [];
    for (const [href, files] of references) {
      if (!existsSync(join(root, 'public', href))) {
        missing.push(`${href} — referenced from ${files.join(', ')}`);
      }
    }

    expect(missing, `missing from public/:\n  ${missing.join('\n  ')}`).toEqual([]);
  });
});
