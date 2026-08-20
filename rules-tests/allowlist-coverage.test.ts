// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Firestore Security Rules - coverage for every `hasOnly()` field allowlist.
 *
 * WHY THIS EXISTS
 * ---------------
 * The ruleset has twelve allowlist sites. Until 2.5.16, one was tested. The
 * untested eleven each guard a routine save: tighten one past what its app
 * writes and that app starts failing with `PERMISSION_DENIED`, silently, with
 * nothing in this suite going red. `ganttapp-snapshot-fields.test.ts` exists
 * because exactly that happened to the twelfth for seven days.
 *
 * The field sets live in `./allowlist-contracts` as data, so a later brief can
 * compare them against the apps' real converters without importing this file
 * or standing up an emulator. Every case below derives from that structure;
 * nothing here restates a field list.
 *
 * THE FOUR SHAPES
 * ---------------
 *   1. ALLOWED - maximal allowlisted document. Every field the `hasOnly()`
 *      permits. Catches an allowlist entry contradicted by another clause in
 *      the same rule.
 *   2. ALLOWED - app minimal. Every conditional field absent. Catches a rule
 *      that OVER-REQUIRES a field the app only sometimes emits.
 *      `releaseToFirestore` has three conditional spreads and the
 *      `anonymous_sessions` create rule carries a `hasAll()` alongside its
 *      `hasOnly()`, so this is not hypothetical.
 *   3. DENIED - one unrecognised key, on every operation the site guards.
 *      Create and update are separate rules; the 2.5.15 defect existed on both.
 *   4. ALLOWED - app maximal, ONLY where `coincides: false`. Where the
 *      allowlist is broader than the app's real write, that gap is the surface
 *      a future app field lands in and deserves its own case. Where the two
 *      sets are equal this case would be shape 1 re-run against an identical
 *      document, so it is skipped by name rather than silently.
 *
 * Plus, per site: a non-member (or wrong-user) is refused. Widening a field
 * list must never widen access.
 *
 * THE OWNER/EDITOR TRAP
 * ---------------------
 * Every project allowlist contains `owner` and `members`, and every project
 * update rule carries a field-protection guard (firestore.rules:295-298)
 * restricting those two keys to owners. A maximal `affectedKeys()` write
 * therefore TOUCHES them, so it must run as owner - run as an editor it fails
 * on the escalation guard rather than the allowlist, which is a red that means
 * nothing, or a green after someone "fixes" it by trimming the document.
 * Shape 1's update runs as owner, and the editor's refusal is pinned as its
 * own assertion so the guard itself is covered rather than merely dodged.
 *
 * ASSERTING ALLOWED AS HARD AS DENIED
 * -----------------------------------
 * A suite that asserts only denials goes green against a rule that blocks
 * everyone - which is the outage 2.5.15 fixed. Every maximal case here reads
 * the document back with rules disabled and asserts each field actually
 * persisted, so a write that "succeeded" while dropping a field cannot pass.
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
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ALLOWLIST_CONTRACTS,
  sameSet,
  type AllowlistContract,
} from './allowlist-contracts';

const ALICE = 'uid_alice';
const BOB = 'uid_bob';
const CAROL = 'uid_carol';
/** Appears only as a second entry in a maximal `members` map. */
const EXTRA = 'uid_extra';

/** Owner of every seeded fixture. BOB is an editor; CAROL is in nothing. */
const PROJECT_ID = 'alice-project';
/** The pre-existing document that update cases mutate. */
const EXISTING = 'existing-doc';
/** A fresh id for create cases. */
const FRESH = 'fresh-doc';

type Doc = Record<string, unknown>;

/**
 * Fields whose VALUE the rules constrain, as opposed to merely their presence.
 * Everything else may be any type - `hasOnly()` and `affectedKeys()` look at
 * keys only - so the default below is a readable string.
 *
 *   lastSeq       pinned `== 0` on anonymous_sessions create
 *   consentWrite  `is bool` on create
 *   consentRead   `is bool` on create and on update
 */
const TYPED_VALUES: Record<string, { target: unknown; seed: unknown }> = {
  lastSeq: { target: 0, seed: 0 },
  consentWrite: { target: true, seed: true },
  consentRead: { target: true, seed: false },
};

/**
 * The value a field carries in the document under test.
 *
 * `owner` and `members` are special because the rules read them. The target
 * `members` map carries a second entry so that a maximal update genuinely
 * CHANGES the map - `diff().affectedKeys()` reports only keys whose value
 * differs, so seeding and writing an identical map would drop `members` out of
 * the affected set and quietly make the case vacuous.
 */
