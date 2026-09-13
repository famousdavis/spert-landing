// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Firestore Security Rules — MyScrumBudget provenance fields are owner-only.
 *
 * WHY THIS EXISTS
 * ---------------
 * `myscrumbudget_projects` allowlists sixteen fields on update, and its
 * escalation guard reserved exactly two of them — `owner` and `members` — to
 * the document's owner. Four more are provenance rather than content, and were
 * writable by any `editor` on a project owned by somebody else:
 *
 *   _originRef      workspace reconciliation token
 *   _changeLog      export-pipeline diagnostics / cross-session provenance
 *   schemaVersion   settable to 0, making the document read as pre-migration
 *   createdAt       creation timestamp
 *
 * `_changeLog` could be set to `[]` in one write, leaving no server-side record
 * that it happened. Measured against the live ruleset before this suite
 * existed: ALLOW on all four for a non-owner editor, across 14 editor seats on
 * 4 shared projects. PRE-EXISTING, not a regression.
 *
 * v2.5.38: `_costSnapshot` joins them, so the allowlist is SEVENTEEN fields and
 * the owner-only set is seven. The paragraph above is dated and describes the
 * four it was written about; it stays as written. The new member is the first
 * that is CONTENT rather than provenance — it carries the OWNER's labor rates,
 * holidays and discount rate so every collaborator prices the project the same
 * way, and an editor who could rewrite it would silently change the basis on
 * which somebody else's project is costed. The const below is still called
 * PROVENANCE_FIELDS because its `Record` typing is what compile-forces every
 * table in this file to cover a new member; read it as "the owner-only set".
 *
 * WHY PROTECTING THEM BREAKS NOTHING
 * ----------------------------------
 * Every write path in MyScrumBudget that reaches this collection was
 * enumerated (`src/lib/storage/firestoreRepo.ts`, plus `invitations.ts`):
 *
 *   saveProject        setDoc with mergeFields = SAVE_PROJECT_MERGE_SET, which
 *                      is nine fields and contains NONE of the five. This is
 *                      the ordinary save, and it is the only write path an
 *                      editor exercises against a shared project.
 *   createProject      full setDoc writing all five — but it also writes
 *                      `owner: uid` / `members: {uid: 'owner'}`, so on an
 *                      existing document owned by someone else the PREVIOUS
 *                      guard already denied it.
 *   importAll          full setDoc, likewise claims owner/members, likewise
 *                      already denied to a non-owner.
 *   reorderProjects    batch.update of `order` only — see the `order` cases at
 *                      the bottom of this file, which exist to keep it that way.
 *   removeCollaborator tx.update of `members.<uid>`, owner-gated in code and in
 *                      rules already.
 *
 * The app's own comment at `firestoreRepo.ts:115-122` states the same thing
 * from the other side: these fields are excluded from the merge set ON PURPOSE
 * so existing Firestore values survive a save.
 *
 * THE SHAPE OF THE FIX IS NOT NEW
 * -------------------------------
 * `spertahp_projects` already widens this identical construct to six fields
 * (`owner`, `members`, `resultsVisibility`, `synthesis`,
 * `publishedSynthesisId`, `collaborators`). This is that pattern, with
 * MyScrumBudget's field set.
 *
 * WHAT THIS SUITE PINS
 * --------------------
 *   DENIED  — an editor writing each of the five, one case per field, plus one
 *             smuggling a provenance field alongside a legitimate content
 *             write. The ORIGINAL five FAILED against the unmodified ruleset;
 *             that is what makes them evidence rather than decoration. The
 *             `_costSnapshot` case is new in v2.5.38 and was held to the same
 *             standard, MEASURED rather than asserted: neutralising its entry
 *             in the owner-only `hasAny([...])` set (line count preserved, so
 *             the pins stayed valid) failed EXACTLY this one case — 1 failed,
 *             172 passed, 20 skipped — and the ruleset was restored md5-identical.
 *   ALLOWED — the OWNER writing each of the five. The guard is about role, not
 *             about the values, and a fix that locked the fields outright would
 *             pass the denials while breaking migration and import.
 *   ALLOWED — an editor's ordinary content write (the nine merge-set fields).
 *             Asserting only denials is how a rule that blocks everyone goes
 *             green.
 *   ALLOWED — an editor's `order` write, and a reorder-shaped batch. DELIBERATE
 *             AND LOAD-BEARING: `order` is editor-writable and must stay that
 *             way. `reorderProjects` writes `{order}` to EVERY project on the
 *             user's dashboard in one atomic `writeBatch`, so adding `order` to
 *             the owner-only set would reject the whole batch for any editor
 *             who has a single shared project on their dashboard — they could
 *             no longer reorder their own dashboard at all, and that rejection
 *             is unhandled. `order` is a per-user preference stored on a shared
 *             document; fixing that needs a client or data-model change, not a
 *             rules change. These two cases exist so a later reader cannot
 *             quietly "complete" the fix and break dashboard reorder.
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
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ALICE = 'uid_alice';
const BOB = 'uid_bob';

