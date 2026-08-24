// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Firestore Security Rules - coverage for every `hasOnly()` field allowlist.
 *
 * WHY THIS EXISTS
 * ---------------
 * The ruleset has fourteen allowlist sites - twelve until 2.5.17 added one to
 * `spertforecaster_projects` and one to `spertahp_projects`. Until 2.5.16, one
 * was tested. The untested eleven each guard a routine save: tighten one past
 * what its app writes and that app starts failing with `PERMISSION_DENIED`,
 * silently, with nothing in this suite going red.
 * `ganttapp-snapshot-fields.test.ts` exists because exactly that happened to
 * the twelfth for seven days.
 *
 * The field sets live in `./allowlist-contracts` as data, so a later brief can
 * compare them against the apps' real converters without importing this file
 * or standing up an emulator. Every case below derives from that structure;
 * nothing here restates a field list.
 *
 * THE SHAPES
 * ----------
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
 *      SKIPPED EVERYWHERE SINCE 2.5.25, AND THAT IS THE ANSWER, NOT A DEAD
 *      BRANCH. A non-empty `unionOnly` means an allowlisted field no app
 *      writes; `coincides: false` is the same statement; the self-checks red
 *      when either changes. 2.5.25 rescoped `appMax` to all write paths
 *      reaching a site, which closed the last gap (Story Map's), so every
 *      entry now coincides and every shape 4 skips. Do NOT delete this branch
 *      because nothing exercises it - the day it runs is the day an allowlist
 *      has grown past its app, which is precisely what it exists to catch.
 *   5. ALLOWED - `deleteField()` removal, wherever a site declares `clearable`.
 *      Shapes 1, 2 and 4 all build plain documents, so none of them exercises a
 *      REMOVAL, and both apps make them: Forecaster writes deleteField()
 *      sentinels for its four clearable scalars on every debounced save, and
 *      both it and AHP drop a member with a nested `members.<uid>` delete. The
 *      case reads the document back and asserts the key is gone, so a rule that
 *      permitted a no-op cannot pass it.
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
 * Forecaster is the one collection where "owner" does not mean a role in the
 * members map: it keeps a separate top-level `owner` field, and its update rule
 * reads THAT to decide whether the caller may write at all. A pre-image owned by
 * someone else is refused there, before the allowlist is consulted - so that
 * contract sets `ownerOrthogonal` and the seed names the acting uid as owner.
 * `members` still differs between seed and target, so the guard stays exercised.
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
  arrayUnion,
  deleteField,
  doc,
  getDoc,
  increment,
  serverTimestamp,
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
function seedValue(field: string, uid: string, c?: AllowlistContract): unknown {
  // Forecaster keeps `owner` OUT of the members map, and its update rule reads
  // `resource.data.owner` to decide whether the caller may write at all. A
  // pre-image owned by someone else is denied there, before the allowlist is
  // ever consulted - the case would go green for the wrong reason on a DENY
  // and red for the wrong reason on an ALLOW. `members` still changes between
  // seed and target, so the escalation guard is still genuinely exercised.
  if (field === 'owner') return c?.ownerOrthogonal ? uid : 'uid_previous_owner';
  if (field === 'members') return { [uid]: 'owner', [BOB]: 'editor' };
  return TYPED_VALUES[field]?.seed ?? `seed-${field}`;
}

function buildDoc(fields: string[], uid: string): Doc {
  return Object.fromEntries(fields.map((f) => [f, targetValue(f, uid)]));
}

function buildSeed(fields: string[], uid: string, c?: AllowlistContract): Doc {
  return Object.fromEntries(fields.map((f) => [f, seedValue(f, uid, c)]));
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
    await setDoc(refFor(admin, c, docIdFor(c, EXISTING)), buildSeed(c.allowlist, ALICE, c));
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

/**
 * A MERGE write. `write()` above deliberately does not do one, and it is not
 * being changed to.
 *
 * The apps' real call at the two `selfOwned` settings sites is
 * `setDoc(ref, payload, { merge: true })`, sometimes onto a document that
 * already exists. `write()` issues a full-document `setDoc` against the FRESH
 * id, which is the right model for the driver writes it was built for.
 *
 * WHY THIS IS ADDITIVE RATHER THAN A FLAG ON `write()`
 * ---------------------------------------------------
 * Adding `{ merge: true }` inside `write()` would most likely leave every
 * existing shape-2 and shape-3 outcome green: a seed key set is a subset of
 * the allowlist, so a bogus key stays in the post-image either way. That is
 * the hazard, not the reassurance. Each existing case's tested PROPOSITION
 * would silently change from "a full-document write carrying these keys" to
 * "a merge update carrying these keys" while the case name kept claiming the
 * first. A green suite that has quietly stopped testing what its name says is
 * worse than a red one, so the merge path is its own function and the cases
 * that want it name it.
 */
function mergeWrite(
  client: Firestore,
  c: AllowlistContract,
  docId: string,
  payload: Doc,
): Promise<void> {
  return setDoc(refFor(client, c, docId), payload, { merge: true });
}

describe('allowlist contracts - self-check', () => {
  it('covers thirteen sites, leaving the snapshot site to its own suite', () => {
    expect(ALLOWLIST_CONTRACTS).toHaveLength(13);
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

  it('pins unionOnly to the difference the two field sets already imply', () => {
    for (const c of ALLOWLIST_CONTRACTS) {
      // unionOnly is derivable from allowlist and appMax. It is recorded anyway
      // so a reader sees the gap named, and pinned here so the two statements
      // cannot drift apart - the same defect class this file exists to catch.
      const permitted = new Set(c.appMax);
      const derived = c.allowlist.filter((f) => !permitted.has(f));
      expect([...c.unionOnly].sort(), `${c.key}.unionOnly`).toEqual(derived.sort());
      expect(c.unionOnly.length === 0, `${c.key}.unionOnly vs coincides`)
        .toBe(c.coincides);
    }
  });

  it('keeps every clearable path inside the allowlist', () => {
    for (const c of ALLOWLIST_CONTRACTS) {
      for (const path of c.clearable) {
        // A nested removal affects only its TOP-LEVEL key, which is what
        // affectedKeys() reports and therefore what must be allowlisted.
        const top = path.split('.')[0];
        expect(c.allowlist, `${c.key}.clearable ${path}`).toContain(top);
      }
    }
  });

  // WHAT THIS IS FOR, SO NOBODY DELETES IT LOOKING FOR A REASON
  // ------------------------------------------------------------
  // `clearable` is a hand-recorded snapshot of the app repositories, and in
  // 2.5.17 it was recorded WRONG: populated for the two sites that commit
  // authored and back-filled `[]` for the other eleven without a sweep. All
  // seven project apps drop a member with `deleteField()`, so five of those
  // `[]` cells were false and shape 5's `clearable.length > 0` gate generated
  // no case for any of them. Nothing went red, because an absent case and a
  // passing case are the same silence. This is the assertion that could have
  // gone red on 2026-08-20, and it reds again on the next back-fill or when an
  // eighth project app arrives with its cell unfilled.
  //
  // IT IS A CONVENTION CHECK, AND THIS IS THE ESCAPE ROUTE. Owning a members
  // map does not ENTAIL having a removal path - all seven simply happen to
  // have one. If a future project app legitimately has none, the response to
  // this red is to record an exception, NOT to back-fill the array and NOT to
  // relax the filter. Follow the house pattern: the `EXEMPT` map in
  // `src/guards/copyright-headers.test.ts:37`, whose companion assertion at
  // `:194` checks every exempt key still exists. Do not add that map now -
  // with no contract setting it the branch would be dead code.
  //
  // It also independently catches a mis-tokenised path. The generator
  // substitutes exactly one token, `<editor>`; a cell written `members.<uid>`
  // is never substituted and still passes BOTH of shape 5's assertions -
  // affectedKeys() reports the allowlisted top-level `members`, and reading
  // back a key that never existed is `undefined`. `toContain` reds on it here,
  // so that defect no longer depends on anyone reading prose.
  it('every project-shaped site declares the member removal every app performs', () => {
    for (const c of ALLOWLIST_CONTRACTS.filter((x) => x.shape === 'project')) {
      expect(c.clearable, `${c.key}.clearable`).toContain('members.<editor>');
    }
  });

  // The mirror image of the gate above: shape 5 runs only when a contract's
  // `ops` include `update`, so a clearable path declared on a site it cannot
  // run for is invisible - the same silence, from the other direction. Four of
  // the thirteen can never generate shape 5: `anonymous_sessions_create`
  // (`['create']`) and three `['write']` sites - `spertscheduler_settings`,
  // `spertcfd_settings` and `users_tos`, whose `allow write` COVERS updates
  // and which are therefore updatable in production.
  //
  // If this reds, teach shape 5 about `write` ops. Do NOT empty the array: a
  // `['write']` contract with a real clearing path needs coverage, not silence.
  it('every declared clearable path sits where shape 5 can generate a case for it', () => {
    for (const c of ALLOWLIST_CONTRACTS) {
      if (c.clearable.length > 0) {
        expect(c.ops, `${c.key} declares clearable but shape 5 cannot run`).toContain('update');
      }
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

      // Shape 5 verifies each removal with `toBeUndefined()`, which "was
      // present, now removed" and "was NEVER present" satisfy identically. Its
      // soundness therefore rests entirely on seedValue() having put BOB in the
      // members map - a coupling in another function that nothing asserted, and
      // the mechanism a mis-tokenised path rides in on. Assert the pre-image
      // here rather than inside shape 5: a red HERE means the fixture is unfit,
      // while a red in shape 5 still means the RULES rejected a removal. Those
      // are different findings and they should not share a failure site.
      //
      // Boundary: this covers `members.*` paths only. A future nested clearable
      // path into some other map would meet a string-typed seed and pass
      // vacuously. No such path exists today.
      for (const path of c.clearable) {
        const field = path.replace('<editor>', BOB);
        const [top, nested] = field.split('.');
        if (nested === undefined) continue;
        expect(
          (seeded.data()?.[top] as Record<string, unknown> | undefined)?.[nested],
          `${c.key} ${field} present in the pre-image shape 5 will delete from`,
        ).toBeDefined();
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

  if (c.clearable.length > 0 && c.ops.includes('update')) {
    const at = `update (firestore.rules:${c.lines[c.ops.indexOf('update')]})`;

    it(`ALLOWED shape 5 - deleteField() removal of every clearable path, ${at}`, async () => {
      // Shapes 1, 2 and 4 all build plain documents, so none of them exercises a
      // REMOVAL. ALL SEVEN project apps perform one: each drops a member with a
      // nested members.<uid> delete, and Forecaster additionally writes
      // deleteField() sentinels for its four clearable scalars on every
      // debounced save. (This comment read "both apps" until 2.5.23, when
      // `clearable` was re-derived and five under-declared cells were filled -
      // five of those seven generated no case at all until then.) A removal
      // lands in affectedKeys() exactly like any other change, so the allowlist
      // governs it - this is what proves that rather than assuming it.
      const removed: string[] = [];
      for (const path of c.clearable) {
        const field = path.replace('<editor>', BOB);
        await assertSucceeds(
          updateDoc(refFor(db(uid), c, EXISTING), { [field]: deleteField() }),
        );
        removed.push(field);
      }

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const admin = ctx.firestore() as unknown as Firestore;
        const after = await getDoc(refFor(admin, c, docIdFor(c, EXISTING)));
        const data = after.data() ?? {};
        for (const field of removed) {
          const [top, nested] = field.split('.');
          const actual = nested === undefined
            ? data[top]
            : (data[top] as Record<string, unknown> | undefined)?.[nested];
          // A rule that permitted the write but a payload that removed nothing
          // would leave this case asserting only that Firestore accepted a no-op.
          expect(actual, `${c.key} ${field} removed`).toBeUndefined();
        }
      });
    });
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
 * (firestore.rules:363-372): `firestoreDriver.createProduct` strips only `id`,
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

/**
 * TRANSFORM VISIBILITY - regression coverage for a measured negative.
 *
 * THE QUESTION
 * ------------
 * `hasOnly()` is a SUBSET predicate, so an empty key set satisfies it
 * vacuously. If a field transform - `arrayUnion`, `increment`,
 * `serverTimestamp` - were resolved AFTER the rules evaluated, its key would be
 * absent from `request.resource.data`, and every one of the ruleset's fourteen
 * allowlist sites would be bypassable by a write that carried its payload as
 * transforms instead of as plain values.
 *
 * THE ANSWER, MEASURED
 * --------------------
 * Transforms are VISIBLE. Firestore resolves them before the rules run, so the
 * key appears in `keys()` and in `diff(resource.data).affectedKeys()` alike,
 * and a transform on a non-allowlisted key is refused exactly as a plain value
 * is. Eight pre-registered cases against the real ruleset, 8/8, measured
 * 2026-08-23 and re-run independently 2026-08-24.
 *
 * So there is no bypass, and no rule changed here. What this block buys is a
 * guard against the ENGINE BEHAVIOUR changing: were a future emulator or
 * backend to resolve transforms later, the six denials below turn red and name
 * the reason, instead of this suite continuing to pass while every allowlist in
 * the ruleset had quietly become advisory.
 *
 * WHY 2 x 3, AND NOT PER SITE
 * ---------------------------
 * Two axes can vary. The PREDICATE FAMILY - `keys()` on create/write versus
 * `diff().affectedKeys()` on update, which are separate rules reached by
 * separate code paths. And the TRANSFORM CLASS - array, numeric and timestamp
 * are three different server-side resolutions, and a divergence in any one of
 * them would be equally suite-wide.
 *
 * Site does NOT vary. A transform written to a bogus key is bogus at every
 * site, because the allowlist it fails is not consulted until the key set has
 * been built. Generating this per contract would be twenty cases all carrying
 * one transform class - redundant on the axis that does not vary, blind on the
 * one that does - and twenty cases read as per-site coverage while asserting a
 * single engine property.
 *
 * The two ACCEPT cases are the must-pass controls, and they assert CONTENT.
 * An engine that stripped the transform entirely would also accept, because
 * `[].hasOnly(['projectOrder'])` is true - so bare acceptance is consistent
 * with the very failure this block tests for. Both read the document back with
 * rules disabled.
 */
describe('field transforms are visible to the allowlists - both predicate families', () => {
  const settings = ALLOWLIST_CONTRACTS.find((c) => c.key === 'spertcfd_settings');
  const storyMap = ALLOWLIST_CONTRACTS.find((c) => c.key === 'spertstorymap_projects');

  /** `spertcfd_settings` is `selfOwned`, so its document id is the acting uid. */
  const SETTINGS_DOC = ALICE;
  const STORY_DOC = EXISTING;

  /**
   * The `affectedKeys()` family needs a pre-image: `updateDoc` requires the
   * document to exist, and the rule reads `resource.data.members` to decide
   * whether the caller may write at all. Seeded as the production shape rather
   * than through `buildSeed`, which would make `_changeLog` a string.
   */
  async function seedStoryMapProduct(): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      await setDoc(doc(admin, 'spertstorymap_projects', STORY_DOC), {
        name: 'Alice product',
        owner: ALICE,
        members: { [ALICE]: 'owner' },
        _changeLog: ['seed-entry'],
      });
    });
  }

  it('self-check: both host contracts are present', () => {
    // A contract key rename would otherwise empty this whole block silently.
    expect(settings, 'spertcfd_settings contract present').toBeDefined();
    expect(storyMap, 'spertstorymap_projects contract present').toBeDefined();
    expect(settings!.allowlist, 'projectOrder is the allowlisted key').toContain('projectOrder');
    expect(storyMap!.allowlist, '_changeLog is the allowlisted key').toContain('_changeLog');
  });

  it('ALLOWED: keys() family - arrayUnion on the allowlisted key, and the value lands', async () => {
    const client = db(ALICE);
    await assertSucceeds(
      mergeWrite(client, settings!, SETTINGS_DOC, { projectOrder: arrayUnion('p1') }),
    );

    // Content, not bare acceptance: a stripped transform would leave the key
    // absent and `[]` satisfies the allowlist, so "it resolved" proves nothing.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      const stored = await getDoc(doc(admin, 'spertcfd_settings', SETTINGS_DOC));
      expect(stored.exists(), 'settings doc created by the merge write').toBe(true);
      expect(stored.data()?.projectOrder).toStrictEqual(['p1']);
    });
  });

  it('ALLOWED: affectedKeys() family - arrayUnion on the allowlisted key, and the value lands', async () => {
    await seedStoryMapProduct();
    const client = db(ALICE);
    await assertSucceeds(
      updateDoc(doc(client, 'spertstorymap_projects', STORY_DOC), {
        _changeLog: arrayUnion('appended-entry'),
      }),
    );

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const admin = ctx.firestore() as unknown as Firestore;
      const stored = await getDoc(doc(admin, 'spertstorymap_projects', STORY_DOC));
      expect(stored.data()?._changeLog).toStrictEqual(['seed-entry', 'appended-entry']);
    });
  });

  /**
   * The six denials, as the product of the two axes that vary. Each writes a
   * transform to a key no allowlist contains and expects refusal.
   *
   * The transforms are FACTORIES because these sentinels are single-use values,
   * not constants - one shared instance reused across cases is a different bug
   * with the same green.
   */
  const TRANSFORM_CLASSES: ReadonlyArray<readonly [string, () => unknown]> = [
    ['arrayUnion', () => arrayUnion('y')],
    ['increment', () => increment(1)],
    ['serverTimestamp', () => serverTimestamp()],
  ];

  const FAMILIES: ReadonlyArray<{
    readonly name: string;
    readonly host: string;
    readonly deny: (payload: Doc) => Promise<unknown>;
    readonly seed: () => Promise<void>;
  }> = [
    {
      name: 'keys()',
      host: 'spertcfd_settings',
      deny: (payload) => mergeWrite(db(ALICE), settings!, SETTINGS_DOC, payload),
      seed: async () => {},
    },
    {
      name: 'affectedKeys()',
      host: 'spertstorymap_projects',
      deny: (payload) => updateDoc(doc(db(ALICE), 'spertstorymap_projects', STORY_DOC), payload),
      seed: seedStoryMapProduct,
    },
  ];

  for (const family of FAMILIES) {
    for (const [className, make] of TRANSFORM_CLASSES) {
      it(`DENIED: ${family.name} family - ${className} on a non-allowlisted key of ${family.host}`, async () => {
        await family.seed();
        await assertFails(family.deny({ evil: make() }));
      });
    }
  }
});