function targetValue(field: string, uid: string): unknown {
  if (field === 'owner') return uid;
  if (field === 'members') return { [uid]: 'owner', [EXTRA]: 'viewer' };
  return TYPED_VALUES[field]?.target ?? `value-${field}`;
}

/**
 * The value a field carries in the SEEDED pre-image. Deliberately different
 * from `targetValue` for every field, so an update touching that field always
 * registers in `affectedKeys()`.
 *
 * `members` is the exception that proves the rule: the seed must still grant
 * the acting uid its role, because the update rule reads `resource.data`
 * (the pre-image) to decide whether the caller may write at all.
 */
function seedValue(field: string, uid: string): unknown {
  if (field === 'owner') return 'uid_previous_owner';
  if (field === 'members') return { [uid]: 'owner', [BOB]: 'editor' };
  return TYPED_VALUES[field]?.seed ?? `seed-${field}`;
}

function buildDoc(fields: string[], uid: string): Doc {
  return Object.fromEntries(fields.map((f) => [f, targetValue(f, uid)]));
}

function buildSeed(fields: string[], uid: string): Doc {
  return Object.fromEntries(fields.map((f) => [f, seedValue(f, uid)]));
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

function db(uid: string | null): Firestore {
  const ctx = uid === null
    ? testEnv.unauthenticatedContext()
    : testEnv.authenticatedContext(uid);
  return ctx.firestore() as unknown as Firestore;
}

/** Path to the document a case acts on, honouring the subcollection shape. */
function refFor(client: Firestore, c: AllowlistContract, docId: string): DocumentReference {
  return c.sub === null
    ? doc(client, c.collection, docId)
    : doc(client, c.collection, PROJECT_ID, c.sub, docId);
}

/** Who acts on this site. Anonymous sites are unauthenticated by design. */
function actor(c: AllowlistContract): string | null {
  return c.shape === 'anonymous' ? null : ALICE;
}

/** The uid a `selfOwned` document is keyed by; irrelevant elsewhere. */
function docIdFor(c: AllowlistContract, base: string): string {
  return c.shape === 'selfOwned' ? ALICE : base;
}

/**
 * Seed whatever a site's rule reads before it can decide.
 *
 * Subcollection sites gate on `canWriteGet(projectId)`, which `get()`s the
 * PARENT project document - without it every write is denied for the wrong
 * reason and the allowed cases prove nothing. Update cases additionally need
 * the target document to exist, with values distinct from the ones the case
 * will write.
 */
async function seedFor(c: AllowlistContract): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore() as unknown as Firestore;

    if (c.sub !== null) {
      await setDoc(doc(admin, c.collection, PROJECT_ID), {
        name: 'Alice project',
        owner: ALICE,
        members: { [ALICE]: 'owner', [BOB]: 'editor' },
      });
    }

    // The pre-image for update cases: every allowlisted field present, each
    // holding a value the cases will change.
    await setDoc(refFor(admin, c, docIdFor(c, EXISTING)), buildSeed(c.allowlist, ALICE));
  });
}

beforeEach(async () => {
  await testEnv.clearFirestore();
});

/** Read a document back with rules disabled and assert every field landed. */
async function expectPersisted(
  c: AllowlistContract,
  docId: string,
  fields: string[],
  uid: string,
): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const admin = ctx.firestore() as unknown as Firestore;
    const stored = await getDoc(refFor(admin, c, docId));
    expect(stored.exists(), `${c.key}/${docId} exists after write`).toBe(true);
    for (const field of fields) {
      expect(stored.data()?.[field], `${c.key}.${field} persisted`).toStrictEqual(
        targetValue(field, uid),
      );
    }
  });
}

/**
 * Perform one write against a site, as `uid`, carrying exactly `fields`.
 *
 * `create` and `write` use setDoc (a full document, which is what every app
 * driver here emits); `update` uses updateDoc so the rule is reached through
 * `diff().affectedKeys()` rather than `keys()`. They are separate rules and
 * the 2.5.15 defect existed on both, so they are never substituted for one
 * another.
 */
function write(
  c: AllowlistContract,
  op: 'create' | 'update' | 'write',
  fields: string[],
  uid: string | null,
  extra: Doc = {},
): Promise<void> {
  const client = db(uid);
  const payload = { ...buildDoc(fields, uid ?? ALICE), ...extra };
  if (op === 'update') {
    return updateDoc(refFor(client, c, docIdFor(c, EXISTING)), payload);
  }
  return setDoc(refFor(client, c, docIdFor(c, FRESH)), payload);
}

