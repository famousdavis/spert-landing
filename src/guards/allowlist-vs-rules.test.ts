// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  ALLOWLIST_CONTRACTS,
  sameSet,
  type AllowlistContract,
} from '../../rules-tests/allowlist-contracts';

/**
 * The register's `allowlist` must equal the field set its rule actually
 * enforces.
 *
 * WHY THIS EXISTS - THE MEASURED GAP
 * ----------------------------------
 * Until 2.5.28 NOTHING compared the two. `rules-tests/` holds four
 * `readFileSync` calls against `firestore.rules`: three hand the text to the
 * emulator as a ruleset, and the fourth is the `lines` citation check, whose
 * only content assertion is `.toContain('hasOnly(')`. So the register could
 * declare one field set while the deployed rule enforced another, and every
 * suite in the repository stayed green.
 *
 * Measured on the emulator, twice, before this guard was written: widening
 * `ganttAppProjectFields()` by one field IN LINE - register untouched, line
 * count preserved - left `npm run test:rules` at a byte-identical
 * 172 / 152 passed / 20 skipped / 0 failed. The register is SUBSET-LOUD (a
 * rule NARROWER than the register reds shape 1, because the emulator refuses
 * the maximal write) and SUPERSET-SILENT. This guard closes the silent half.
 *
 * THE LINE-SHIFT IS A DECOY, NOT A CONTROL. Widening on a NEW line instead
 * moves every `lines` pointer below the edit, so the citation check reds. That
 * looks like coverage and is not:
 *
 *   - it reports exactly ONE failed test, never one per pointer - the check is
 *     a single `it()` looping 20 citations and `expect` throws on the first;
 *   - WHICH site it names is an accident of array order versus line order.
 *     Widening `ganttAppProjectFields()` happens to report `ganttapp_projects`;
 *     widening `spertForecasterProjectFields()` reports `myscrumbudget_projects`,
 *     a different app entirely;
 *   - and renumbering `lines` to clear the red restores green WITH THE WIDENING
 *     STILL UNDETECTED.
 *
 * An in-line widening - the case this guard exists for - moves no pointer at
 * all and was invisible end to end.
 *
 * WHAT THIS DOES *NOT* CATCH, AND WHO DOES
 * ----------------------------------------
 * It compares FIELD SETS. It cannot see a rule that is wrong in a way the
 * field set does not express - an over-REQUIRING `hasAll()` beside the
 * `hasOnly()`, say, which would reject a save carrying fewer fields while the
 * two sets still agree exactly. Shape 2 in `rules-tests/allowlist-coverage.
 * test.ts` covers that, by writing the app's MINIMAL document against the real
 * emulator. The division is deliberate: this file asks whether the register
 * describes the rule, that one asks whether the rule accepts the app. Stated
 * here because an unstated division of labour reads as a gap.
 *
 * It also reads `allowlist` ONLY. `appMax`, `appMin` and `clearable` are
 * claims about OTHER repositories and nothing here can falsify them - see
 * `FIELD_BUCKETS` in the register, which says so per field.
 *
 * WHY `src/guards/` AND NOT `rules-tests/`
 * ----------------------------------------
 * This is text parsing, not rule evaluation: no emulator, no JRE, no network.
 * `rules-tests/` is gated behind `npm run test:rules` BECAUSE it needs an
 * emulator, and a check that does not need one should not inherit that gate -
 * here it runs in `npm test`, so it is on every ship gate rather than on the
 * ones where someone remembered.
 *
 * THE UNIT IS ONE DIFF PER (ENTRY, OP), AND THAT IS A CHOICE
 * ---------------------------------------------------------
 * A site's field set can be shared: `ganttapp_projects` guards two ops from
 * ONE helper, so a per-HELPER comparator would report one difference where
 * this reports two. Both are defensible. This one matches the granularity the
 * register itself records - `lines` carries one entry per op, and the emulator
 * suite generates its cases the same way - so a report names the exact rule
 * line that disagrees rather than a helper the reader must then locate.
 * State the unit whenever quoting a count from this file.
 */

