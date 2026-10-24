// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Firestore Security Rules — CI-1 (2026-10-24 security audit): the
 * `schemaVersion` bound on `spertscheduler_projects`.
 *
 * WHY THIS EXISTS
 * ---------------
 * SPERT Scheduler opens a cloud project by migrating it from its stored
 * `schemaVersion` up to the app's own, one version at a time. A shared-project
 * editor could store a value that loop never finishes from (e.g. -1e20, where
 * `v++` no longer changes the number), freezing every member's browser on that
 * project. The rule requires `schemaVersion is int && >= 1` on create and on
 * update, so a write can neither introduce nor rewrite such a value.
 *
 * allowlist-coverage.test.ts cannot catch this: it checks WHICH fields a write
 * may touch, not what type they hold. Hence this file.
 *
 * WHAT THIS SUITE PINS
 * --------------------
 * Pairs that differ only in `schemaVersion`, so a rule that denied everything
 * (or allowed everything) fails at least one side of each pair:
 *   SV1 (allowed, 25) vs SV2 (denied, -1e20)          — create
 *   SV5b (editor, allowed) vs SV6 (editor, denied)    — update
 * plus SV3 (1.5) and SV4 (0) for the two halves of the predicate, and SV5 for
 * an owner update that leaves `schemaVersion` untouched.
 *
 * Every live document measured on 2026-10-24 (17 of 17) already stores an
 * integer between 19 and 24, and the client stamps the integer constant
 * SCHEMA_VERSION on every create and save, so the rule denies no legitimate
 * write. Cases contributed by the SPERT Scheduler security-audit session.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const ALICE = 'uid_alice';
const BOB = 'uid_bob';
const COL = 'spertscheduler_projects';
let testEnv: RulesTestEnvironment;

function as(uid: string): Firestore {
  return testEnv
    .authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true })
    .firestore() as unknown as Firestore;
}

/** Every key here is in spertSchedulerProjectFields(), so only schemaVersion can decide. */
function projDoc(owner: string, members: Record<string, string>, schemaVersion: unknown) {
  return { name: 'P', owner, members, schemaVersion, createdAt: 1, updatedAt: 1, scenarios: [] };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'spert-suite',
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8'),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore() as unknown as Firestore, COL, 'proj1'),
      projDoc(ALICE, { [ALICE]: 'owner', [BOB]: 'editor' }, 25),
    );
  });
});

describe('CI-1 spertscheduler_projects schemaVersion bound', () => {
  it('SV1 control: valid create at schemaVersion 25 is allowed', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), COL, 'n1'), projDoc(ALICE, { [ALICE]: 'owner' }, 25)));
  });

  it('SV2 create at -1e20 is denied (differential vs SV1)', async () => {
    await assertFails(setDoc(doc(as(ALICE), COL, 'n2'), projDoc(ALICE, { [ALICE]: 'owner' }, -1e20)));
  });

  it('SV3 create at 1.5 is denied (not an integer)', async () => {
    await assertFails(setDoc(doc(as(ALICE), COL, 'n3'), projDoc(ALICE, { [ALICE]: 'owner' }, 1.5)));
  });

  it('SV4 create at 0 is denied (below 1)', async () => {
    await assertFails(setDoc(doc(as(ALICE), COL, 'n4'), projDoc(ALICE, { [ALICE]: 'owner' }, 0)));
  });

  it('SV5 control: owner renames, schemaVersion untouched, allowed', async () => {
    await assertSucceeds(updateDoc(doc(as(ALICE), COL, 'proj1'), { name: 'renamed' }));
  });

  it('SV5b control: editor updates scenarios only, allowed', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), COL, 'proj1'), { scenarios: [{ x: 1 }] }));
  });

  it('SV6 editor rewriting schemaVersion to -1e20 is denied (differential vs SV5b)', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), COL, 'proj1'), { scenarios: [{ x: 1 }], schemaVersion: -1e20 }),
    );
  });
});
