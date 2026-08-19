// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Compare the DEPLOYED Firestore ruleset against firestore.rules in this repo.
 *
 * WHY
 * ---
 * `deploy-firestore-rules.yml` makes this repo authoritative whenever the file
 * changes. It cannot see an edit made directly in the Firebase Console — that
 * would persist, unnoticed, until the next commit touched the rules. This is
 * the check for exactly that residue.
 *
 * It closes the last part of the LIST-1 lesson (2026-08-19): every other guard
 * in the suite proves something about a FILE, and this is the only one that
 * asks production what it is actually enforcing.
 *
 * HOW
 * ---
 * Two Rules API reads:
 *   1. releases/cloud.firestore  -> the ruleset name currently released
 *   2. that ruleset              -> its source text
 * then a byte comparison against the repo file.
 *
 * Auth is a self-signed JWT exchanged for an access token — no gcloud, no
 * extra GitHub Action, no new dependency. Node's crypto does RS256.
 *
 * ⚠️ It reuses FIREBASE_SERVICE_ACCOUNT rather than a read-only account. That
 * key can already deploy rules, and it is already in this repo's secrets for
 * the deploy workflow, so a second read-only account would add setup without
 * removing any capability from anyone who can edit these workflows. Split it
 * only if the deploy secret ever moves to an environment this job should not
 * reach.
 *
 * ⚠️ FAILS on any inability to check. A drift monitor that silently cannot
 * reach the API looks exactly like one reporting no drift.
 */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROJECT = 'spert-suite';
const RULES_FILE = 'firestore.rules';

function die(msg) {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) die('FIREBASE_SERVICE_ACCOUNT is not set. Drift was NOT checked.');

let sa;
try {
  sa = JSON.parse(raw);
} catch {
  die('FIREBASE_SERVICE_ACCOUNT is not valid JSON. Drift was NOT checked.');
}
if (!sa.client_email || !sa.private_key) {
  die('FIREBASE_SERVICE_ACCOUNT is missing client_email/private_key.');
}

/** Self-signed JWT -> OAuth2 access token (the standard service-account flow). */
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    // cloud-platform is what the Firebase CLI itself requests. IAM is the real
    // boundary here, not the scope: this account holds firebaserules.admin and
    // serviceusage.serviceUsageConsumer and nothing else.
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${sig}`,
    }),
  });
  if (!res.ok) die(`Token exchange failed: HTTP ${res.status}\n${(await res.text()).slice(0, 400)}`);
  const { access_token: token } = await res.json();
  if (!token) die('Token exchange returned no access_token.');
  return token;
}

async function api(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    die(`Rules API call failed: HTTP ${res.status}\n${url}\n${(await res.text()).slice(0, 400)}`);
  }
  return res.json();
}

const token = await accessToken();

const release = await api(
  `https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases/cloud.firestore`,
  token,
);
if (!release.rulesetName) die('Release carried no rulesetName.');

const ruleset = await api(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, token);
const files = ruleset?.source?.files ?? [];
if (files.length !== 1) {
  die(`Expected exactly 1 source file in the deployed ruleset, got ${files.length}.`);
}

const deployed = files[0].content ?? '';
const local = readFileSync(resolve(process.cwd(), RULES_FILE), 'utf8');

console.log(`project      ${PROJECT}`);
console.log(`ruleset      ${release.rulesetName.split('/').pop()}`);
console.log(`released     ${ruleset.createTime ?? 'unknown'}`);
console.log(`deployed     ${deployed.length} bytes`);
console.log(`repo         ${local.length} bytes`);

if (deployed === local) {
  console.log('\nIn sync — the deployed ruleset is byte-identical to firestore.rules.');
  process.exit(0);
}

// Line-level report. Not a full diff algorithm: the useful signal is WHICH
// lines differ and how many, which is enough to tell a Console edit from a
// stale deploy at a glance.
const d = deployed.split('\n');
const l = local.split('\n');
const diffs = [];
for (let i = 0; i < Math.max(d.length, l.length); i++) {
  if (d[i] !== l[i]) diffs.push({ line: i + 1, deployed: d[i], repo: l[i] });
}

console.error('\nDRIFT: the deployed ruleset does NOT match firestore.rules.');
console.error(`${diffs.length} differing line(s); deployed has ${d.length}, repo has ${l.length}.\n`);
for (const { line, deployed: dv, repo: rv } of diffs.slice(0, 25)) {
  console.error(`  line ${line}`);
  console.error(`    deployed: ${dv === undefined ? '(absent)' : JSON.stringify(dv)}`);
  console.error(`    repo:     ${rv === undefined ? '(absent)' : JSON.stringify(rv)}`);
}
if (diffs.length > 25) console.error(`  … and ${diffs.length - 25} more.`);

console.error(
  [
    '',
    'Most likely someone edited the rules directly in the Firebase Console.',
    'That path is no longer a deploy — this repo is the source of truth.',
    '',
    'To resolve: decide which version is correct. If the Console edit should',
    'stand, bring it into firestore.rules via PR so the emulator suite runs',
    'against it. Otherwise re-run the deploy workflow to restore the repo copy.',
    '',
  ].join('\n'),
);
process.exit(1);
