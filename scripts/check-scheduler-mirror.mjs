// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Has spert-scheduler's copy of firestore.rules fallen behind canonical?
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is NOT the production-drift check. `check-deployed-rules.mjs` asks the
 * running Firestore project what it is actually enforcing, and a red there is
 * an incident. This compares a TEST FIXTURE in another repository; a red here
 * is housekeeping — propagation debt with no production effect. The two live
 * in SEPARATE workflows on purpose, so the two red X's never have to be told
 * apart by reading a job name. (They were nearly one workflow. `paths:` under
 * `on.pull_request` is workflow-level, not per-job, so adding firestore.rules
 * to a shared trigger would have run the production check on every rules PR —
 * where the branch is ahead of production by construction, and the incident
 * job would have gone red on correct work.)
 *
 * WHY IT EXISTS
 * -------------
 * spert-scheduler keeps the suite's only sanctioned copy of firestore.rules.
 * `preferences-firestore-sync.test.ts` there reads it from disk and asserts
 * that every key of the Zod UserPreferencesSchema appears in the
 * `spertscheduler_settings` hasOnly() allowlist — a real guard against adding
 * a preference and forgetting the rule. The copy earns its keep. It just had
 * nothing watching IT, and it has now fallen behind three times. Every time,
 * the only reason anyone noticed was a human running `diff` by hand.
 *
 * THE REJECTED ALTERNATIVE — do not re-propose it
 * -----------------------------------------------
 * Making `preferences-firestore-sync.test.ts` also assert the two files match.
 * It would need an absolute path to a sibling repo that does not exist in CI,
 * hence a conditional skip — a guard that silently no-ops in the one place it
 * runs automatically. That is the failure mode shipgate.config.json documents
 * about public/CHANGELOG.md going five months stale because nothing read it,
 * and it is how this drift happened in the first place.
 *
 * WHAT IS COMPARED: non-comment lines, from `rules_version` onward
 * ---------------------------------------------------------------
 * The two files will never be byte-identical again. The mirror carries a
 * deliberate REFERENCE-ONLY preamble, and at v0.64.6 it wrote its own
 * correction to the Console-deploy paragraph in different wording from ours.
 * Both are correct; neither should adopt the other's. Measured on 2026-08-20:
 * 34 substantive lines against a raw diff of 315.
 *
 * That ratio is a floor that degrades MONOTONICALLY. Every future divergence —
 * either repo correcting its own preamble, either repo's audit-history block
 * growing — adds to the numerator and nothing to the denominator. A guard
 * built on raw line comparison would not merely start noisy; it would get
 * worse forever, which is the shape of a check that gets muted rather than
 * fixed. Do not widen this back to raw lines.
 *
 * ⚠️ THE SLICE FROM `rules_version` LOOKS REDUNDANT AND IS NOT. Today both
 * preambles happen to reduce to exactly two blank lines once `//` lines are
 * dropped, so stripping ALONE currently yields the same answer and the slice
 * appears to be dead code. It is coincidence. Insert one blank line into
 * either comment preamble and strip-only goes 34 -> 35, while slice-then-strip
 * stays 34 — a pure comment edit leaking into the count. Measured, not
 * assumed. Deleting the slice re-opens exactly the noise the stripping solves.
 *
 * ⚠️ DELIBERATELY BLIND TO THE COPYRIGHT HEADER. Stripping `^\s*\/\/` makes this
 * structurally unable to see the three-line header vanish from the mirror.
 * That is a DELEGATION, not an oversight: spert-scheduler's own
 * copyright-headers guard owns that file and fails its build if the header
 * goes missing. Recorded here because the gap is real and someone who finds it
 * without this paragraph will conclude the comparison is too narrow and widen
 * it back to raw lines — undoing the reasoning above to fix a problem another
 * repo already holds closed.
 *
 * ⚠️ FAILS ON ANY INABILITY TO CHECK — fetch failure, missing file, absent
 * `rules_version`. It never skips and never passes with a warning. Same rule
 * as run-rules-tests.mjs, and for the same reason: a guard that quietly does
 * nothing looks identical to a guard that passed.
 *
 * TRANSPORT. The GitHub Contents API, via fetch — Node built-ins only, no git
 * shell-out and no working copy, matching check-deployed-rules.mjs. Scheduler
 * is public, so no PAT: GITHUB_TOKEN is used when present purely for the
 * higher rate limit. The response's blob SHA is reported so a summary read six
 * hours later names WHICH revision was compared.
 *
 * USAGE
 *   node scripts/check-scheduler-mirror.mjs [--ref <git-ref>] [--mirror-file <path>]
 *
 *   --ref          branch/tag/SHA to read the mirror from (default: main).
 *   --mirror-file  compare against a local copy instead of fetching. For
 *                  checking a Scheduler branch before it merges, and for this
 *                  script's own falsification cases.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OWNER = 'famousdavis';