/** Ops that write a whole document (`create`, and `write` which subsumes it). */
function isFullDocOp(op: string): op is 'create' | 'write' {
  return op === 'create' || op === 'write';
}

describe('allowlist contracts - self-check', () => {
  it('covers eleven sites, leaving the snapshot site to its own suite', () => {
    expect(ALLOWLIST_CONTRACTS).toHaveLength(11);
    expect(ALLOWLIST_CONTRACTS.map((c) => c.key)).not.toContain('ganttapp_snapshots');
  });

  it('declares coincides consistently with appMax and allowlist', () => {
    for (const c of ALLOWLIST_CONTRACTS) {
      expect(c.coincides, `${c.key}.coincides`).toBe(sameSet(c.allowlist, c.appMax));
    }
  });

  it('keeps appMax and appMin within the allowlist', () => {
    for (const c of ALLOWLIST_CONTRACTS) {
      const permitted = new Set(c.allowlist);
      // An app field outside its own allowlist is a LIVE defect of the 2.5.15
      // class, not a test-data mistake. This is where it would surface.
      expect(c.appMax.filter((f) => !permitted.has(f)), `${c.key}.appMax`).toEqual([]);
      expect(c.appMin.filter((f) => !permitted.has(f)), `${c.key}.appMin`).toEqual([]);
      expect(c.appMin.filter((f) => !c.appMax.includes(f)), `${c.key}.appMin in appMax`)
        .toEqual([]);
    }
  });

  it('records one rule line per guarded operation, and full provenance', () => {
    for (const c of ALLOWLIST_CONTRACTS) {
      expect(c.lines, `${c.key}.lines`).toHaveLength(c.ops.length);
      expect(c.ops.length, `${c.key}.ops`).toBeGreaterThan(0);
      expect(c.source, `${c.key}.source`).toBeTruthy();
      expect(c.sourceVersion, `${c.key}.sourceVersion`).toBeTruthy();
      expect(c.sourceCommit, `${c.key}.sourceCommit`).toBeTruthy();
    }
  });

  it('cites line numbers that still hold a hasOnly() in firestore.rules', () => {
    const lines = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8').split('\n');
    for (const c of ALLOWLIST_CONTRACTS) {
      for (const line of c.lines) {
        // Line numbers drift. A citation that has slid off its rule is worse
        // than none, because it reads as verified.
        expect(lines[line - 1], `${c.key} line ${line}`).toContain('hasOnly(');
      }
    }
  });
});

