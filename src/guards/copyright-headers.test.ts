// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * Every human-authored source file in this repository must carry the SPERT®
 * Suite copyright header. Not decoration: `LICENSE` adds four terms under GPL
 * v3 Section 7 — attribution preservation, UI notice preservation, trademark
 * reservation, marking of modified versions — and Section 7 requires a source
 * file carrying such terms to either state them or say where they are found.
 * The header's third line is that notice.
 *
 * This runs from the repository root and therefore covers BOTH trees. The
 * `functions/` package has its own manifest, its own node_modules and its own
 * Jest suite, but `git ls-files` from the root sees straight through that
 * boundary, so no second guard is needed on the Jest side — which matters,
 * because `functions/` is where 43 of this repo's in-scope files live and where
 * every V0 header in it was found.
 */

/**
 * Files that legitimately carry no header, each with its reason.
 * Keep this short and explicit — never a pattern that could swallow future files.
 *
 * Deliberately EMPTY here. `next-env.d.ts` is the one generated file that would
 * qualify, and it is gitignored (.gitignore), so `git ls-files` never returns
 * it and an entry for it would be dead weight the staleness test below flags.
 * There is no `src/vite-env.d.ts` — this is a Next.js repo, not a Vite one.
 */
const EXEMPT = new Map<string, string>();

/** Non-vacuity floor — ~90% of the 73 files in scope today. */
const MIN_FILES = 65;

/**
 * Scope clauses this repo contains. Note there is no `index.html`: Next.js
 * generates the document, so this repo has no such file to stamp.
 */
const CLAUSES: string[] = [
  'src-code',
  'src-css',
  'root-config',
  'scripts',
  'functions-src',
  'functions-root',
  'firestore.rules',
];

const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

const LINE_1 = /^Copyright \(C\) \d{4} William W\. Davis, MSPM, PMP\. All rights reserved\.$/;
const LINE_2 = 'Licensed under the GNU General Public License v3.0.';
const LINE_3 = 'See LICENSE file in the project root for full license text.';

type Framing = 'slash' | 'block' | 'html';

/** Which scope clause a path belongs to, or null if out of scope. */
function clauseOf(path: string): string | null {
  if (EXEMPT.has(path)) return null;
  const ext = extname(path);
  if (path.startsWith('src/') && CODE_EXT.has(ext)) return 'src-code';
  if (path.startsWith('src/') && ext === '.css') return 'src-css';
  if (path.startsWith('functions/src/') && CODE_EXT.has(ext)) return 'functions-src';
  if (/^functions\/[^/]+$/.test(path) && CODE_EXT.has(ext)) return 'functions-root';
  if (/^(functions\/)?scripts\/[^/]+$/.test(path) && CODE_EXT.has(ext)) return 'scripts';
  if (!path.includes('/') && CODE_EXT.has(ext)) return 'root-config';
  if (path === 'index.html' || path === 'firestore.rules') return path;
  return null;
}

function framingFor(path: string): Framing {
  const ext = extname(path);
  if (ext === '.css') return 'block';
  if (ext === '.html') return 'html';
  return 'slash';
}

/** Strip comment framing so one comparison covers every accepted form. */
function strip(line: string): string {
  return line
    .replace(/^\s*(\/\/|\/\*|<!--|\*)\s?/, '')
    .replace(/\s*(\*\/|-->)\s*$/, '')
    .trim();
}

/**
 * Framing must suit the extension AND the comment must actually close.
 * Checked only after the three logical lines have matched, so "wrong framing"
 * is never reported for a file that simply has no header.
 *
 * The closure half is load-bearing for `firestore.rules`, which nothing in
 * `npm run build`, `npm test` or `npm run lint` parses. A header whose lines
 * 2-3 lost their `//` would sail past a words-only check and break the next
 * `firebase deploy` — in a file whose canonical copy lives in the Firebase
 * Console, so the breakage would surface a long way from its cause.
 */
function framingProblem(
  l0: string,
  l1: string,
  l2: string,
  l3: string,
  framing: Framing,
): string | null {
  if (framing === 'slash') {
    if (!l0.trimStart().startsWith('//')) return 'expected // framing';
    if (!l1.trimStart().startsWith('//')) return 'header line 2 is not a // comment';
    if (!l2.trimStart().startsWith('//')) return 'header line 3 is not a // comment';
    return null;
  }
  if (framing === 'html') {
    if (!l0.trimStart().startsWith('<!--')) return 'expected <!-- --> framing';
    if (!l2.trimEnd().endsWith('-->')) return 'HTML comment is never closed';
    return null;
  }
  if (!l0.trimStart().startsWith('/*') || l0.trimStart().startsWith('/**')) {
    return 'expected /* */ framing (not /**)';
  }
  // Closer may sit at the end of line 3, or alone on line 4 (the ` * ` continuation form).
  if (!l2.trimEnd().endsWith('*/') && l3.trim() !== '*/') return 'block comment is never closed';
  return null;
}

/** null if the file is fine, otherwise a human-readable reason. */
function headerProblem(root: string, path: string): string | null {
  let text: string;
  try {
    text = readFileSync(join(root, path), 'utf-8');
  } catch {
    return 'in scope but unreadable';
  }
  const lines = text.split('\n');
  const start = (lines[0] ?? '').startsWith('#!') ? 1 : 0;
  const l0 = lines[start] ?? '';
  const l1 = lines[start + 1] ?? '';
  const l2 = lines[start + 2] ?? '';
  const l3 = lines[start + 3] ?? '';

  if (!LINE_1.test(strip(l0))) return 'no copyright header';
  if (strip(l1) !== LINE_2) return 'header line 2 does not match the template';
  if (strip(l2) !== LINE_3) return 'header line 3 missing (V0) or does not match';
  return framingProblem(l0, l1, l2, l3, framingFor(path));
}

let cache: { root: string; files: string[] } | null = null;

/**
 * Enumerate tracked AND untracked-but-not-ignored files, so a new unstaged
 * source file cannot pass locally and fail in CI. The cost is that an
 * uncommitted scratch file with a code extension under a scoped directory also
 * fails — gitignore it or give it a header.
 */
function scan(): { root: string; files: string[] } {
  if (cache) return cache;
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf-8',
  }).trim();
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: root, encoding: 'utf-8' },
  )
    .split('\n')
    .filter(Boolean)
    .filter((p) => clauseOf(p) !== null);
  cache = { root, files };
  return cache;
}

describe('copyright headers', () => {
  it('finds files to check, so an empty walk cannot pass vacuously', () => {
    expect(scan().files.length).toBeGreaterThanOrEqual(MIN_FILES);
  });

  it('sees exactly the scope clauses this repo is known to contain', () => {
    const found = new Set<string>();
    for (const file of scan().files) {
      const clause = clauseOf(file);
      if (clause !== null) found.add(clause);
    }
    expect([...found].sort()).toEqual([...CLAUSES].sort());
  });

  it('exempts only paths that still exist', () => {
    const { root } = scan();
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf-8' }).split('\n');
    expect([...EXEMPT.keys()].filter((key) => !tracked.includes(key))).toEqual([]);
  });

  it('every in-scope file carries the suite-standard header', () => {
    const { root, files } = scan();
    const offenders = files
      .map((file) => ({ file, problem: headerProblem(root, file) }))
      .filter((result) => result.problem !== null);
    expect(offenders).toEqual([]);
  });
});
