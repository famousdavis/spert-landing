// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { execFileSync } from 'node:child_process';

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

const CHANGELOG_PATH = 'src/data/changelog.ts';

/** `execFileSync` rejects with these fields set; `stderr` is a string because we pass an encoding. */
interface GitFailure extends Error {
  status?: number | null;
  code?: string;
  stderr?: string;
}

/** A probe's outcome kept as data, so tests can inject shapes that are impractical to produce. */
type ProbeResult = { raw: string } | { error: GitFailure };
type Probe = () => ProbeResult;

const shallowProbe: Probe = () => {
  try {
    return { raw: execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }) };
  } catch (error) {
    return { error: error as GitFailure };
  }
};

/**
 * Classify the repository: `null` to proceed, or the reason to skip.
 *
 * Deliberately a three-way over the TRIMMED value with a named `else`, rather
 * than `if (raw === 'true')`. The probe returns `"true\n"`; an omitted `.trim()`
 * makes that match neither 'true' nor 'false', and under a two-way it would fall
 * through and PROCEED — running this guard in CI, the one outcome the gate
 * exists to prevent. Under the three-way it lands in `else`, skips, and prints
 * the raw value, so the bug announces itself rather than needing a test to catch
 * it.
 *
 * Every reason interpolates the underlying stderr rather than using a fixed
 * string, so a broad catch cannot collapse "not a work tree" into "git missing".
 */
function classifyRepository(probe: Probe = shallowProbe): string | null {
  const result = probe();

  if ('error' in result) {
    const { code, status, stderr, message } = result.error;
    if (code === 'ENOENT') return 'git is not on PATH';
    if (status === 128) return `not a git work tree: ${(stderr ?? '').trim()}`;
    return `git rev-parse failed: ${((stderr ?? '').trim() || message).trim()}`;
  }

  const value = result.raw.trim();
  if (value === 'false') return null;
  if (value === 'true') return 'shallow clone — this guard is local-only, see the comment above';
  return `unexpected output from git rev-parse --is-shallow-repository: ${JSON.stringify(result.raw)}`;
}

