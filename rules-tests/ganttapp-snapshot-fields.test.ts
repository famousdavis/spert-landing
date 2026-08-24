// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Firestore Security Rules — GanttApp snapshot field allowlist.
 *
 * WHY THIS EXISTS
 * ---------------
 * `ganttAppSnapshotFields()` listed seven fields. GanttApp's
 * `snapshotToFirestore()` (src/shared/utils/firestore-converters.ts) writes an
 * eighth, `todayDateOverride`, whenever the user has set a status date. Both
 * `create` and `update` on the snapshots subcollection gate on `hasOnly()`
 * against that list, so from GanttApp v0.28.0 (2026-08-13) every snapshot save
 * by a cloud user with a status date set was rejected outright. GanttApp
 * catches nothing on that path and shows no toast, so the snapshot simply
 * never appeared — silently, every time, for as long as a status date was set.
 *
 * The prose comment above the allowlist already said this would happen: "If
 * the converters start writing a new field, add it here in the same PR or the
 * corresponding writes will start failing silently." A comment was the only
 * thing holding the contract, and it did not hold. This file replaces it with
 * a check.
 *
 * WHAT THIS SUITE PINS
 * --------------------
 * Both directions, and the pairing is the point:
 *
 *   ALLOWED — the MAXIMAL document `snapshotToFirestore()` can emit, every
 *             conditional spread present, is accepted on create; and an update
 *             whose affected keys include `todayDateOverride` is accepted too.
 *             `create` and `update` are separate rules reached by separate
 *             code paths (`keys()` vs `diff().affectedKeys()`) and both were
 *             rejecting, so both are asserted.
 *   DENIED  — an unrecognised field is still refused, on create and on update.
 *             The fix widened the list; it must not have removed it.
 *   DENIED  — a non-member is still refused entirely. The fix must not have
 *             widened ACCESS while widening the field list.
 *
 * Asserting only the denials is what allowed this bug to ship: the rules were
 * checked for what they should block and never for what they must allow. A
 * suite written that way goes green against a rule that blocks everyone —
 * which is exactly the outage being fixed here.
 *
 * The allowed-create case also reads the document back with rules disabled and
 * asserts `todayDateOverride` actually persisted, so a write that "succeeded"
 * while dropping the field cannot pass.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ALICE = 'uid_alice';
const BOB = 'uid_bob';

/** Owned by ALICE. BOB's exists so ALICE can be tested as a non-member. */
const ALICE_PROJECT = 'alice-project';
const BOB_PROJECT = 'bob-project';

/** Seeded snapshot that the update cases mutate. */
const EXISTING = 'existing-snapshot';

type Doc = Record<string, unknown>;

/**
 * Every key `snapshotToFirestore()` can emit, read out of GanttApp's converter
 * rather than assumed. Five of the eight are conditional spreads, so this is
 * the MAXIMAL document the app writes — the one the allowlist must accept.
 *
 * The rules constrain top-level keys only, so the nested `releases` shape is
 * representative rather than exhaustive; it mirrors `releaseToFirestore()`.
 */
function fullSnapshot(): Doc {
  return {
    name: 'Sprint 12 baseline',
    timestamp: 1_755_600_000_000,
    releases: [
      {
        name: 'R1',
        startDate: '2026-08-01',
        earlyFinishDate: '2026-08-20',
        mostLikelyFinishDate: '2026-08-28',
        lateFinishDate: '2026-09-05',
        hidden: false,
        status: 'in-progress',
        order: 0,
      },
    ],
    projectFinishDate: '2026-09-30',
    chartColors: { early: '#0070f3', late: '#f75b2b' },
    legendLabels: { early: 'Early', late: 'Late' },
    preparedBy: 'William W. Davis, MSPM, PMP',
    todayDateOverride: '2026-08-20',
  };
}

/** The same document as it looked before the status-date feature shipped. */
function snapshotWithoutStatusDate(): Doc {
  const withoutStatusDate = fullSnapshot();
  delete withoutStatusDate.todayDateOverride;
  return withoutStatusDate;
}

let testEnv: RulesTestEnvironment;

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

/**
 * Snapshot rules gate on `canWriteGet(projectId)`, which `get()`s the PARENT
 * project document. Without a seeded parent every write is denied for the
 * wrong reason and the allowed cases prove nothing, so the parents are seeded
 * first, with rules disabled.
 */
beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'ganttapp_projects', ALICE_PROJECT), {
      name: 'Alice project',
      owner: ALICE,
      members: { [ALICE]: 'owner' },
    });
    await setDoc(doc(db, 'ganttapp_projects', BOB_PROJECT), {
      name: 'Bob project',
      owner: BOB,
      members: { [BOB]: 'owner' },
    });
    for (const projectId of [ALICE_PROJECT, BOB_PROJECT]) {
      await setDoc(
        doc(db, 'ganttapp_projects', projectId, 'snapshots', EXISTING),
        snapshotWithoutStatusDate(),
      );
    }
  });
});

function aliceDb(): Firestore {
  return testEnv.authenticatedContext(ALICE).firestore() as unknown as Firestore;
}

function snapshotRef(db: Firestore, projectId: string, snapshotId: string) {
  return doc(db, 'ganttapp_projects', projectId, 'snapshots', snapshotId);
}