const REPO = 'spert-scheduler';
const RULES_FILE = 'firestore.rules';
const MAX_REPORTED = 25;

function die(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
let ref = 'main';
let mirrorFile = null;
for (let i = 0; i < argv.length; i++) {
  const next = () => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) die(`${argv[i]} needs a value.`);
    i++;
    return v;
  };
  if (argv[i] === '--ref') ref = next();
  else if (argv[i] === '--mirror-file') mirrorFile = next();
  else die(`Unknown argument: ${argv[i]}`);
}

// ------------------------------------------------------------------ sources
/** The mirror, as text, plus a human-legible provenance line. */
async function readMirror() {
  if (mirrorFile) {
    let text;
    try {
      text = readFileSync(resolve(process.cwd(), mirrorFile), 'utf8');
    } catch (e) {
      die(`Could not read --mirror-file ${mirrorFile}: ${e.message}\nDrift was NOT checked.`);
    }
    return { text, origin: `local file ${mirrorFile}`, blob: '(local, not fetched)' };
  }

  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${RULES_FILE}?ref=${encodeURIComponent(ref)}`;
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'spert-landing-mirror-drift' };
  // Public repo — this is a rate-limit courtesy, not an access requirement.
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let res;
  try {
    res = await fetch(url, { headers });
  } catch (e) {
    die(`Could not reach the GitHub Contents API: ${e.message}\nDrift was NOT checked.`);
  }
  if (!res.ok) {
    die(
      `GitHub Contents API returned HTTP ${res.status} for ${OWNER}/${REPO}@${ref}:${RULES_FILE}\n` +
        `${(await res.text()).slice(0, 300)}\n\nDrift was NOT checked.`,
    );
  }

  const body = await res.json();
  if (body.encoding !== 'base64' || typeof body.content !== 'string') {
    die(`Unexpected Contents API payload (encoding=${body.encoding}). Drift was NOT checked.`);
  }
  const text = Buffer.from(body.content, 'base64').toString('utf8');
  if (!text.trim()) die('The fetched mirror was empty. Drift was NOT checked.');

  return { text, origin: `${OWNER}/${REPO}@${ref}`, blob: body.sha ?? '(absent)' };
}

// ------------------------------------------------------- normalise the input
/**
 * Drop `//` comment lines, then slice from the `rules_version` declaration.
 *
 * Order matters: stripping FIRST means a commented-out mention of
 * rules_version in a preamble cannot be mistaken for the declaration. Blank
 * lines inside the body are KEPT — after the slice, a blank-line change there
 * is a hand edit of the fixture, and detecting hand edits is the point.
 *
 * Original file line numbers ride along so the report can point at something
 * a reader can actually open.
 */
function significantLines(text, label) {
  const lines = text.split('\n');
  // A trailing newline leaves a phantom final element. Drop it so the counts
  // printed here match what `grep -vE '^\s*//' file | wc -l` gives a human
  // cross-checking by hand — an unexplained off-by-one invites a second look
  // at a guard that is working.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const kept = lines
    .map((text_, i) => ({ n: i + 1, text: text_ }))
    .filter(({ text: t }) => !/^\s*\/\//.test(t));

  const start = kept.findIndex(({ text: t }) => /^rules_version\b/.test(t));
  if (start === -1) {
    die(`No \`rules_version\` declaration found in ${label}. Drift was NOT checked.`);
  }
  return kept.slice(start);
}

// ------------------------------------------------------------- the diff
/**
 * Minimal edit script over line text, by LCS.
 *
 * NOT the positional walk check-deployed-rules.mjs uses. That is correct there
 * because byte-identity is the expectation; here the two sides differ in
 * LENGTH, and a positional walk reports 236 differing lines where the real
 * answer is 34 — a 7x overstatement that buries the signal it exists to show.
 *
 * ~412x388 cells. Trivial at this size; revisit only if the rules file grows
 * by an order of magnitude.
 */
function diffLines(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i].text === b[j].text ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].text === b[j].text) {
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ side: 'canonical', ...a[i++] });
    } else {
      out.push({ side: 'mirror', ...b[j++] });
    }
  }
  while (i < n) out.push({ side: 'canonical', ...a[i++] });
  while (j < m) out.push({ side: 'mirror', ...b[j++] });
  return out;
}

