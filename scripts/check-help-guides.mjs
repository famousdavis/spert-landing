#!/usr/bin/env node
// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * The Help Center's two daily checks (2.13.0), run by .github/workflows/help-guides.yml
 * as two separate jobs, because their reds mean different things:
 *
 *   --links      "Guide links work". Every guide URL in src/data/help.ts must answer
 *                200, application/pdf, with a body starting %PDF-. A red is RARE and
 *                URGENT: people following that link get the wrong thing today.
 *
 *   --inventory  "Guide list matches the app repos". Each app repo's public/ folder,
 *                read over the GitHub Contents API, must hold exactly the guides
 *                help.ts lists (plus its notListed files and the legal copies). A red
 *                is ROUTINE: usually a new guide waiting for its help.ts entry.
 *
 * In one job, the routine red would hide the urgent one.
 *
 * HOW IT AVOIDS PASSING WHILE CHECKING NOTHING
 * - Redirects are never followed (redirect: 'manual'). Node's fetch follows them by
 *   default, and a moved guide, or a renamed repo, would then pass.
 * - A built-in CONTROL on every guide host: a file that cannot exist must be judged
 *   broken. On the Vite hosts a missing file is the app's own page, 200 text/html.
 * - A SHORT RUN is a failure: fewer guides, controls or repos checked than help.ts
 *   lists. Otherwise "every control discriminated" would be true of none.
 * - Every failure is built by fail(), which accepts only a code in VERDICTS, and
 *   every verdict has an action line in ACTIONS. G11 checks both.
 *
 * TIME: every check in a mode runs concurrently. A request has a 30 s timeout that
 * also covers reading the body, and is retried at most twice, 5 s apart, on network
 * errors, timeouts and 5xx only. So a mode takes at most 3 × 30 + 2 × 5 = 100 s.
 *
 * Guards: src/guards/help-guides-check.test.ts (G8–G11) drives the exported
 * functions against a local server. Importing this file runs nothing.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HELP_APPS, NOT_GUIDES, guideUrl } from '../src/data/help.ts';

/** Every failure this script can report. fail() refuses any other code. */
export const VERDICTS = [
  'app-page',
  'moved',
  'removed',
  'not-pdf',
  'unreachable',
  'control-passed',
  'empty-run',
  'short-run',
  'new-guide',
  'guide-gone',
  'stale-notlisted',
  'repo-moved',
  'repo-missing',
  'rate-limited',
  'api-error',
];

/** What to do about each failure. The failure's detail names the repo, file or host. */
export const ACTIONS = {
  'app-page':
    'the host served the app instead of the guide: the file is gone from the repo\'s public/. If it was renamed, add a redirect there and update help.ts.',
  moved: 'update help.ts to the new file.',
  removed: 'check the repo\'s public/ folder.',
  'not-pdf': 'check the file in the repo\'s public/ folder.',
  unreachable: 'host problem, not a data problem; see the External health checks.',
  'control-passed':
    'the host now answers 200 with a PDF for any path, so this run can\'t tell broken from working. Don\'t trust its green.',
  'empty-run': 'help.ts lists nothing to check: it is empty, or failed to import.',
  'short-run':
    'the run checked less than help.ts lists, so its green would mean nothing. The per-check lines above show what ran.',
  'new-guide':
    'add it to help.ts, with a description for William to approve, or to notListed with a reason. It ships as a patch release.',
  'guide-gone': 'renamed or removed. If renamed, the new name also shows as "new guide not listed".',
  'stale-notlisted': 'remove it from notListed in help.ts.',
  'repo-moved': 'update repo in help.ts to the new owner/name.',
  'repo-missing': 'check repo in help.ts, and that the repo\'s default branch is main.',
  'rate-limited': 'set GITHUB_TOKEN.',
  'api-error': 're-run; if it repeats, read the response in the log.',
};

export const PASS = Object.freeze({ ok: true });

/** The only way to make a failure. Throws on a code outside VERDICTS, so no failure lacks an action line. */
export function fail(code, detail = '') {
  if (!VERDICTS.includes(code)) throw new Error(`fail(): "${code}" is not in VERDICTS`);
  return { ok: false, code, detail };
}

const ATTEMPTS = 3;
const CLI_OPTIONS = { timeoutMs: 30_000, retryDelayMs: 5_000 };
const CONTROL_PATH = '/__help_link_check_missing__.pdf';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const discard = (res) => res.body?.cancel().catch(() => {});

/**
 * Runs `attempt(signal)` up to three times. An attempt returns a verdict, or
 * { retry: verdict } for a 5xx; a thrown error (network, or the timeout, which
 * also covers reading the body) is retried too. Anything else is final.
 */
