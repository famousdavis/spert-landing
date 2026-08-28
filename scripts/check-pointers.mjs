#!/usr/bin/env node
// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Pre-flight for the register's CROSS-REPO cells.
 *
 * `rules-tests/allowlist-contracts.ts` carries seven fields that are claims
 * about OTHER repositories — see `FIELD_BUCKETS`, which labels them. Nothing in
 * this repository can falsify them, so this script reads the sibling checkouts
 * directly and reports two different things:
 *
 *   (a) PIN STALENESS  — how many commits have touched each cited file since
 *       that entry's `sourceCommit`. STALENESS, NOT WRONGNESS: a target can be
 *       many commits behind and still be exactly right, and two of the four
 *       behind today are measured clean by set equality. It is a SWEEP PROMPT.
 *
 *   (b) POINTER RESOLUTION — whether each `path:symbol` still resolves AT ITS
 *       OWN PIN. This is the half that can be wrong rather than merely old.
 *
 * ⚠️ THE REPORT IS THE ARTIFACT, NOT THE TOTALS. Two implementations that are
 * both wrong produce byte-identical counts to the correct one — measured: a
 * prefix-only parser and one that silently drops an unresolvable target BOTH
 * report 11 metered, 4 behind, 7 zero, exactly as a correct run does. They
 * differ only in the UNRESOLVED rows they fail to print. Never assert on the
 * numbers alone.
 *
 * THE PARSER, STATED — because the population is a property of the parser and
 * this number has been published SIX different ways (13, 10, 11, 12, 11+1,
 * 11+2), every one of them a consequence of an unstated parsing choice:
 *
 *   - EVALUATE THE MODULE, never read the file text. Four cells end a string
 *     literal at `…ts:' +` with the symbol on the NEXT line; a line-reader
 *     loses the symbol and passes them vacuously.
 *   - PATH REGEX IS `\.tsx?`, prescribed. Broadening it to any extension adds
 *     a second UNRESOLVED — `anonymous_sessions_create.minSource` names
 *     `firestore.rules`, which resolves against that entry's own repo
 *     (spert-story-map) where no such file exists, per-app mirrors having been
 *     removed in July 2026.
 *   - BARE PATHS RESOLVE AGAINST THE ENTRY'S OWN REPO, taken from the first
 *     repo-prefixed path in its `source`.
 *   - EXISTENCE IS VERIFIED AT THE PIN, and anything that fails to resolve is
 *     emitted as UNRESOLVED. ⚠️ NEVER SILENTLY DROPPED, AND NEVER COUNTED AS A
 *     ZERO — a dropped target reads as a clean one.
 *
 * ⚠️ DO NOT ADD A BASENAME SEARCH. `spert-forecaster`'s `firestore-sharing.ts`
 * is named bare, with no directory, so the prescribed resolution cannot place
 * it — it stays UNRESOLVED. The file does exist, at
 * src/shared/firebase/firestore-sharing.ts, and searching for it by basename
 * would make the count rounder while teaching the parser to guess;
 * `src/guards/cross-repo-pointers.test.ts` documents basename resolution as a
 * heuristic with a known false-negative class. The right fix is to give the
 * REGISTER a resolvable path.
 *
 * ⚠️ VACUITY FLOOR, MEASURED 11 OF 11. Every file the register points into
 * carries the mandatory copyright header, so the tokens `the`, `in`, `project`,
 * `root`, `file`, `for`, `full`, `license`, `text`, `under` and `See` resolve
 * in ALL of them. `anonymous_sessions_update.minSource` extracts `the` and
 * therefore passes VACUOUSLY. A green row is not evidence that the symbol is
 * meaningful; only a red row carries information.
 *
 * ENFORCEMENT, HONESTLY: enforced at LOCAL PRE-FLIGHT — a human runs it — and
 * declared-advisory in CI, where the sibling repositories are not checked out
 * and every repo-scoped row is a declared skip. It is deliberately NOT in
 * `shipgate.config.json`: it exits non-zero on a real pointer failure and
 * there is one today, which is a finding about the register rather than a bug
 * in this script.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DEV_ROOT = resolve(REPO_ROOT, '..');

/** Sibling repositories the register may point into. */
const REPOS = [
  'GanttApp',
  'MyScrumBudget',
  'spert-ahp',
  'spert-cfd',
  'spert-forecaster',
  'spert-scheduler',
  'spert-story-map',
];

/** Prescribed. Broadening this changes the published population — see above. */
const PATH_RE = /[A-Za-z0-9_@./-]*\.tsx?/g;

const repoDir = (repo) => join(DEV_ROOT, repo);
const repoPresent = (repo) => existsSync(join(repoDir(repo), '.git'));

function git(repo, args) {
  return execFileSync('git', ['-C', repoDir(repo), ...args], { encoding: 'utf8' }).trim();
}