describe.each(ALLOWLIST_CONTRACTS)('$key ($path)', (c) => {
  const uid = actor(c);
  const guardsIdentity = c.allowlist.includes('owner') || c.allowlist.includes('members');

  beforeEach(async () => {
    await seedFor(c);
  });

  it('harness self-check: the pre-image exists and differs from what cases write', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      const seeded = await getDoc(refFor(admin, c, docIdFor(c, EXISTING)));
      expect(seeded.exists(), `${c.key} pre-image seeded`).toBe(true);
      // If the seed already equalled the target, every update case would have
      // an empty affectedKeys() set and would assert nothing at all.
      const scalar = c.allowlist.find((f) => f !== 'owner' && f !== 'members' && !TYPED_VALUES[f]);
      if (scalar !== undefined) {
        expect(seeded.data()?.[scalar]).not.toStrictEqual(targetValue(scalar, uid ?? ALICE));
      }
    });
  });

  for (const [index, op] of c.ops.entries()) {
    const at = `${op} (firestore.rules:${c.lines[index]})`;

    it(`ALLOWED shape 1 - maximal allowlisted document, ${at}`, async () => {
      await assertSucceeds(write(c, op, c.allowlist, uid));
      await expectPersisted(
        c,
        docIdFor(c, isFullDocOp(op) ? FRESH : EXISTING),
        c.allowlist,
        uid ?? ALICE,
      );
    });

    it(`ALLOWED shape 2 - app minimal (${c.appMin.length}/${c.allowlist.length} fields), ${at}`, async () => {
      await assertSucceeds(write(c, op, c.appMin, uid));
      await expectPersisted(
        c,
        docIdFor(c, isFullDocOp(op) ? FRESH : EXISTING),
        c.appMin,
        uid ?? ALICE,
      );
    });

    it(`DENIED shape 3 - one unrecognised key, ${at}`, async () => {
      await assertFails(
        write(c, op, c.allowlist, uid, { bogusField: 'not on the allowlist' }),
      );
    });

    if (c.coincides) {
      it.skip(`shape 4 - app maximal, ${at} (skipped: coincides=true, identical to shape 1)`, () => {
        // Intentionally skipped, not missing. `appMax` equals `allowlist` for
        // this site, so shape 4 would re-run shape 1 against a byte-identical
        // document. Recorded by name so the omission is legible in the report.
      });
    } else {
      it(`ALLOWED shape 4 - app maximal (${c.appMax.length}/${c.allowlist.length} fields), ${at}`, async () => {
        await assertSucceeds(write(c, op, c.appMax, uid));
        await expectPersisted(
          c,
          docIdFor(c, isFullDocOp(op) ? FRESH : EXISTING),
          c.appMax,
          uid ?? ALICE,
        );
      });
    }
  }

  if (c.shape === 'project' || c.shape === 'subcollection') {
    it('DENIED: a non-member cannot update the document', async () => {
      await assertFails(
        updateDoc(refFor(db(CAROL), c, EXISTING), buildDoc(c.appMin, CAROL)),
      );
    });
  }

  if (c.shape === 'subcollection') {
    it('DENIED: a non-member cannot create under a project they are not in', async () => {
      await assertFails(setDoc(refFor(db(CAROL), c, FRESH), buildDoc(c.appMin, CAROL)));
    });
  }

  if (c.shape === 'selfOwned') {
    it("DENIED: one user cannot write another user's document", async () => {
      await assertFails(setDoc(doc(db(BOB), c.collection, ALICE), buildDoc(c.appMin, ALICE)));
    });
  }

  if (c.shape === 'anonymous') {
    it('DENIED: a session-token holder cannot advance the MCP-owned lastSeq', async () => {
      // The anonymous sites have no membership to widen, so the access
      // assertion takes the form the threat model actually names: lastSeq and
      // aiLastSeenAt are Admin-SDK-owned, and the update allowlist is what
      // stops a sessionId-holder writing them.
      await assertFails(updateDoc(refFor(db(null), c, EXISTING), { lastSeq: 99 }));
      await assertFails(
        updateDoc(refFor(db(null), c, EXISTING), { aiLastSeenAt: 'spoofed' }),
      );
    });
  }

  if (guardsIdentity && c.ops.includes('update')) {
    it('DENIED: an editor cannot make the maximal write, because it touches owner/members', async () => {
      // The trap this pins: shape 1's update necessarily affects `owner` and
      // `members`, which the escalation guard reserves to owners. Running that
      // case as an editor would fail HERE rather than on the allowlist, so the
      // guard is asserted directly instead of being silently relied upon.
      await assertFails(updateDoc(refFor(db(BOB), c, EXISTING), buildDoc(c.allowlist, BOB)));
    });
  }
});

/**
 * Site 4's create surface carries no allowlist ON PURPOSE
 * (firestore.rules:362-371): `firestoreDriver.createProduct` strips only `id`,
 * so a `keys().hasOnly()` there could reject a legitimate create still
 * carrying an `_owner`/`_members` alias field. The create rule binds
 * `owner == caller` instead, making the surface self-owned.
 *
 * Tested as the documented behaviour it is, rather than recorded as a gap - if
 * someone later "completes" the ruleset by adding a create allowlist, this
 * case is what tells them why it was left out.
 */
describe('spertstorymap_projects - create carries no field allowlist by design', () => {
  const storyMap = ALLOWLIST_CONTRACTS.find((c) => c.key === 'spertstorymap_projects');

  it('ALLOWED: a self-owned create still carrying an alias field is accepted', async () => {
    expect(storyMap, 'spertstorymap_projects contract present').toBeDefined();
    const client = db(ALICE);
    await assertSucceeds(
      setDoc(doc(client, 'spertstorymap_projects', FRESH), {
        ...buildDoc(storyMap!.appMin, ALICE),
        owner: ALICE,
        members: { [ALICE]: 'owner' },
        // The alias fields createProduct does not strip. A create allowlist
        // would reject these and break cloning.
        _owner: ALICE,
        _members: { [ALICE]: 'owner' },
      }),
    );
  });

  it('DENIED: a create claiming someone else as owner is still refused', async () => {
    const client = db(CAROL);
    await assertFails(
      setDoc(doc(client, 'spertstorymap_projects', 'carol-forged'), {
        ...buildDoc(storyMap!.appMin, CAROL),
        owner: ALICE,
        members: { [ALICE]: 'owner' },
      }),
    );
  });
});