/** A local `Date` rendered as YYYY-MM-DD via LOCAL getters — never `toISOString()`, which is UTC. */
function asLocalDay(value: Date): string {
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

/**
 * The local calendar date of the commit that introduced `version`.
 *
 * `--date=format-local:` is mandatory. `--date=format:` renders in the commit's
 * own recorded timezone, which is right for a locally-authored commit and wrong
 * for a GitHub squash (those record `+0000`) — and after a squash-merge branch
 * (a) resolves to the squash.
 */
function introducedOn(version: string): string | undefined {
  const out = execFileSync(
    'git',
    [
      'log',
      '--reverse',
      '--format=%cd',
      '--date=format-local:%Y-%m-%d',
      '-S',
      `version: '${version}',`,
      '--',
      CHANGELOG_PATH,
    ],
    { encoding: 'utf8' },
  );
  return out.split('\n')[0]?.trim() || undefined;
}

function changelogIsModified(): boolean {
  const out = execFileSync('git', ['status', '--porcelain', '--', CHANGELOG_PATH], { encoding: 'utf8' });
  return out.trim() !== '';
}

interface OracleDeps {
  introducedOn: (version: string) => string | undefined;
  changelogIsModified: () => boolean;
  today: () => string;
}

const realOracleDeps: OracleDeps = {
  introducedOn,
  changelogIsModified,
  today: () => asLocalDay(new Date()),
};

/**
 * Resolve the date the newest entry SHOULD carry.
 *
 * (a) the commit that introduced it, when history has it;
 * (b) else today, when the file has uncommitted changes — the release-time state;
 * (c) else skip, because there is nothing to compare against. Branch (c) is
 *     reachable: the pickaxe matches a literal `version: '<v>',`, so reformatting
 *     the data file empties (a) permanently while leaving the file clean. Without
 *     (c) that state resolves to `undefined` and fails with a confusing message
 *     instead of saying what happened.
 */
function expectedDate(version: string, deps: OracleDeps = realOracleDeps): { date?: string; skip?: string } {
  const introduced = deps.introducedOn(version);
  if (introduced !== undefined) return { date: introduced };
  if (deps.changelogIsModified()) return { date: deps.today() };
  return {
    skip:
      `no commit introduces \`version: '${version}',\` in ${CHANGELOG_PATH} and the file is ` +
      'unmodified, so the expected date cannot be determined — if the file was reformatted, ' +
      'the pickaxe string in this guard needs updating',
  };
}

/** Parse an entry's `date` to a local YYYY-MM-DD, or `undefined` if it will not parse. */
function statedDay(date: string): string | undefined {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? undefined : asLocalDay(parsed);
}

const LONG_EN_US: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' };

/**
 * The newest entry's date, checked against the commit that introduced it.
 *
 * v2.5.19 shipped dated August 20 from a commit made at 01:03 on August 21 — a
 * carried-forward date, not timezone arithmetic. Nothing computes from a
 * changelog date, so the cost of getting it wrong is cosmetic; the mechanism is
 * not, because it recurs and the alternative control is a checklist line.
 *
 * THE ORACLE HAS THREE STATES, and only the first is actionable:
 *
 *   entry written, still uncommitted  → (b) today, local  ← catches the defect
 *   committed on the feature branch   → (a) the branch commit — correct
 *   after squash-merge                → (a) the SQUASH commit
 *
 * A squash discards the branch commit entirely (`git merge-base --is-ancestor`
 * against the pre-squash SHA exits 1). So a branch commit at 23:5x whose squash
 * lands after local midnight flips branch (a), and `main` goes red locally until
 * the next release displaces `changelog[0]`. The remedy is to fix the date
 * forward in the next release — never to edit history.
 *
 * THIS CHECK IS STRUCTURALLY LOCAL-ONLY. It compares a human-written local
 * calendar date against a commit date, and after squash-merge the author's UTC
 * offset is discarded: a locally-authored commit records its own offset (`-0400`,
 * which survives being read under any TZ), while a GitHub squash records `+0000`.
 * So the correct local date is unrecoverable from git metadata alone. Running
 * this in CI cannot be fixed by choosing a different `--date=` flag — the
 * information is gone. If `fetch-depth: 0` is ever added to the shared shipgate
 * workflow, this guard must stay gated off rather than be made to pass.
 *
 * It is correct only on a machine in the AUTHOR'S TIMEZONE, too: the same commit
 * renders 2026-03-10 under America/New_York and 2026-03-11 under Asia/Tokyo.
 * Inert while this is a one-developer repository; a second contributor in another
 * zone is the trigger to revisit.
 *
 * Why CI would fail if it ran: GitHub-hosted runners are UTC, so
 * `--date=format-local:` resolves to UTC there and would compare a stated local
 * date against a UTC one. The exposure is any release whose commit falls on a
 * LATER UTC CALENDAR DAY THAN ITS LOCAL ONE. That is the mechanism; the clock
 * boundary is illustration only and moves with DST (20:00 EDT, 19:00 EST), so do
 * not restate this as a fixed time.
 */
describe('changelog dates', () => {
  it('dates the newest entry the local day of the commit that introduced it', (ctx) => {
    const blocked = classifyRepository();
    if (blocked !== null) ctx.skip(`date-vs-commit check not run — ${blocked}`);

    const entry = changelog[0];
    if (entry === undefined) throw new Error('changelog is empty');

    const oracle = expectedDate(entry.version);
    if (oracle.skip !== undefined) ctx.skip(`date-vs-commit check not run — ${oracle.skip}`);

    const stated = statedDay(entry.date);
    expect(stated, `v${entry.version} has an unparseable date: "${entry.date}"`).toBeDefined();

    expect(
      stated,
      `v${entry.version} is dated "${entry.date}" but its commit landed ${oracle.date} local`,
    ).toBe(oracle.date);
  });

  /**
   * `new Date()` certifies a misspelled month — V8's legacy parser skips tokens
   * it does not recognise, so "Augustt 21, 2026" and "Auggust 21, 2026" both
   * parse to a valid August 21 and sail past the check above while rendering the
   * typo on the page. Round-tripping through the formatter rejects them, and
   * pins the long form as a side effect.
   *
   * Scoped to `changelog[0]`, matching the check above. All 43 entries round-trip
   * today, but asserting over every one of them would couple this guard to the
   * whole of history for no added protection — the frozen entries cannot change.
   */
  it('writes the newest entry date in the long en-US form', () => {
    const entry = changelog[0];
    if (entry === undefined) throw new Error('changelog is empty');

    const parsed = new Date(entry.date);
    expect(Number.isNaN(parsed.getTime()), `v${entry.version} date will not parse: "${entry.date}"`).toBe(
      false,
    );

    expect(
      parsed.toLocaleDateString('en-US', LONG_EN_US),
      `v${entry.version} is dated "${entry.date}"; write it as "Month D, YYYY"`,
    ).toBe(entry.date);
  });

  it('gives every probe outcome a distinct, named skip reason', () => {
    const failure = (fields: Partial<GitFailure>): Probe => () => ({
      error: Object.assign(new Error('Command failed: git rev-parse'), fields) as GitFailure,
    });

    expect(classifyRepository(() => ({ raw: 'false\n' }))).toBeNull();
    expect(classifyRepository(() => ({ raw: 'true\n' }))).toMatch(/shallow clone/);
    // The untrimmed value a two-way comparison would let fall through to PROCEED.
    expect(classifyRepository(() => ({ raw: '"true"\n' }))).toMatch(/unexpected output/);
    expect(classifyRepository(() => ({ raw: '' }))).toMatch(/unexpected output/);
    expect(classifyRepository(failure({ code: 'ENOENT', status: null }))).toBe('git is not on PATH');
    expect(
      classifyRepository(failure({ status: 128, stderr: 'fatal: not a git repository\n' })),
    ).toBe('not a git work tree: fatal: not a git repository');

    const reasons = [
      classifyRepository(() => ({ raw: 'true\n' })),
      classifyRepository(() => ({ raw: 'weird\n' })),
      classifyRepository(failure({ code: 'ENOENT', status: null })),
      classifyRepository(failure({ status: 128, stderr: 'fatal: not a git repository\n' })),
      classifyRepository(failure({ status: 129, stderr: 'fatal: unknown option\n' })),
    ];
    expect(new Set(reasons).size, `reasons must be distinct: ${reasons.join(' | ')}`).toBe(reasons.length);
  });

  it('resolves all three oracle states, including the unreachable-pickaxe skip', () => {
    const deps = (over: Partial<OracleDeps>): OracleDeps => ({
      introducedOn: () => undefined,
      changelogIsModified: () => false,
      today: () => '2026-08-21',
      ...over,
    });

    expect(expectedDate('9.9.9', deps({ introducedOn: () => '2026-08-20' }))).toEqual({
      date: '2026-08-20',
    });
    expect(expectedDate('9.9.9', deps({ changelogIsModified: () => true }))).toEqual({
      date: '2026-08-21',
    });
    expect(expectedDate('9.9.9', deps({})).skip).toMatch(/no commit introduces/);
  });
});