/**
 * The harness must prove it is talking to a seeded emulator. Without this, a
 * seeding failure would leave every denial trivially true, and the update
 * cases would not be adding `todayDateOverride` to anything.
 */
describe('harness self-check', () => {
  it('seeds both parent projects and a snapshot that lacks the status date', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      for (const projectId of [ALICE_PROJECT, BOB_PROJECT]) {
        const parent = await getDoc(doc(db, 'ganttapp_projects', projectId));
        expect(parent.exists(), `${projectId} parent seeded`).toBe(true);

        const snap = await getDoc(snapshotRef(db, projectId, EXISTING));
        expect(snap.exists(), `${projectId} snapshot seeded`).toBe(true);
        // If this were already present, the update cases below would be
        // asserting nothing.
        expect(snap.data()?.todayDateOverride).toBeUndefined();
      }
    });
  });
});

describe('ganttapp_projects/{id}/snapshots — field allowlist', () => {
  it('ALLOWED: create carrying every field snapshotToFirestore() writes, todayDateOverride included', async () => {
    const db = aliceDb();
    await assertSucceeds(
      setDoc(snapshotRef(db, ALICE_PROJECT, 'new-snapshot'), fullSnapshot()),
    );

    // Asserted as stored content, not as a bare "it resolved" — a write that
    // succeeded while dropping the field must fail here.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      const stored = await getDoc(snapshotRef(admin, ALICE_PROJECT, 'new-snapshot'));
      expect(stored.exists()).toBe(true);
      expect(stored.data()?.todayDateOverride).toBe('2026-08-20');
    });
  });

  it('DENIED: create carrying an unrecognised field', async () => {
    const db = aliceDb();
    await assertFails(
      setDoc(snapshotRef(db, ALICE_PROJECT, 'bogus-snapshot'), {
        ...fullSnapshot(),
        bogusField: 'not on the allowlist',
      }),
    );
  });

  it('ALLOWED: update whose affected keys include todayDateOverride', async () => {
    const db = aliceDb();
    // `update` is a different rule from `create`, reached via
    // diff().affectedKeys() rather than keys(). Both were rejecting.
    await assertSucceeds(
      updateDoc(snapshotRef(db, ALICE_PROJECT, EXISTING), {
        todayDateOverride: '2026-08-21',
        timestamp: 1_755_700_000_000,
      }),
    );

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      const stored = await getDoc(snapshotRef(admin, ALICE_PROJECT, EXISTING));
      expect(stored.data()?.todayDateOverride).toBe('2026-08-21');
    });
  });

  it('DENIED: update carrying an unrecognised field', async () => {
    const db = aliceDb();
    await assertFails(
      updateDoc(snapshotRef(db, ALICE_PROJECT, EXISTING), {
        todayDateOverride: '2026-08-21',
        bogusField: 'not on the allowlist',
      }),
    );
  });
});

/**
 * The same two denials, carried as FIELD TRANSFORMS rather than plain values.
 *
 * WHAT THESE ARE FOR, SO NOBODY DELETES THEM LOOKING FOR A REASON
 * ---------------------------------------------------------------
 * They add no engine information. `allowlist-coverage.test.ts` already pins
 * transform visibility across both predicate families and all three transform
 * classes, and this site gates `keys()` on create (firestore.rules:317) and
 * `diff().affectedKeys()` on update (:319) — both families, both already
 * covered there.
 *
 * Their value is COMPLETENESS, not coverage. `ALLOWLIST_CONTRACTS` holds
 * thirteen entries and the ruleset has fourteen `hasOnly()` allowlist sites;
 * this one keeps its own suite, so without these two cases it would be the
 * only allowlist site in the ruleset with no transform case anywhere. That is
 * a good reason to have them. It is just not the same reason as the other six.
 *
 * It is also the site that silently rejected every snapshot save for seven
 * days, which is why its coverage is kept whole rather than nearly whole.
 */
describe('ganttapp_projects/{id}/snapshots — unrecognised field as a transform', () => {
  it('DENIED: create carrying an unrecognised field as an arrayUnion', async () => {
    const db = aliceDb();
    await assertFails(
      setDoc(snapshotRef(db, ALICE_PROJECT, 'bogus-transform-snapshot'), {
        ...fullSnapshot(),
        bogusField: arrayUnion('not on the allowlist'),
      }),
    );
  });

  it('DENIED: update carrying an unrecognised field as an arrayUnion', async () => {
    const db = aliceDb();
    await assertFails(
      updateDoc(snapshotRef(db, ALICE_PROJECT, EXISTING), {
        todayDateOverride: '2026-08-21',
        bogusField: arrayUnion('not on the allowlist'),
      }),
    );
  });
});

describe('ganttapp_projects/{id}/snapshots — access is unchanged', () => {
  it('DENIED: a non-member creating a snapshot, however well-formed', async () => {
    const db = aliceDb();
    await assertFails(
      setDoc(snapshotRef(db, BOB_PROJECT, 'new-snapshot'), fullSnapshot()),
    );
  });

  it('DENIED: a non-member updating a snapshot', async () => {
    const db = aliceDb();
    await assertFails(
      updateDoc(snapshotRef(db, BOB_PROJECT, EXISTING), {
        todayDateOverride: '2026-08-21',
      }),
    );
  });
});