function existsAtPin(repo, pin, rel) {
  try {
    execFileSync('git', ['-C', repoDir(repo), 'cat-file', '-e', `${pin}:${rel}`], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Every `path` (and the symbol immediately after its colon, if any) in a cell.
 *
 * The symbol is the leading identifier run after `<path>:`. It is often prose
 * — see the vacuity floor above — and that is recorded rather than filtered,
 * because filtering it would hide how weak some of these cells are.
 */
function mentions(text) {
  const out = [];
  for (const m of text.matchAll(PATH_RE)) {
    const after = text.slice(m.index + m[0].length);
    const sym = /^:([A-Za-z0-9_$]+)/.exec(after);
    out.push({ raw: m[0], symbol: sym ? sym[1] : null });
  }
  return out;
}

/** The repo a bare path belongs to: the first repo-prefixed path in `source`. */
function homeRepo(contract) {
  for (const { raw } of mentions(contract.source)) {
    const seg = raw.split('/')[0];
    if (REPOS.includes(seg)) return seg;
  }
  return null;
}

function place(raw, home) {
  const seg = raw.split('/')[0];
  if (REPOS.includes(seg)) return { repo: seg, rel: raw.split('/').slice(1).join('/') };
  return { repo: home, rel: raw };
}

const contracts = (await import(join(REPO_ROOT, 'rules-tests/allowlist-contracts.ts')))
  .ALLOWLIST_CONTRACTS;

// ---------------------------------------------------------------------------
// (a) pin-staleness meter, over distinct (file, pin) targets
// ---------------------------------------------------------------------------
const metered = new Map();
const unresolved = [];
const skippedRepos = new Set();

for (const c of contracts) {
  const home = homeRepo(c);
  for (const [slot, text] of [
    ['source', c.source],
    ['minSource', c.minSource],
  ]) {
    for (const { raw } of mentions(text)) {
      const { repo, rel } = place(raw, home);
      if (!repo) {
        unresolved.push({ cell: `${c.key}.${slot}`, raw, reason: 'NO-REPO' });
        continue;
      }
      if (!repoPresent(repo)) {
        skippedRepos.add(repo);
        continue;
      }
      if (!existsAtPin(repo, c.sourceCommit, rel)) {
        unresolved.push({
          cell: `${c.key}.${slot}`,
          raw,
          reason: `ABSENT-AT-PIN ${repo}@${c.sourceCommit}`,
        });
        continue;
      }
      metered.set(`${repo}|${rel}|${c.sourceCommit}`, { repo, rel, pin: c.sourceCommit });
    }
  }
}

let behind = 0;
let atZero = 0;
const meterRows = [];
for (const { repo, rel, pin } of metered.values()) {
  const n = Number(git(repo, ['rev-list', '--count', `${pin}..HEAD`, '--', rel]));
  if (n > 0) behind++;
  else atZero++;
  meterRows.push({ n, label: `${repo}/${rel}@${pin}` });
}
meterRows.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));

// ---------------------------------------------------------------------------
// (b) pointer resolution, one row per CELL (13 entries x 2 slots = 26)
// ---------------------------------------------------------------------------
const cells = [];
for (const c of contracts) {
  const home = homeRepo(c);
  for (const [slot, text] of [
    ['source', c.source],
    ['minSource', c.minSource],
  ]) {
    const pairs = mentions(text).filter((m) => m.symbol);
    if (pairs.length === 0) {
      cells.push({ cell: `${c.key}.${slot}`, status: 'SKIP', reason: 'NO-PATH' });
      continue;
    }
    const failures = [];
    let skipped = null;
    for (const { raw, symbol } of pairs) {
      const { repo, rel } = place(raw, home);
      if (!repo) {
        skipped = 'UNRESOLVABLE-REPO';
        break;
      }
      if (!repoPresent(repo)) {
        skippedRepos.add(repo);
        skipped = `REPO-ABSENT ${repo}`;
        break;
      }
      if (!existsAtPin(repo, c.sourceCommit, rel)) {
        failures.push(`${raw} does not exist at ${repo}@${c.sourceCommit}`);
        continue;
      }
      const body = git(repo, ['show', `${c.sourceCommit}:${rel}`]);
      if (!body.includes(symbol)) {
        failures.push(`${symbol} absent from ${raw} at ${repo}@${c.sourceCommit}`);
      }
    }
    if (skipped) cells.push({ cell: `${c.key}.${slot}`, status: 'SKIP', reason: skipped });
    else if (failures.length) {
      cells.push({ cell: `${c.key}.${slot}`, status: 'FAIL', reason: failures.join('; ') });
    } else cells.push({ cell: `${c.key}.${slot}`, status: 'OK', reason: '' });
  }
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
const skips = cells.filter((c) => c.status === 'SKIP');
const fails = cells.filter((c) => c.status === 'FAIL');

console.log('parser       evaluate-the-module; paths /\\.tsx?/; bare paths -> the');
console.log("             entry's own repo; existence verified at the pin;");
console.log('             anything unplaceable is UNRESOLVED, never dropped');
console.log('');
console.log(`(a) PIN STALENESS — ${metered.size} metered targets, ${behind} behind / ${atZero} at zero`);
for (const r of meterRows) {
  console.log(`      ${r.n > 0 ? `behind ${r.n}` : 'zero    '}  ${r.label}`);
}
console.log(`    UNRESOLVED: ${unresolved.length}`);
for (const u of unresolved) console.log(`      ${u.cell}  ${u.raw}  [${u.reason}]`);
console.log('    Staleness, not wrongness. A sweep prompt, not a falsity detector.');
console.log('');
console.log(`(b) POINTER RESOLUTION — ${cells.length} cells: ${fails.length} failed, ${skips.length} skipped, ${cells.length - fails.length - skips.length} checked`);
for (const s of skips) console.log(`      SKIP  ${s.cell}  [${s.reason}]`);
for (const f of fails) console.log(`      FAIL  ${f.cell}  ${f.reason}`);
if (skippedRepos.size) {
  console.log(`    repos absent (declared skip): ${[...skippedRepos].sort().join(', ')}`);
}
console.log('    A green row may be vacuous — the copyright header makes prose');
console.log('    tokens resolve in every file. Only a red row carries information.');

if (fails.length) {
  console.log('');
  console.log(`FAILED: ${fails.length} pointer(s) do not resolve at their own pin.`);
  process.exit(1);
}
process.exit(0);