/** Owned by ALICE, with BOB as a non-owner editor — the measured seat shape. */
const SHARED_PROJECT = 'alice-shared-project';
/** Owned by BOB. Present so the reorder batch spans a shared and an own doc. */
const BOB_PROJECT = 'bob-own-project';

/**
 * Seeded `order` values, chosen to differ from every value a case writes so no
 * `order` case can degenerate into an empty diff.
 */
const SEEDED_ORDER: Record<string, number> = {
  [SHARED_PROJECT]: 5,
  [BOB_PROJECT]: 7,
};

/**
 * The owner-only set. Four are provenance; `_costSnapshot` (v2.5.38) is CONTENT
 * and is here for a different reason — see the header. The name is kept because
 * every table below is `Record<(typeof PROVENANCE_FIELDS)[number], unknown>`, so
 * adding a member here is a COMPILE ERROR until each one covers it, and that
 * forcing is this file's best property.
 */
const PROVENANCE_FIELDS = [
  '_originRef',
  '_changeLog',
  'schemaVersion',
  'createdAt',
  '_costSnapshot',
] as const;

/**
 * What an editor attempts for each field. `_changeLog: []` and
 * `schemaVersion: 0` are the two measured abuses, kept verbatim rather than
 * softened into placeholders.
 */
const EDITOR_ATTEMPT: Record<(typeof PROVENANCE_FIELDS)[number], unknown> = {
  _originRef: BOB,
  _changeLog: [],
  schemaVersion: 0,
  createdAt: '2020-01-01T00:00:00.000Z',
  // The abuse this field invites: an editor repricing somebody else's project
  // by rewriting the owner's rate card underneath them.
  _costSnapshot: {
    laborRates: [{ role: 'BA', hourlyRate: 1 }],
    holidays: [],
    discountRateAnnual: 0.99,
  },
};

/** What the OWNER writes for the same field — a plausible legitimate move. */
const OWNER_WRITE: Record<(typeof PROVENANCE_FIELDS)[number], unknown> = {
  _originRef: 'workspace-reconciled',
  _changeLog: [{ t: 1_757_100_000, op: 'update', entity: 'project', source: 'user' }],
  schemaVersion: 3,
  // MUST differ from the seeded value, or the owner case asserts nothing. The
  // harness self-check below caught exactly that when these were equal.
  createdAt: '2026-02-01T09:30:00.000Z',
  // MUST differ from the seed below, same reason as createdAt above.
  _costSnapshot: {
    laborRates: [{ role: 'BA', hourlyRate: 95 }],
    holidays: [],
    discountRateAnnual: 0.07,
  },
};

/**
 * `SAVE_PROJECT_MERGE_SET` from
 * `MyScrumBudget/src/lib/storage/firestoreRepo.ts:124-133`, read from that
 * repository rather than restated from a brief. Nine fields, none of them
 * provenance. This is what an ordinary editor save writes, and it must keep
 * working.
 */
function ordinaryContentWrite(): Record<string, unknown> {
  return {
    name: 'Q3 delivery',
    startDate: '2026-07-01',
    endDate: '2026-09-30',
    reforecasts: [{ id: 'rf-1', label: 'Baseline' }],
    activeReforecastId: 'rf-1',
    color: '#16a34a',
    archived: null,
    _teamSnapshot: { members: [] },
    updatedAt: '2026-09-12T12:00:00.000Z',
  };
}

