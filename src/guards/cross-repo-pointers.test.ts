// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * No file in this repository may cite a LINE NUMBER inside a file it does not
 * contain.
 *
 * WHY. `firestore.rules` is the suite's canonical ruleset, so its comments
 * explain themselves by pointing at the seven client apps that write the
 * collections it guards. Those apps live in other repositories on their own
 * release cycles. A line number aimed across that boundary cannot be verified
 * by anything here and cannot stay correct: `spert-ahp` v0.18.24 inserted 48
 * lines into `FirestoreAdapter.ts`, and every pointer this repo held into that
 * file below the insertion silently became wrong. Measured drift found in the
 * 2.5.18 sweep ran to 135 lines (Scheduler's `removeCollaborator`, cited at
 * :411, actually at 546).
 *
 * A symbol name has no such failure mode. It survives every edit that does not
 * rename it, and a rename is precisely the case where the reference SHOULD
 * break loudly rather than quietly point at the wrong code.
 *
 * THE RULE IS EXISTENCE, NOT A FILE-TYPE BLOCKLIST. A `<path>:<line>` citation
 * is allowed when `<path>` names a file this repository actually contains, and
 * rejected when it does not. That distinction is the real invariant, and it is
 * self-maintaining: no exception list to curate, and the scan can widen to new
 * files without hand-tuning. It correctly admits both of the same-repo forms
 * already in use - `firestore.rules:295` in a rules-tests comment, and
 * `layout.tsx:3` in `src/types/css.d.ts` - while rejecting
 * `FirestoreAdapter.ts:346`.
 *
 * WHAT THIS CANNOT CATCH. Stated plainly, because a control that oversells its
 * coverage is the same defect this guard exists to remove:
 *
 *   1. BARE NUMBERS IN PROSE ARE UNCATCHABLE. `firestore.rules` once carried
 *      "setDoc 177/246, tx.set 335, updateDoc 355/440/..." - thirteen cross-repo
 *      pointers with no filename attached, and by then all thirteen were 48 lines
 *      stale. Nothing distinguishes those from any other number in a comment.
 *      They were rewritten to method names by hand in 2.5.18 and CAN REGRESS
 *      WITHOUT THIS GUARD NOTICING. Same for a continuation form - "and :281"
 *      - once the filename is on a previous line.
 *   2. BASENAME RESOLUTION IS A HEURISTIC. Matching is by basename, because
 *      real citations are written bare (`layout.tsx:3`, not
 *      `src/app/layout.tsx:3`). So a cross-repo pointer whose filename ALSO
 *      exists here would be admitted. A false negative, and the deliberate
 *      trade: a false positive fails the ship gate on correct code, which is
 *      worse. No collisions exist today - all ten cross-repo basenames found in
 *      the 2.5.18 sweep are absent from this repository.
 */

/**
 * Files scanned. Deliberately explicit rather than "everything tracked": these
 * are the files that carry cross-repo explanation, and an explicit list means
 * adding one is a decision. The rule itself is scope-independent - widening this
 * list to every tracked source file flags the same set and nothing more, which
 * was measured before this guard was written.
 *
 * This file is NOT scanned, and must not be: the examples above are illustrative
 * pointers into repositories we do not contain, which is exactly what the guard
 * rejects.
 */
const SCANNED = [
  'firestore.rules',
  'rules-tests/allowlist-contracts.ts',
  'functions/src/__tests__/sendInvitationEmail.test.ts',
] as const;

/**
 * A path-like token bearing a source or config extension, followed by `:<line>`.
 *
 * The extension requirement is load-bearing, not cosmetic. Without it the
 * pattern matches `http://localhost:3000` - eleven such origins appear in the
 * `functions/` test scanned here - and the guard would fail the ship gate on
 * correct code. Keep this list broad: a narrower one lets a future `.mjs:12`
 * pointer through.
 */
const POINTER =
  /[A-Za-z0-9_.\-/]+\.(?:ts|tsx|js|jsx|mjs|cjs|css|rules|json|md)(?::\d+)/g;

/** Every basename tracked in this repository. */
function repoBasenames(): Set<string> {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
  return new Set(out.trim().split('\n').map((p) => basename(p)));
}

interface Offence {
  file: string;
  line: number;
  pointer: string;
}

function scan(file: string, known: Set<string>): Offence[] {
  const found: Offence[] = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, i) => {
      for (const match of text.match(POINTER) ?? []) {
        const path = match.slice(0, match.lastIndexOf(':'));
        if (!known.has(basename(path))) {
          found.push({ file, line: i + 1, pointer: match });
        }
      }
    });
  return found;
}

describe('cross-repo pointers', () => {
  it('cites no line number inside a file this repository does not contain', () => {
    const known = repoBasenames();
    const offences = SCANNED.flatMap((f) => scan(f, known));
    const report = offences
      .map((o) => `${o.file}:${o.line} cites ${o.pointer}`)
      .join('\n');
    expect(
      report,
      'Cross-repo line pointers cannot be verified and do not stay correct. ' +
        'Replace each with the symbol it identifies - keep the path, drop the ' +
        `:line. Offending citations:\n${report}`,
    ).toBe('');
  });

  it('admits a same-repo citation, so the rule is existence and not a pattern', () => {
    const known = repoBasenames();
    // `src/types/css.d.ts` cites `layout.tsx:3`. It matches POINTER, and it is
    // correct: `src/app/layout.tsx` is in this repository. A guard that merely
    // banned `.tsx:N` would reject it. This asserts the distinction actually
    // works rather than trusting that it does.
    expect(known.has('layout.tsx')).toBe(true);
    const sameRepo = 'see layout.tsx:3 and firestore.rules:295';
    const flagged = (sameRepo.match(POINTER) ?? []).filter(
      (m) => !known.has(basename(m.slice(0, m.lastIndexOf(':')))),
    );
    expect(flagged).toEqual([]);
  });

  it('scans the files it claims to, and they all exist', () => {
    const tracked = new Set(
      execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n'),
    );
    for (const f of SCANNED) expect(tracked.has(f), `${f} tracked`).toBe(true);
    expect(SCANNED).toHaveLength(3);
  });
});