async function withRetries(attempt, { timeoutMs, retryDelayMs }, failCode) {
  let last;
  for (let n = 1; n <= ATTEMPTS; n++) {
    if (n > 1) await sleep(retryDelayMs);
    try {
      const result = await attempt(AbortSignal.timeout(timeoutMs));
      if (!result.retry) return result;
      last = result.retry;
    } catch (e) {
      const why = e?.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : `network error: ${e?.message ?? e}`;
      last = fail(failCode, why);
    }
  }
  return { ...last, detail: `${last.detail} (after ${ATTEMPTS} attempts)` };
}

/** The first `n` bytes of a response body, as text; then the rest is discarded. */
async function readHead(res, n) {
  const reader = res.body.getReader();
  const chunks = [];
  let length = 0;
  while (length < n) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  await reader.cancel().catch(() => {});
  return Buffer.concat(chunks).subarray(0, n).toString('latin1');
}

/** One guide URL: PASS, or the failure that describes what a reader following it would get. */
export async function checkGuide(url, options = CLI_OPTIONS) {
  return withRetries(
    async (signal) => {
      const res = await fetch(url, { redirect: 'manual', signal });
      const { status } = res;
      if (status >= 500) {
        await discard(res);
        return { retry: fail('unreachable', `HTTP ${status}`) };
      }
      if (status >= 300 && status < 400) {
        await discard(res);
        return fail('moved', `HTTP ${status} to ${res.headers.get('location') ?? '(no location)'}`);
      }
      if (status === 404 || status === 410) {
        await discard(res);
        return fail('removed', `HTTP ${status}`);
      }
      if (status !== 200) {
        await discard(res);
        return fail('unreachable', `HTTP ${status}`);
      }
      const type = res.headers.get('content-type') ?? '';
      if (type.startsWith('text/html')) {
        await discard(res);
        return fail('app-page', `200 ${type}`);
      }
      if (!type.startsWith('application/pdf')) {
        await discard(res);
        return fail('not-pdf', `Content-Type ${type || '(none)'}`);
      }
      const head = await readHead(res, 5);
      return head === '%PDF-' ? PASS : fail('not-pdf', `body starts ${JSON.stringify(head)}, not %PDF-`);
    },
    options,
    'unreachable',
  );
}

/**
 * The entries of `<repo>/public` at main, over the GitHub Contents API:
 * { ok: true, entries: [{ name, type }] } or a failure. A redirect means the repo
 * moved or the name is wrong, and is never followed: followed, it would list
 * whatever repo now answers to the old name.
 *
 * @param {string} repo GitHub 'owner/name'
 * @param {{ apiBase?: string, token?: string, timeoutMs?: number, retryDelayMs?: number }} [options]
 */
export async function listPublic(repo, { apiBase = 'https://api.github.com', token, ...options } = CLI_OPTIONS) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'spert-landing-help-guides-check' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return withRetries(
    async (signal) => {
      const res = await fetch(`${apiBase}/repos/${repo}/contents/public?ref=main`, {
        headers,
        redirect: 'manual',
        signal,
      });
      const { status } = res;
      if (status >= 500) {
        await discard(res);
        return { retry: fail('api-error', `HTTP ${status}`) };
      }
      if (status >= 300 && status < 400) {
        await discard(res);
        return fail('repo-moved', `HTTP ${status} to ${res.headers.get('location') ?? '(no location)'}`);
      }
      if (status === 404) {
        await discard(res);
        return fail('repo-missing', 'HTTP 404');
      }
      if ((status === 403 || status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
        await discard(res);
        return fail('rate-limited', `HTTP ${status}, x-ratelimit-remaining: 0`);
      }
      if (status !== 200) {
        await discard(res);
        return fail('api-error', `HTTP ${status}`);
      }
      const body = await res.json();
      if (!Array.isArray(body)) return fail('api-error', 'the response is not a directory listing');
      return { ok: true, entries: body.map((e) => ({ name: String(e.name), type: String(e.type) })) };
    },
    { timeoutMs: options.timeoutMs ?? CLI_OPTIONS.timeoutMs, retryDelayMs: options.retryDelayMs ?? CLI_OPTIONS.retryDelayMs },
    'api-error',
  );
}

/**
 * Pure. Compares one app's help.ts entry with its repo's public/ entries. Only
 * files ending .pdf (any case) count; directories, other files and the legal
 * copies in NOT_GUIDES are ignored.
 */
export function compareInventory(app, entries) {
  const pdfs = entries.filter((e) => e.type === 'file' && /\.pdf$/i.test(e.name)).map((e) => e.name);
  const legal = new Set(NOT_GUIDES);
  const guides = new Set(app.guides.map((g) => g.file));
  const notListed = new Set((app.notListed ?? []).map((n) => n.file));
  const present = new Set(pdfs);
  const where = (file) => `${app.repo}/public/${file}`;

  const failures = [
    ...pdfs.filter((f) => !legal.has(f) && !guides.has(f) && !notListed.has(f)).map((f) => fail('new-guide', where(f))),
    ...[...guides].filter((f) => !present.has(f)).map((f) => fail('guide-gone', where(f))),
    ...[...notListed].filter((f) => !present.has(f)).map((f) => fail('stale-notlisted', where(f))),
  ];
  return {
    failures,
    counts: {
      pdfs: pdfs.length,
      listed: pdfs.filter((f) => guides.has(f)).length,
      notListed: pdfs.filter((f) => notListed.has(f)).length,
      ignored: pdfs.filter((f) => legal.has(f)).length,
    },
  };
}