// ----------------------------------------------------------------- run
const canonicalText = (() => {
  try {
    return readFileSync(resolve(process.cwd(), RULES_FILE), 'utf8');
  } catch (e) {
    die(`Could not read ${RULES_FILE} in this repo: ${e.message}\nDrift was NOT checked.`);
  }
})();

const mirror = await readMirror();

const canonical = significantLines(canonicalText, `canonical ${RULES_FILE}`);
const mirrored = significantLines(mirror.text, `the mirror (${mirror.origin})`);

console.log(`canonical    ${RULES_FILE} in this repo`);
console.log(`mirror       ${mirror.origin}:${RULES_FILE}`);
console.log(`blob         ${mirror.blob}`);
console.log(`             (in a Scheduler checkout: git hash-object ${RULES_FILE})`);
console.log(`compared     ${canonical.length} vs ${mirrored.length} lines`);
console.log('             comments stripped, from `rules_version` onward');

const diffs = diffLines(canonical, mirrored);

if (diffs.length === 0) {
  console.log('\nIn sync — the mirror carries the same rule content as canonical.');
  process.exit(0);
}

const canonicalOnly = diffs.filter((d) => d.side === 'canonical');
const mirrorOnly = diffs.filter((d) => d.side === 'mirror');

console.error(`\nDRIFT: the ${REPO} mirror does not carry canonical's rule content.`);
console.error(`\n${diffs.length} differing non-comment line(s):`);
console.error(`  ${canonicalOnly.length} in canonical but not the mirror`);
console.error(`  ${mirrorOnly.length} in the mirror but not canonical`);
console.error(
  [
    '',
    'READ THE SECOND NUMBER CAREFULLY. Mirror-only lines do NOT on their own',
    'mean the fixture was hand-edited. When canonical REFLOWS a rule it already',
    'had — splitting an `allow create` across more lines to append a hasOnly(),',
    'say — the mirror still holds the superseded one-line form, and that form',
    'shows up on the mirror side. All five mirror-only lines in the 2026-08-20',
    'measurement were exactly that. Look at the lines before concluding tampering.',
  ].join('\n'),
);

console.error('');
for (const { side, n, text } of diffs.slice(0, MAX_REPORTED)) {
  console.error(`  ${side === 'canonical' ? 'canonical' : 'mirror   '} line ${String(n).padStart(4)}  ${JSON.stringify(text)}`);
}
if (diffs.length > MAX_REPORTED) console.error(`  … and ${diffs.length - MAX_REPORTED} more.`);

console.error(
  [
    '',
    'This is a TEST FIXTURE, not production. Nothing users touch is affected,',
    'and the deployed ruleset is checked separately by check-deployed-rules.mjs.',
    '',
    'To resolve: propagate canonical into spert-scheduler as its own patch',
    'release — that repo has its own ship gate, and the mirror is read at test',
    'time by preferences-firestore-sync.test.ts. Copy the rule BODY only; the',
    'REFERENCE-ONLY preamble there is deliberate and must not be overwritten.',
    '',
  ].join('\n'),
);
process.exit(1);