/** Where the field set for one guarded op is enforced, and what it holds. */
interface ResolvedSite {
  /** Document path the enclosing `match` blocks spell out, e.g. `a/b`. */
  path: string;
  /** The operation this `allow` statement guards. */
  op: string;
  /** 1-based line in firestore.rules carrying the `hasOnly(`. */
  line: number;
  /** Helper name for the call form, or null when the array is inline. */
  helper: string | null;
  /** The field set the rule actually enforces. */
  fields: string[];
}

/** One disagreement between the register and the ruleset. */
interface Diff {
  key: string;
  op: string;
  line: number;
  /** In the register's `allowlist`, absent from the rule. */
  missingFromRules: string[];
  /** Enforced by the rule, absent from the register's `allowlist`. */
  extraInRules: string[];
}

/**
 * A `hasOnly()` site that no register entry claims.
 *
 * REPORTED, NEVER SKIPPED - `target + reason`, the same shape the pointer
 * meter uses for an unresolvable pin. An unclaimed site is indistinguishable
 * from an allowlist that shipped without an entry, which is the gap this file
 * would otherwise leave open at its own edge.
 */
interface Uncovered {
  line: number;
  target: string;
  reason: string;
}

/**
 * Sites deliberately outside the register, by helper name.
 *
 * MEMBERSHIP IS PINNED HERE ON PURPOSE. The uncovered set is a deterministic
 * property of the file - not, as with the pointer-check skip census, an
 * artifact of how a parser reads prose - so pinning it is what makes a
 * FIFTEENTH site shipping without a register entry fail this guard. Adding a
 * row here is a decision, and it must carry the reason.
 */
const KNOWN_UNCOVERED: Readonly<Record<string, string>> = {
  ganttAppSnapshotFields:
    'snapshot site keeps its own suite - rules-tests/ganttapp-snapshot-fields.test.ts',
};

const RULES_PATH = resolve(process.cwd(), 'firestore.rules');

/**
 * The ruleset with every `//` comment blanked but LINE POSITIONS PRESERVED.
 *
 * Both halves are load-bearing. Stripping at all: `hasOnly(` occurs 49 times
 * in this file and only 22 of those are code, so a comment-blind reader would
 * resolve prose and a commented-out rule would count. Blanking rather than
 * deleting: the walk below indexes `split('\n')` against real line numbers and
 * takes character offsets into the same string, and deleting lines would
 * desynchronise both.
 */
