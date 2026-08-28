// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeAll, afterAll, describe, it, expect } from 'vitest';

// Plain ESM script, no declaration file. `allowJs` resolves it and infers the
// shape, so the rows below are checked against what `analyse` really returns.
import { analyse } from '../../scripts/check-pointers.mjs';

/**
 * Proof that `npm run check:pointers` still DISCRIMINATES.
 *
 * WHY THIS EXISTS, AND WHY IT BUILDS A THROWAWAY GIT REPOSITORY
 * ------------------------------------------------------------
 * Until v2.5.31 the checker had exactly one live failure — a genuinely wrong
 * `minSource` cell — and that failure was the only evidence it worked. v2.5.31
 * fixes the cell. ⚠️ AT THAT MOMENT THE CHECKER'S GREEN BECOMES UNEARNED: a
 * script that has never been observed to fail is indistinguishable from one
 * that cannot. This file is what replaces the defect as the evidence.
 *
 * ⚠️ IT MUST NOT READ THE SIBLING REPOSITORIES. They are absent in CI, so a
 * test written against them would SKIP there — and a skipped discrimination
 * proof is precisely the vacuity this campaign spent seventeen review rounds
 * on. So it creates its own two-commit repository in a temp directory and
 * drives `analyse()` against that. Hermetic, no network, no siblings, runs
 * everywhere. That is the entire reason `analyse` takes `devRoot` and `repos`
 * as PARAMETERS rather than reading `~/Developer` off a constant.
 *
 * ⚠️ DO NOT "SIMPLIFY" THIS INTO A UNIT TEST OF THE PARSER. The property under
 * test is that the checker resolves a symbol AT A PINNED COMMIT — which needs
 * two real commits with different content, because the interesting failure is a
 * symbol that exists at HEAD and not at the pin. A stubbed git cannot show
 * that, and a stub asserting what the author already believes is the shape of
 * evidence this whole exercise exists to reject.
 *
 * WHAT REPLACED WHAT. Brief 28's PC-4 read "reds on
 * `spertforecaster_projects.minSource`, exactly 1 of 26" — a known-bad the
 * register HAPPENED TO CONTAIN, which the fix then destroyed. The cases below
 * are constructed and permanent, and survive the register being correct. That
 * is the difference between a pass condition and a coincidence.
 */

const REPO = 'fixture-repo';

let root: string;
let C1: string;
let C2: string;

/** `key`, `source`, `minSource` and `sourceCommit` are all `analyse` reads. */
function contract(key: string, ref: string, pin: string) {
  return { key, source: `${REPO}/${ref}`, minSource: 'no path here', sourceCommit: pin };
}

function run(c: ReturnType<typeof contract>) {
  const { cells } = analyse({ contracts: [c], devRoot: root, repos: [REPO] });
  // `minSource` deliberately carries no path, so it is a NO-PATH skip and the
  // `source` row is the one under test.
  return cells.find((x: { cell: string }) => x.cell.endsWith('.source'));
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'spert-pointer-fixture-'));
  const dir = join(root, REPO);
  mkdirSync(dir);
  const g = (...args: string[]) =>
    execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();

  g('init', '-q', '-b', 'main');
  g('config', 'user.email', 'fixture@example.invalid');
  g('config', 'user.name', 'fixture');

  writeFileSync(join(dir, 'fixture.ts'), 'export const alpha = 1\n');
  g('add', 'fixture.ts');
  g('commit', '-q', '-m', 'C1: alpha only');
  C1 = g('rev-parse', 'HEAD');

  writeFileSync(join(dir, 'fixture.ts'), 'export const alpha = 1\nexport const beta = 2\n');
  g('add', 'fixture.ts');
  g('commit', '-q', '-m', 'C2: adds beta');
  C2 = g('rev-parse', 'HEAD');
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('check:pointers discriminates', () => {
  it('passes a symbol that is present at the pin', () => {
    // MUST-NOT-FIND control. Without it every red below could be the fixture
    // being broken rather than the checker working.
    expect(run(contract('ok', 'fixture.ts:alpha', C1))?.status).toBe('OK');
  });

  it('reds on a symbol that is absent, and NAMES it', () => {
    const row = run(contract('absent', 'fixture.ts:zzzAbsent', C1));
    expect(row?.status).toBe('FAIL');
    // The row is the artifact. A status without the symbol in it would not tell
    // a reader which pointer to go and fix.
    expect(row?.reason).toContain('zzzAbsent');
  });

  it('READS THE PIN, NOT HEAD — a symbol added after the pin still reds', () => {
    // The case that matters. `beta` exists at HEAD (C2) and not at C1, so a
    // checker resolving against HEAD — the natural wrong implementation —
    // passes this and cannot be told apart from a correct one by any other
    // case in this file.
    const row = run(contract('later', 'fixture.ts:beta', C1));
    expect(row?.status).toBe('FAIL');
    expect(row?.reason).toContain('beta');
  });

  it('goes green again when the pin is moved to where the symbol exists', () => {
    // The restore half: red, then green, from the same fixture. Proves the red
    // above is about the pin and not about `beta` being unresolvable at all.
    expect(run(contract('later-ok', 'fixture.ts:beta', C2))?.status).toBe('OK');
  });

  it('reds on a FILE that does not exist at the pin, by the other branch', () => {
    const row = run(contract('nofile', 'missing.ts:alpha', C1));
    expect(row?.status).toBe('FAIL');
    expect(row?.reason).toContain('does not exist at');
  });

  // ⚠️ THERE ARE TWO UNRESOLVED BRANCHES AND THEY ARE NOT INTERCHANGEABLE.
  // A first version of this file tested only the first and thought it had
  // covered both: a bare `nowhere.ts` alongside a repo-prefixed path is
  // PLACEABLE — `homeRepo` supplies the repo — so it fails at the pin rather
  // than for want of a repo. Deleting the NO-REPO branch entirely left all six
  // cases green. Both are asserted below, and the second needs a contract with
  // NO repo-prefixed path anywhere in it.

  it('reports a placeable target that is absent at the pin [ABSENT-AT-PIN]', () => {
    const { unresolved } = analyse({
      contracts: [{ ...contract('bare', 'fixture.ts:alpha', C1), source: `${REPO}/fixture.ts:alpha and also nowhere.ts:alpha` }],
      devRoot: root,
      repos: [REPO],
    });
    const row = unresolved.find((u: { raw: string }) => u.raw === 'nowhere.ts');
    expect(row, 'nowhere.ts must be reported, never dropped').toBeDefined();
    expect(row?.reason).toContain('ABSENT-AT-PIN');
  });

  it('reports a target with no resolvable repo at all [NO-REPO]', () => {
    // Silently dropping either branch is the known-bad that reads as a clean
    // target — measured on the real register, where a dropping parser and a
    // correct one produce IDENTICAL metered numbers and differ only in the
    // rows they fail to print.
    const { unresolved } = analyse({
      contracts: [{ key: 'norepo', source: 'nowhere.ts:alpha', minSource: 'no path here', sourceCommit: C1 }],
      devRoot: root,
      repos: [REPO],
    });
    const row = unresolved.find((u: { raw: string }) => u.raw === 'nowhere.ts');
    expect(row, 'an unplaceable target must be reported, never dropped').toBeDefined();
    expect(row?.reason).toBe('NO-REPO');
  });
});