/**
 * The seeded document, before any case touches it.
 *
 * `order` is seeded to a value NO case writes. Seeded at 0 it silently broke
 * the reorder-batch case below: `batch.update({order: 0})` over a stored 0 is
 * an EMPTY diff, `affectedKeys()` is empty, and the guard is never reached — so
 * that case passed even with `order` wrongly added to the owner-only set. Found
 * by mutating the rule; the self-check below now pins it.
 */
function seededProject(owner: string, members: Record<string, string>, order: number) {
  return {
    ...ordinaryContentWrite(),
    owner,
    members,
    order,
    _originRef: ALICE,
    _changeLog: [{ t: 1_757_000_000, op: 'create', entity: 'project', source: 'user' }],
    schemaVersion: 2,
    createdAt: '2026-01-15T10:00:00.000Z',
    // Differs from OWNER_WRITE._costSnapshot on every field, so the owner case
    // cannot degenerate into an empty diff.
    _costSnapshot: {
      laborRates: [{ role: 'BA', hourlyRate: 75 }],
      holidays: [],
      discountRateAnnual: 0.05,
    },
  };
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

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(
      doc(db, 'myscrumbudget_projects', SHARED_PROJECT),
      seededProject(ALICE, { [ALICE]: 'owner', [BOB]: 'editor' }, SEEDED_ORDER[SHARED_PROJECT]),
    );
    await setDoc(
      doc(db, 'myscrumbudget_projects', BOB_PROJECT),
      seededProject(BOB, { [BOB]: 'owner' }, SEEDED_ORDER[BOB_PROJECT]),
    );
  });
});

function dbAs(uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}

function projectRef(db: Firestore, projectId: string) {
  return doc(db, 'myscrumbudget_projects', projectId);
}

async function storedField(projectId: string, field: string): Promise<unknown> {
  let value: unknown;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore() as unknown as Firestore;
    const snap = await getDoc(projectRef(admin, projectId));
    value = snap.data()?.[field];
  });
  return value;
}

/**
 * Without this, a seeding failure would make every denial below trivially true
 * and every "the value did not change" assertion vacuous.
 */
describe('harness self-check', () => {
  it('seeds a shared project where BOB is an editor and is NOT the owner', async () => {
    const members = (await storedField(SHARED_PROJECT, 'members')) as Record<string, string>;
    expect(members[BOB], 'BOB is an editor').toBe('editor');
    expect(members[ALICE], 'ALICE is the owner').toBe('owner');
    expect(await storedField(SHARED_PROJECT, 'owner')).toBe(ALICE);
  });

  it('seeds all five owner-only fields, each differing from what the cases write', async () => {
    for (const field of PROVENANCE_FIELDS) {
      const pre = await storedField(SHARED_PROJECT, field);
      expect(pre, `${field} seeded`).toBeDefined();
      // If a case already matched the pre-image it would assert nothing.
      expect(JSON.stringify(pre), `${field} differs from the editor attempt`)
        .not.toBe(JSON.stringify(EDITOR_ATTEMPT[field]));
      expect(JSON.stringify(pre), `${field} differs from the owner write`)
        .not.toBe(JSON.stringify(OWNER_WRITE[field]));
    }
  });

  it('seeds `order` to a value every order case actually changes', async () => {
    // The reorder batch writes index 0 and 1. If either project were seeded at
    // the index it receives, that write would be an empty diff, the guard would
    // never be reached, and the case would pass even against a rule that gates
    // `order` — measured, not hypothetical.
    const written = [0, 1];
    for (const [projectId, seeded] of Object.entries(SEEDED_ORDER)) {
      expect(await storedField(projectId, 'order'), `${projectId} order seeded`).toBe(seeded);
      expect(written, `${projectId} order seed is not a value a case writes`)
        .not.toContain(seeded);
    }
    // The single-field `order` case writes 3.
    expect(SEEDED_ORDER[SHARED_PROJECT]).not.toBe(3);
  });

  it('positive control: an editor CAN update this document at all', async () => {
    // If this ever reds, the denials below stop being evidence about
    // provenance fields and become evidence that BOB cannot write anything.
    await assertSucceeds(
      updateDoc(projectRef(dbAs(BOB), SHARED_PROJECT), { name: 'renamed by editor' }),
    );
  });
});

