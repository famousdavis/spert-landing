// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Firestore Security Rules — cross-tenant read guard for the seven per-app
 * `*_projects` collections.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every one of the seven collections shipped `allow list: if isAuth();`. The
 * comment above the CFD block stated the reasoning outright: "Intentionally
 * more permissive than other apps — list returns all docs, client-side where()
 * clause filters to member-of projects." That makes the CLIENT QUERY the
 * security boundary, which it cannot be: an attacker uses their own Firestore
 * client and simply omits the filter. Confirmed against production on
 * 2026-08-19 — an unfiltered REST list of `spertscheduler_projects` returned
 * HTTP 200 and included a document the caller was not a member of.
 *
 * WHAT THIS SUITE PINS
 * --------------------
 * For each collection, three things, and the pairing is the point:
 *
 *   1. ALLOWED  — the query the app ACTUALLY issues in production still works,
 *                 asserted down to the returned document ids.
 *   2. DENIED   — an unfiltered list of the whole collection.
 *   3. DENIED   — a list filtered to somebody ELSE's membership.
 *
 * (1) is not decoration. A rule tightened past the app's own query would make
 * every cloud user see zero projects, and a suite that only asserted (2) and
 * (3) would go green on exactly that outage. Equally, (1) asserts returned ids
 * rather than mere success, so a seeding failure cannot let it pass on an
 * empty result set.
 *
 * The production queries encoded in APPS below were read out of each app's
 * driver, not assumed. Six of seven use one identical constrained query; only
 * Forecaster differs, because its `owner` field is deliberately NOT mirrored
 * into the members map.
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
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  type Firestore,
  type QueryConstraint,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ALICE = 'uid_alice';
const BOB = 'uid_bob';

type Doc = Record<string, unknown>;

interface AppSpec {
  /** Collection name in Firestore. */
  collection: string;
  /** The app whose driver this collection belongs to (for test names). */
  app: string;
  /**
   * The constraint sets the app's production code actually issues. Each entry
   * is one separate getDocs() call — Forecaster and MyScrumBudget issue more
   * than one and merge client-side.
   */
  productionQueries: (uid: string) => QueryConstraint[][];
  /** A project document owned outright by `uid`. */
  owned: (uid: string) => Doc;
  /** A project owned by `owner` on which `member` holds a non-owner role. */
  shared: (owner: string, member: string) => Doc;
}

/** The six apps that share the canonical members-map pattern. */
function membersMapApp(app: string, collectionName: string): AppSpec {
  return {
    app,
    collection: collectionName,
    productionQueries: (uid) => [
      [where(`members.${uid}`, 'in', ['owner', 'editor', 'viewer'])],
    ],
    owned: (uid) => ({ name: 'Owned', owner: uid, members: { [uid]: 'owner' } }),
    shared: (owner, member) => ({
      name: 'Shared',
      owner,
      members: { [owner]: 'owner', [member]: 'editor' },
    }),
  };
}

const APPS: AppSpec[] = [
  membersMapApp('GanttApp', 'ganttapp_projects'),
  membersMapApp('Story Map', 'spertstorymap_projects'),
  membersMapApp('Scheduler', 'spertscheduler_projects'),
  membersMapApp('CFD', 'spertcfd_projects'),
  membersMapApp('AHP', 'spertahp_projects'),
  {
    // MyScrumBudget uses the canonical query for loading, but its clear()
    // path (src/lib/storage/firestoreRepo.ts) lists by `owner` alone to
    // delete every owned project. Both must survive the tightened rule.
    ...membersMapApp('MyScrumBudget', 'myscrumbudget_projects'),
    productionQueries: (uid) => [
      [where(`members.${uid}`, 'in', ['owner', 'editor', 'viewer'])],
      [where('owner', '==', uid)],
    ],
  },
  {
    // Forecaster keeps `owner` OUT of the members map — members holds only
    // editors/viewers — and issues three separate queries it merges.
    app: 'Forecaster',
    collection: 'spertforecaster_projects',
    productionQueries: (uid) => [
      [where('owner', '==', uid)],
      [where(`members.${uid}`, '==', 'editor')],
      [where(`members.${uid}`, '==', 'viewer')],
    ],
    owned: (uid) => ({ name: 'Owned', owner: uid, members: {} }),
    shared: (owner, member) => ({
      name: 'Shared',
      owner,
      members: { [member]: 'editor' },
    }),
  },
];

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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (const spec of APPS) {
      await setDoc(doc(db, spec.collection, 'alice-owned'), spec.owned(ALICE));
      await setDoc(doc(db, spec.collection, 'alice-shared'), spec.shared(BOB, ALICE));
      await setDoc(doc(db, spec.collection, 'bob-owned'), spec.owned(BOB));
    }
  });
});

function aliceDb(): Firestore {
  return testEnv.authenticatedContext(ALICE).firestore() as unknown as Firestore;
}

/**
 * The harness must prove it is actually talking to a seeded emulator. Without
 * this, a seeding failure or a misconfigured host would leave every
 * "denied" assertion trivially true and every "allowed" assertion returning
 * an empty set — a fully green suite testing nothing.
 */
describe('harness self-check', () => {
  it('seeds three documents per collection, readable with rules disabled', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore() as unknown as Firestore;
      for (const spec of APPS) {
        const snap = await getDocs(collection(db, spec.collection));
        expect(snap.size, `${spec.collection} seed count`).toBe(3);
      }
    });
  });
});

describe.each(APPS)('$app — $collection', (spec) => {
  it("ALLOWED: the app's real production query returns exactly the caller's projects", async () => {
    const db = aliceDb();
    const found = new Set<string>();

    for (const constraints of spec.productionQueries(ALICE)) {
      const snap = await assertSucceeds(
        getDocs(query(collection(db, spec.collection), ...constraints)),
      );
      snap.forEach((d) => found.add(d.id));
    }

    // Asserted as ids, not as a bare "it resolved" — an empty result set from
    // a broken seed or an over-tight rule must fail here, loudly.
    expect([...found].sort()).toEqual(['alice-owned', 'alice-shared']);
    expect(found.has('bob-owned')).toBe(false);
  });

  it('DENIED: an unfiltered list of the whole collection', async () => {
    const db = aliceDb();
    await assertFails(getDocs(collection(db, spec.collection)));
  });

  it("DENIED: a list filtered to another user's membership", async () => {
    const db = aliceDb();
    await assertFails(
      getDocs(
        query(
          collection(db, spec.collection),
          where(`members.${BOB}`, 'in', ['owner', 'editor', 'viewer']),
        ),
      ),
    );
  });
});
