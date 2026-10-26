// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
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

const DIR = join(process.cwd(), 'public', 'approval-kit', `v${APPROVAL_KIT.version}`);

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
function readChecksums(): Map<string, string> {
  const lines = readFileSync(join(DIR, 'checksums.txt'), 'utf8').split('\n').filter((l) => l.trim());
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

  it('lists every file named in checksums.txt (no orphans)', () => {
    const orphans = [...readChecksums().keys()].filter((f) => !LISTED.includes(f));
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