describe('myscrumbudget_projects — provenance fields are owner-only', () => {
  for (const field of PROVENANCE_FIELDS) {
    it(`DENIED: a non-owner editor cannot rewrite ${field}`, async () => {
      await assertFails(
        updateDoc(projectRef(dbAs(BOB), SHARED_PROJECT), {
          [field]: EDITOR_ATTEMPT[field],
        }),
      );
      // The denial must also have left the stored value alone.
      expect(JSON.stringify(await storedField(SHARED_PROJECT, field)))
        .not.toBe(JSON.stringify(EDITOR_ATTEMPT[field]));
    });
  }

  it('DENIED: an editor cannot smuggle _changeLog alongside a legitimate content write', async () => {
    // The guard is hasAny() on the diff, so a provenance field rides along with
    // a permitted field at most once.
    await assertFails(
      updateDoc(projectRef(dbAs(BOB), SHARED_PROJECT), {
        name: 'legitimate rename',
        updatedAt: '2026-09-12T13:00:00.000Z',
        _changeLog: [],
      }),
    );
    expect(await storedField(SHARED_PROJECT, 'name')).toBe('Q3 delivery');
  });

  for (const field of PROVENANCE_FIELDS) {
    it(`ALLOWED: the owner can still write ${field}`, async () => {
      await assertSucceeds(
        updateDoc(projectRef(dbAs(ALICE), SHARED_PROJECT), {
          [field]: OWNER_WRITE[field],
        }),
      );
      // Asserted as stored content: a write that "succeeded" while dropping
      // the field must fail here.
      expect(JSON.stringify(await storedField(SHARED_PROJECT, field)))
        .toBe(JSON.stringify(OWNER_WRITE[field]));
    });
  }

  it('ALLOWED: an editor can still write all five on a project they own', async () => {
    // The gate is role-on-this-document, not a property of the field names.
    const everything = Object.fromEntries(
      PROVENANCE_FIELDS.map((f) => [f, OWNER_WRITE[f]]),
    );
    await assertSucceeds(updateDoc(projectRef(dbAs(BOB), BOB_PROJECT), everything));
  });
});

describe('myscrumbudget_projects — negative controls, the fix must not overreach', () => {
  it("ALLOWED: an editor's ordinary content write (the nine merge-set fields)", async () => {
    const content = { ...ordinaryContentWrite(), name: 'Q4 delivery' };
    await assertSucceeds(
      setDoc(projectRef(dbAs(BOB), SHARED_PROJECT), content, {
        mergeFields: Object.keys(content),
      }),
    );
    expect(await storedField(SHARED_PROJECT, 'name')).toBe('Q4 delivery');
  });

  it("ALLOWED: an editor's `order` write — `order` is OUT OF SCOPE on purpose", async () => {
    await assertSucceeds(
      updateDoc(projectRef(dbAs(BOB), SHARED_PROJECT), { order: 3 }),
    );
    expect(await storedField(SHARED_PROJECT, 'order')).toBe(3);
  });

  it("ALLOWED: reorderProjects' atomic batch spanning a shared and an owned project", async () => {
    // The exact shape of firestoreRepo.ts reorderProjects: `{order: index}` to
    // every project on the dashboard in ONE writeBatch. If `order` were ever
    // added to the owner-only set, this whole batch would be rejected and the
    // editor could not reorder their own dashboard.
    const db = dbAs(BOB);
    const batch = writeBatch(db);
    [SHARED_PROJECT, BOB_PROJECT].forEach((id, index) => {
      batch.update(projectRef(db, id), { order: index });
    });
    await assertSucceeds(batch.commit());
    expect(await storedField(SHARED_PROJECT, 'order')).toBe(0);
    expect(await storedField(BOB_PROJECT, 'order')).toBe(1);
  });

  it('DENIED: an editor still cannot change owner or members (the pre-existing guard)', async () => {
    await assertFails(
      updateDoc(projectRef(dbAs(BOB), SHARED_PROJECT), { owner: BOB }),
    );
    await assertFails(
      updateDoc(projectRef(dbAs(BOB), SHARED_PROJECT), {
        [`members.${BOB}`]: 'owner',
      }),
    );
  });

  it('DENIED: an unrecognised field is still refused (the allowlist still holds)', async () => {
    await assertFails(
      updateDoc(projectRef(dbAs(ALICE), SHARED_PROJECT), { bogusField: 'nope' }),
    );
  });
});