function strippedRules(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

/**
 * Text between the parentheses of the call starting at `open`, balanced.
 *
 * A regex cannot do this: the inline sites carry a bracketed array that spans
 * up to five lines, and `spertcfd_settings` carries one on a single line.
 */
function balanced(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced parentheses at offset ${open}`);
}

/** Every single-quoted string in an array literal, in order. */
function literals(arrayText: string): string[] {
  return [...arrayText.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

/**
 * Every `function xFields() { return [...]; }` in the ruleset.
 *
 * Read from the stripped text, so a helper quoted in a comment is not a
 * definition.
 */
function helperTables(stripped: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const m of stripped.matchAll(
    /function\s+(\w+)\s*\(\s*\)\s*\{\s*return\s*\[([^\]]*)\]/g,
  )) {
    out.set(m[1], literals(m[2]));
  }
  return out;
}

/**
 * Every non-comment `hasOnly(` site, keyed by the DOCUMENT PATH and OPERATION
 * its enclosing `match` and `allow` spell out.
 *
 * ⚠️ DELIBERATELY NOT KEYED ON LINE NUMBER, and this was measured the wrong
 * way round first. Keying on the register's `lines` makes any edit that shifts
 * the file cascade: inserting ONE line above the rules produced nineteen
 * disagreement rows, one per entry, each claiming its whole allowlist was
 * unenforced — because every citation then pointed a line off its rule. The
 * real defect was one inserted line, and the report buried it.
 *
 * Worse, it welded this guard to the positional fragility §3.2 calls a decoy.
 * Keyed structurally, a pure line shift produces ZERO rows here — correctly,
 * because no field set moved — and the emulator suite's `lines` citation check
 * still reds on the stale numbers. Measured, inserting one comment line above
 * `rules_version`: this file 3 passed / 0 rows, `npm run test:rules`
 * 1 failed / 151 passed / 20 skipped. The two guards answer different
 * questions — that one asks whether the citations still land, this one asks
 * whether the field sets agree — and neither substitutes for the other.
 */
function resolveSites(text: string): ResolvedSite[] {
  const stripped = strippedRules(text);
  const helpers = helperTables(stripped);
  const sites: ResolvedSite[] = [];

  // Segment stack, one entry per `match` block, plus the brace depth it opened
  // at so it can be popped. The root `match /databases/{db}/documents` is not a
  // collection and is skipped.
  const stack: { seg: string; depth: number }[] = [];
  let depth = 0;

  const lines = stripped.split('\n');
  // Offset of the start of each line, so a line index maps to a character
  // position without re-splitting the file per site.
  const lineStart: number[] = [];
  let acc = 0;
  for (const l of lines) {
    lineStart.push(acc);
    acc += l.length + 1;
  }

  lines.forEach((raw, i) => {
    const line = i + 1;
    const match = /match\s+\/([A-Za-z_][A-Za-z0-9_]*)\/\{[A-Za-z0-9_]+\}/.exec(raw);
    const opens = (raw.match(/\{/g) ?? []).length;
    const closes = (raw.match(/\}/g) ?? []).length;

    if (match && !raw.includes('/databases/')) stack.push({ seg: match[1], depth });

    // A `hasOnly(` may sit several lines below its `allow`, so search backwards
    // for the operation rather than assuming they share a line.
    if (raw.includes('hasOnly(')) {
      const idx = stripped.indexOf('hasOnly(', lineStart[i]);
      const arg = balanced(stripped, idx + 'hasOnly'.length).trim();

      let ops: string[] = [];
      for (let j = i; j >= 0 && !ops.length; j--) {
        const a = /allow\s+([A-Za-z,\s]+?)\s*:/.exec(lines[j]);
        if (a) ops = a[1].split(',').map((s) => s.trim()).filter(Boolean);
      }
      if (!ops.length) throw new Error(`no enclosing allow for hasOnly() at line ${line}`);

      let fields: string[];
      let helper: string | null = null;
      const call = /^(\w+)\s*\(\s*\)$/.exec(arg);
      if (call) {
        const table = helpers.get(call[1]);
        if (!table) throw new Error(`no helper table for ${call[1]}() at line ${line}`);
        helper = call[1];
        fields = table;
      } else if (arg.startsWith('[')) {
        fields = literals(arg);
      } else {
        throw new Error(`unrecognised hasOnly() argument at line ${line}: ${arg.slice(0, 60)}`);
      }

      const path = stack.map((s) => s.seg).join('/');
      for (const op of ops) sites.push({ path, op, line, helper, fields });
    }

    depth += opens - closes;
    while (stack.length && depth <= stack[stack.length - 1].depth) stack.pop();
  });
  return sites;
}

/** The key a register entry and a resolved site must agree on. */
function siteKey(path: string, op: string): string {
  return `${path}#${op}`;
}

/** The document path a register entry describes, as the ruleset spells it. */
function contractPath(c: AllowlistContract): string {
  return c.sub === null ? c.collection : `${c.collection}/${c.sub}`;
}

/** Compare the register against the ruleset, one row per (entry, op). */
function compare(contracts: readonly AllowlistContract[], sites: ResolvedSite[]): Diff[] {
  const byKey = new Map(sites.map((s) => [siteKey(s.path, s.op), s]));
  const diffs: Diff[] = [];

  for (const c of contracts) {
    for (const op of c.ops) {
      const site = byKey.get(siteKey(contractPath(c), op));
      // An entry naming a path/op the ruleset does not guard is a real
      // disagreement, not a row to skip: it means the register describes an
      // allowlist that is no longer there.
      if (!site) {
        diffs.push({
          key: c.key,
          op,
          line: 0,
          missingFromRules: [...c.allowlist].sort(),
          extraInRules: [],
        });
        continue;
      }
      if (sameSet(c.allowlist, site.fields)) continue;

      const enforced = new Set(site.fields);
      const declared = new Set(c.allowlist);
      diffs.push({
        key: c.key,
        op,
        line: site.line,
        missingFromRules: c.allowlist.filter((f) => !enforced.has(f)).sort(),
        extraInRules: site.fields.filter((f) => !declared.has(f)).sort(),
      });
    }
  }
  return diffs;
}

/** Sites no register entry claims, each carrying why. */
function uncovered(contracts: readonly AllowlistContract[], sites: ResolvedSite[]): Uncovered[] {
  const claimed = new Set(
    contracts.flatMap((c) => c.ops.map((op) => siteKey(contractPath(c), op))),
  );
  return sites
    .filter((s) => !claimed.has(siteKey(s.path, s.op)))
    .map((s) => ({
      line: s.line,
      target: `${s.path} ${s.op} (${s.helper ? `${s.helper}()` : `inline [${s.fields.join(', ')}]`})`,
      reason:
        (s.helper && KNOWN_UNCOVERED[s.helper]) ??
        'NOT CLAIMED BY ANY REGISTER ENTRY - add one, or record it in KNOWN_UNCOVERED with a reason',
    }));
}

function render(d: Diff): string {
  const parts = [
    d.missingFromRules.length ? `declared-but-not-enforced: ${d.missingFromRules.join(', ')}` : '',
    d.extraInRules.length ? `enforced-but-not-declared: ${d.extraInRules.join(', ')}` : '',
  ].filter(Boolean);
  return `${d.key} ${d.op} (firestore.rules:${d.line}) - ${parts.join(' | ')}`;
}

describe('register allowlist vs firestore.rules', () => {
  const text = readFileSync(RULES_PATH, 'utf8');
  const sites = resolveSites(text);

  it('resolves every non-comment hasOnly() site in the ruleset', () => {
    // Not a tautology: `resolveSites` THROWS on a helper it cannot resolve or
    // an argument shape it does not recognise, so this pins that every site is
    // one of the two forms the comparator understands. The count is asserted
    // as a floor rather than an equality - a new site must fail the coverage
    // check below with a name, not this one with an arithmetic mismatch.
    expect(sites.length, 'resolved hasOnly() sites').toBeGreaterThanOrEqual(
      ALLOWLIST_CONTRACTS.reduce((n, c) => n + c.ops.length, 0),
    );
    for (const s of sites) {
      expect(s.fields.length, `firestore.rules:${s.line} field set`).toBeGreaterThan(0);
    }
  });

  it('declares exactly the field set each cited rule enforces', () => {
    const diffs = compare(ALLOWLIST_CONTRACTS, sites);
    // The full rows, not a count: a bare number cannot tell a reader which
    // side is wrong, and "how many" is the least useful thing to know here.
    expect(diffs.map(render), 'register/ruleset disagreements').toEqual([]);
  });

  it('accounts for every hasOnly() site, claiming or exempting it by name', () => {
    const rows = uncovered(ALLOWLIST_CONTRACTS, sites);
    const surprises = rows.filter((r) => !Object.values(KNOWN_UNCOVERED).includes(r.reason));
    expect(
      surprises.map((r) => `firestore.rules:${r.line} ${r.target} - ${r.reason}`),
      'hasOnly() sites with neither a register entry nor a recorded exemption',
    ).toEqual([]);

    // The exemption list must not rot either. A recorded exemption that names
    // nothing is a standing licence to ignore a site that no longer exists,
    // and the next real site to appear under that helper would inherit it.
    const exemptHelpers = new Set(
      sites.map((s) => s.helper).filter((h): h is string => h !== null),
    );
    for (const helper of Object.keys(KNOWN_UNCOVERED)) {
      expect(exemptHelpers, `KNOWN_UNCOVERED.${helper} still names a real site`).toContain(helper);
    }
  });
});
