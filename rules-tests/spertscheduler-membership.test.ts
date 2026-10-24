// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Firestore Security Rules — CI-2 (2026-10-24 security audit): who may appear
 * in `members` on `spertscheduler_projects`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Create used to check only that the creator was the owner, so a create could
 * also name another user, pushing the project onto their dashboard with no way
 * to leave it. Two rules close that:
 *   - create: `members.size() == 1`, which with `members[uid] == 'owner'` means
 *     exactly `{[uid]: 'owner'}`;
 *   - a separate `allow update` letting a non-owner member delete ONLY their own
 *     entry (Leave project). The client write is exactly
 *     `updateDoc(ref, {[`members.${uid}`]: deleteField()})`.
 * Neither is written with hasOnly(), so the register guard does not see them;
 * this file is their coverage.
 *
 * WHAT THIS SUITE PINS
 * --------------------
 * Differential pairs that differ in one respect:
 *   M1 (self only, allowed)      vs M2/M3 (self + another member, denied)
 *   L1 (editor leaves, allowed)  vs L4 (editor removes someone else, denied)
 *   L1                           vs L5 (leave + any other field, denied)
 *   L2 (viewer leaves, allowed)  vs L6 (viewer edits own role, denied)
 * plus L7 (a non-member cannot "leave") and E1, a control that an editor's
 * ordinary save still works beside the new rule.
 *
 * NOT pinned here: the owner deleting their own entry. The Leave statement never
 * grants it, but the owner update rule has always let the owner rewrite
 * `members`, so the rules allow it. Not offering "Leave" to the owner is the
 * app's job.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteField, doc, setDoc, updateDoc, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const ALICE = 'uid_alice'; // owner
const BOB = 'uid_bob'; // editor
const CAROL = 'uid_carol'; // viewer
const DAVE = 'uid_dave'; // not a member
const COL = 'spertscheduler_projects';
let testEnv: RulesTestEnvironment;

function as(uid: string): Firestore {
  return testEnv
    .authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true })
    .firestore() as unknown as Firestore;
}

/** Every key here is in spertSchedulerProjectFields(), so only `members` can decide. */
function projDoc(owner: string, members: Record<string, string>) {
  return { name: 'P', owner, members, schemaVersion: 25, createdAt: 1, updatedAt: 1, scenarios: [] };
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
      doc(ctx.firestore() as unknown as Firestore, COL, 'shared'),
      projDoc(ALICE, { [ALICE]: 'owner', [BOB]: 'editor', [CAROL]: 'viewer' }),
    );
  });
});

describe('CI-2 create: the creator may name only themselves', () => {
  it('M1 control: create with members {self: owner} is allowed', async () => {
    await assertSucceeds(setDoc(doc(as(ALICE), COL, 'n1'), projDoc(ALICE, { [ALICE]: 'owner' })));
  });

  it('M2 create also naming an editor is denied (differential vs M1)', async () => {
    await assertFails(
      setDoc(doc(as(ALICE), COL, 'n2'), projDoc(ALICE, { [ALICE]: 'owner', [BOB]: 'editor' })),
    );
  });

  it('M3 create also naming a viewer is denied', async () => {
    await assertFails(
      setDoc(doc(as(ALICE), COL, 'n3'), projDoc(ALICE, { [ALICE]: 'owner', [CAROL]: 'viewer' })),
    );
  });
});

describe('CI-2 Leave project: a member may delete only their own entry', () => {
  it('L1 an editor removes themselves, allowed', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), COL, 'shared'), { [`members.${BOB}`]: deleteField() }));
  });

  it('L2 a viewer removes themselves, allowed', async () => {
    await assertSucceeds(updateDoc(doc(as(CAROL), COL, 'shared'), { [`members.${CAROL}`]: deleteField() }));
  });

  it('L4 an editor removing someone else is denied (differential vs L1)', async () => {
    await assertFails(updateDoc(doc(as(BOB), COL, 'shared'), { [`members.${CAROL}`]: deleteField() }));
  });

  it('L5 a leave that also writes another field is denied (differential vs L1)', async () => {
    await assertFails(
      updateDoc(doc(as(BOB), COL, 'shared'), { [`members.${BOB}`]: deleteField(), updatedAt: 2 }),
    );
  });

  it('L6 a viewer changing their own role is denied (differential vs L2)', async () => {
    await assertFails(updateDoc(doc(as(CAROL), COL, 'shared'), { [`members.${CAROL}`]: 'editor' }));
  });

  it('L7 a non-member cannot "leave"', async () => {
    await assertFails(updateDoc(doc(as(DAVE), COL, 'shared'), { [`members.${DAVE}`]: deleteField() }));
  });

  it('E1 control: an editor saving scenarios still works beside the new rule', async () => {
    await assertSucceeds(updateDoc(doc(as(BOB), COL, 'shared'), { scenarios: [{ x: 1 }], updatedAt: 2 }));
  });
});
