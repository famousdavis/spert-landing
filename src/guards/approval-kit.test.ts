// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { APPROVAL_KIT } from '../data/approvalKit';

/**
 * /approval-kit renders from src/data/approvalKit.ts and links to files in
 * public/. Every PDF in the kit prints spertsuite.com/approval-kit, so a broken
 * download here is a broken link in documents already circulating, and a file
 * whose bytes differ from the release is a document nobody reviewed.
 *
 * The files are copied byte-for-byte from the release zip. Their reference is
 * the kit's own checksums.txt, published beside them; the zip's reference is the
 * module, which the page prints.
 */

const ROOT = join(process.cwd(), 'public', 'approval-kit');
const DIR = join(ROOT, `v${APPROVAL_KIT.version}`);

/** Every file the page links to, relative to DIR. */
const LISTED = [
  ...APPROVAL_KIT.documents.flatMap((d) => [`${d.file}.pdf`, `${d.file}.docx`]),
  APPROVAL_KIT.zip.file,
  'checksums.txt',
];

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** checksums.txt as `name → hash`, in `shasum -a 256` format. */
function readChecksums(dir: string = DIR): Map<string, string> {
  const lines = readFileSync(join(dir, 'checksums.txt'), 'utf8').split('\n').filter((l) => l.trim());
  const entries = lines.map((line) => /^([0-9a-f]{64}) [ *](.+)$/.exec(line));
  const malformed = lines.filter((_, i) => entries[i] === null);
  expect(malformed, `checksums.txt has lines not in shasum format: ${malformed.join(' | ')}`).toEqual([]);
  return new Map(entries.flatMap((m) => (m ? [[m[2] as string, m[1] as string] as const] : [])));
}

describe('Approval Kit — the published files match the release', () => {
  it('has every file the page lists', () => {
    const missing = LISTED.filter((f) => !existsSync(join(DIR, f)));
    expect(missing, `listed on /approval-kit but missing from ${DIR}: ${missing.join(', ')}`).toEqual([]);
  });

  it("matches each document file's hash to its line in checksums.txt", () => {
    const sums = readChecksums();
    const documents = LISTED.filter((f) => f.endsWith('.pdf') || f.endsWith('.docx'));
    expect(documents.length, 'the module lists no documents — the guard would check nothing').toBeGreaterThan(0);

    const unlisted = documents.filter((f) => !sums.has(f));
    expect(unlisted, `no line in checksums.txt for: ${unlisted.join(', ')}`).toEqual([]);

    const changed = documents.filter((f) => existsSync(join(DIR, f)) && sha256(join(DIR, f)) !== sums.get(f));
    expect(changed, `these files differ from checksums.txt: ${changed.join(', ')}`).toEqual([]);
  });

  /** From v2.0.0 the kit's checksums.txt covers its README too (v1.0.0's did not). */
  it("matches the README's hash to its line in checksums.txt", () => {
    const sums = readChecksums();
    expect(sums.has('README.txt'), 'checksums.txt has no line for README.txt').toBe(true);
    expect(sha256(join(DIR, 'README.txt')), 'README.txt differs from checksums.txt').toBe(sums.get('README.txt'));
  });

  it('lists every file named in checksums.txt (no orphans)', () => {
    const orphans = [...readChecksums().keys()].filter((f) => !LISTED.includes(f) && f !== 'README.txt');
    expect(orphans, `in checksums.txt but not on /approval-kit: ${orphans.join(', ')}`).toEqual([]);
  });

  it("matches the zip's SHA-256 and size to the values the page prints", () => {
    const zip = join(DIR, APPROVAL_KIT.zip.file);
    expect(statSync(zip).size, 'zip size').toBe(APPROVAL_KIT.zip.bytes);
    expect(sha256(zip), 'zip SHA-256').toBe(APPROVAL_KIT.zip.sha256);
  });

  /**
   * Vercel deploys what git holds. A file that is present on disk but ignored
   * passes every check above locally and 404s in production. Untracked files
   * count, so the guard passes before the first commit; ignored ones do not.
   */
  it('keeps every published file visible to git (tracked, or untracked but not ignored)', () => {
    const visible = new Set(
      execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', DIR], {
        encoding: 'utf8',
        cwd: process.cwd(),
      })
        .split('\n')
        .filter(Boolean)
        .map((p) => p.split('/').pop()),
    );
    const invisible = [...LISTED, 'README.txt'].filter((f) => !visible.has(f));
    expect(invisible, `git cannot see these (ignored?): ${invisible.join(', ')}`).toEqual([]);
  });
});

/**
 * Each kit PDF links to spertsuite.com/approval-kit, and a reviewer may hold a
 * copy of any version, so an earlier version's folder is never removed or
 * changed. The page names the earlier versions; each must still verify against
 * its own checksums.txt.
 */
describe('Approval Kit — earlier versions stay published, unchanged', () => {
  const folders = readdirSync(ROOT).filter((f) => /^v\d+\.\d+\.\d+$/.test(f));

  it('names every earlier folder on the page, and only those', () => {
    const earlier = folders.map((f) => f.slice(1)).filter((v) => v !== APPROVAL_KIT.version).sort();
    expect([...APPROVAL_KIT.earlier].sort()).toEqual(earlier);
    expect(earlier.length, 'no earlier folder found — the check would be vacuous').toBeGreaterThan(0);
  });

  it.each(APPROVAL_KIT.earlier.map((v) => [v]))('v%s still matches its own checksums.txt and has its zip', (v) => {
    const dir = join(ROOT, `v${v}`);
    const sums = readChecksums(dir);
    expect(sums.size).toBeGreaterThan(0);
    const changed = [...sums].filter(([f, h]) => !existsSync(join(dir, f)) || sha256(join(dir, f)) !== h);
    expect(changed.map(([f]) => f), `v${v} files changed or missing`).toEqual([]);
    expect(existsSync(join(dir, `SPERT-Suite-Approval-Kit-v${v}.zip`)), `v${v} zip missing`).toBe(true);
  });
});