/**
 * Run-level failures: an empty run, or a short one. A links report carries
 * expected { guides, hosts } and checked { guides, controls }; an inventory
 * report carries expected { repos } and checked { repos }.
 */
export function runFailures(report) {
  const { mode, expected, checked } = report;
  if (mode === 'links') {
    if (expected.guides === 0) return [fail('empty-run', 'help.ts lists no guides')];
    const short = [];
    if (checked.guides !== expected.guides) short.push(`${checked.guides} of ${expected.guides} guides`);
    if (checked.controls !== expected.hosts) short.push(`${checked.controls} of ${expected.hosts} host controls`);
    return short.length ? [fail('short-run', `checked ${short.join(' and ')}`)] : [];
  }
  if (expected.repos === 0) return [fail('empty-run', 'help.ts lists no apps')];
  return checked.repos === expected.repos
    ? []
    : [fail('short-run', `checked ${checked.repos} of ${expected.repos} repos`)];
}

/** 0 only when nothing failed and the run checked everything help.ts lists. */
export function exitCode(report) {
  return report.failures.length > 0 || runFailures(report).length > 0 ? 1 : 0;
}

function report(f, label) {
  console.log(`FAIL [${f.code}] ${label}: ${f.detail}`);
  console.log(`     → ${ACTIONS[f.code]}`);
}

async function runLinks() {
  const guides = HELP_APPS.flatMap((app) => app.guides.map((g) => ({ app, url: guideUrl(app, g) })));
  const hosts = [...new Set(guides.map((g) => new URL(g.url).host))];
  const failures = [];
  let checkedGuides = 0;
  let controls = 0;
  let discriminated = 0;

  await Promise.all([
    ...guides.map(async ({ app, url }) => {
      const v = await checkGuide(url);
      checkedGuides += 1;
      if (v.ok) console.log(`ok   ${url}`);
      else {
        failures.push(v);
        report(v, `${url} (repo ${app.repo})`);
      }
    }),
    ...hosts.map(async (host) => {
      const v = await checkGuide(`https://${host}${CONTROL_PATH}`);
      controls += 1;
      if (v.ok) {
        const f = fail('control-passed', host);
        failures.push(f);
        report(f, 'control');
      } else {
        discriminated += 1;
        console.log(`ok   control on ${host} judged broken (${v.code})`);
      }
    }),
  ]);

  const result = {
    mode: 'links',
    expected: { guides: guides.length, hosts: hosts.length },
    checked: { guides: checkedGuides, controls },
    failures,
  };
  for (const f of runFailures(result)) report(f, 'run');
  console.log(
    `SCOPE links: ${checkedGuides} guides on ${hosts.length} hosts, controls ${discriminated}/${controls} discriminated`,
  );
  return exitCode(result);
}

async function runInventory() {
  const token = process.env.GITHUB_TOKEN || undefined;
  const failures = [];
  const totals = { pdfs: 0, listed: 0, notListed: 0, ignored: 0 };
  let repos = 0;

  await Promise.all(
    HELP_APPS.map(async (app) => {
      const listing = await listPublic(app.repo, { ...CLI_OPTIONS, token });
      repos += 1;
      if (!listing.ok) {
        failures.push(listing);
        report(listing, `${app.repo} (help.ts entry "${app.slug}")`);
        return;
      }
      const { failures: found, counts } = compareInventory(app, listing.entries);
      for (const k of Object.keys(totals)) totals[k] += counts[k];
      if (found.length === 0) console.log(`ok   ${app.repo}: ${counts.pdfs} PDFs`);
      for (const f of found) {
        failures.push(f);
        report(f, app.slug);
      }
    }),
  );

  const result = { mode: 'inventory', expected: { repos: HELP_APPS.length }, checked: { repos }, failures };
  for (const f of runFailures(result)) report(f, 'run');
  console.log(
    `SCOPE inventory: ${repos} repos, ${totals.pdfs} PDFs (${totals.listed} listed, ${totals.notListed} notListed, ${totals.ignored} ignored)`,
  );
  return exitCode(result);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (mode === '--links') process.exitCode = await runLinks();
  else if (mode === '--inventory') process.exitCode = await runInventory();
  else {
    console.error('usage: node scripts/check-help-guides.mjs --links | --inventory');
    process.exitCode = 2;
  }
}
