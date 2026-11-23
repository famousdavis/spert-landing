// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Firestore Security Rules - `spertcfd_settings` accepts `projectPrefs`, and
 * CFD's own writes keep working on a document that holds it.
 *
 * WHY THIS EXISTS (landing 2.14.3, DASH26 R2a)
 * --------------------------------------------
 * A person's CFD settings document, `spertcfd_settings/{uid}`, allowed one key,
 * `projectOrder`. 2.14.3 adds `projectPrefs` - each person's own tile colour
 * and archive per project, `{ [projectId]: { color?, archived? } }`, the key
 * SPERT Forecaster, Story Map, GanttApp and MyScrumBudget use - before the CFD
 * release that writes it (DASH26 R2). The rule checks KEYS ONLY.
 *
 * The register (`allowlist-contracts.ts`) records `projectPrefs` as a key no
 * app writes (`unionOnly`) until R2c flips it back. A register that says "no
 * app writes this" invites a later pass to remove it, and the generated cases
 * in `allowlist-coverage.test.ts` follow the register, so they would go on
 * passing if the key left the rule and the register together. These cases do
 * not read the register. They write what CFD writes, on a document that
 * HOLDS `projectPrefs`, so they fail if the key leaves the rule, whatever the
 * register says - the KEEP pattern of `myscrumbudget-provenance-fields.test.ts`.
 *
 * WHY EVERY ACCEPT IS SEEDED
 * --------------------------
 * `hasOnly()` is a subset predicate and `keys()` judges the document AFTER the
 * write. On a document without `projectPrefs`, CFD's `projectOrder` writes are
 * accepted under the old rule and the new alike, and a nested `deleteField()`
 * of an absent path is accepted under the old rule too (measured while
 * planning DASH26 R2a). Only a document that already holds `projectPrefs`
 * tells the two rules apart, so every accept below starts from one, and reads
 * the stored document back: a write that "succeeded" while dropping a field
 * must fail.
 *
 * WHAT IT PINS
 * ------------
 *   ALLOWED (the guard) - CFD's four `projectOrder` writes, each
 *            `setDoc(..., { merge: true })` as `firestore-driver.ts` sends them
 *            (createProject's arrayUnion append, placedProjectWrite's whole
 *            order, deleteProject's arrayRemove, reorderProjects' whole
 *            order), on two seeds: order + prefs, and prefs alone (an invitee
 *            who set a colour before creating a project).
 *   ALLOWED            - R2's write form, Forecaster's saveProjectPrefs:
 *            `setDoc` with `mergeFields` of one `FieldPath('projectPrefs', id,
 *            field)`, setting a value or a nested `deleteField()`; and the
 *            same onto a document that does not exist yet (an `updateDoc`
 *            there fails not-found, which is why R2 does not use one).
 *   DENIED - each of those writes plus ONE top-level key from the near
 *            misses: `color` and `archived` (the two keys a literal reading of
 *            "add the colour and archive keys" would add) and
 *            `projectPrefsSeed` (MyScrumBudget's seeding key, which CFD R2
 *            does not need). And each of them made by another person.
 *   CONTROL - deleting the whole `projectPrefs` field is accepted. It is
 *            accepted under the old rule too, so it cannot fail for a revert
 *            of 2.14.3. It documents the recovery path the rules comment
 *            describes (DASH26 O45) and pins that it exists.
 *
 * WHAT IT DOES NOT CLAIM. Values are unconstrained: `projectPrefs: 'junk'`,
 * `null`, or an unknown field inside an entry are all accepted (measured).
 * Nothing here pins that either way, so a later value check is free to land -
 * provided it judges only what a write changes (see the rules comment).
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
  arrayRemove,
  arrayUnion,
  deleteField,
  doc,
  FieldPath,
  getDoc,
  setDoc,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const COL = 'spertcfd_settings';
const ALICE = 'uid_alice';
/** Has no settings document at all: the target of the first-write cases. */
const BOB = 'uid_bob';

type Doc = Record<string, unknown>;

const PREFS = { p1: { color: 'blue', archived: true }, p2: { color: 'green' } };

/** Two documents a person can hold once CFD R2 ships. Both carry `projectPrefs`. */
const SEEDS: ReadonlyArray<{ name: string; data: Doc }> = [
  { name: 'order + prefs', data: { projectOrder: ['p1', 'p2', 'p3'], projectPrefs: PREFS } },
  { name: 'prefs only', data: { projectPrefs: PREFS } },
];

/** The top-level keys a mistaken widening would most likely add. */
const NEAR_MISSES: readonly string[] = ['color', 'archived', 'projectPrefsSeed'];

const order = (seed: Doc): string[] => (seed.projectOrder as string[] | undefined) ?? [];

interface Form {
  name: string;
  /** CFD's own write today (true) or R2's (false) - they fail with different messages. */
  cfd: boolean;
  /** The write, with optional extra top-level keys (merged, or masked in, as the form requires). */
  write: (ref: DocumentReference, extra?: Doc) => Promise<void>;
  /** What the stored document must hold afterwards. */
  expected: (seed: Doc) => Doc;
}

/** `mergeFields` drops any data outside its mask, so an extra key must be masked in to be sent. */
const masked = (paths: FieldPath[], extra: Doc): (FieldPath | string)[] => [
  ...paths,
  ...Object.keys(extra),
];

const FORMS: readonly Form[] = [
  {
    name: "createProject's arrayUnion append",
    cfd: true,
    write: (ref, extra = {}) =>
      setDoc(ref, { projectOrder: arrayUnion('p9'), ...extra }, { merge: true }),
    expected: (seed) => ({ ...seed, projectOrder: [...order(seed), 'p9'] }),
  },
  {
    name: "placedProjectWrite's whole order (a clone's placement)",
    cfd: true,
    write: (ref, extra = {}) =>
      setDoc(ref, { projectOrder: ['p1', 'p9', 'p2', 'p3'], ...extra }, { merge: true }),
    expected: (seed) => ({ ...seed, projectOrder: ['p1', 'p9', 'p2', 'p3'] }),
  },
  {
    name: "deleteProject's arrayRemove",
    cfd: true,
    write: (ref, extra = {}) =>
      setDoc(ref, { projectOrder: arrayRemove('p2'), ...extra }, { merge: true }),
    expected: (seed) => ({ ...seed, projectOrder: order(seed).filter((id) => id !== 'p2') }),
  },
  {
    name: "reorderProjects' whole order",
    cfd: true,
    write: (ref, extra = {}) =>
      setDoc(ref, { projectOrder: ['p3', 'p1', 'p2'], ...extra }, { merge: true }),
    expected: (seed) => ({ ...seed, projectOrder: ['p3', 'p1', 'p2'] }),
  },
  {
    name: "R2's colour write (Forecaster's saveProjectPrefs form)",
    cfd: false,
    write: (ref, extra = {}) =>
      setDoc(
        ref,
        { projectPrefs: { p3: { color: 'red' } }, ...extra },
        { mergeFields: masked([new FieldPath('projectPrefs', 'p3', 'color')], extra) },
      ),
    expected: (seed) => ({ ...seed, projectPrefs: { ...PREFS, p3: { color: 'red' } } }),
  },
  {
    name: "R2's nested deleteField() (clearing one project's archive)",
    cfd: false,
    write: (ref, extra = {}) =>
      setDoc(
        ref,
        { projectPrefs: { p1: { archived: deleteField() } }, ...extra },
        { mergeFields: masked([new FieldPath('projectPrefs', 'p1', 'archived')], extra) },
      ),
    expected: (seed) => ({ ...seed, projectPrefs: { ...PREFS, p1: { color: 'blue' } } }),
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
});

function dbAs(uid: string): Firestore {
  return testEnv.authenticatedContext(uid).firestore() as unknown as Firestore;
}

async function seedAlice(data: Doc): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore() as unknown as Firestore, COL, ALICE), data);
  });
}

async function stored(uid: string): Promise<Doc | null> {
  let out: Doc | null = null;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore() as unknown as Firestore, COL, uid));
    out = snap.exists() ? (snap.data() as Doc) : null;
  });
  return out;
}

function brokenMessage(form: Form, seedName: string, err: unknown): Error {
  return new Error(
    form.cfd
      ? `PROJECTPREFS GUARD BROKEN: CFD's ${form.name} to a settings document holding ` +
          `projectPrefs (${seedName}) was DENIED. projectPrefs has been dropped from, or ` +
          'narrowed out of, the spertcfd_settings allowlist in firestore.rules while ' +
          "people's documents may hold it: every projectOrder write to such a document is " +
          'now refused (a new project or clone is not placed, a deleted id stays in the ' +
          'order, a reorder does not stick). Removing the key is free only until CFD R2 ' +
          'first writes it in production. After that, delete projectPrefs from every ' +
          "person's document first (the old rule allows that), which erases their colours " +
          "and archive. See the spertcfd_settings entry's notes in allowlist-contracts.ts. " +
          `Cause: ${String(err)}`
      : `PROJECTPREFS REFUSED: ${form.name} on a settings document holding projectPrefs ` +
          `(${seedName}) was DENIED. CFD R2 writes projectPrefs this way, so the ` +
          'spertcfd_settings rule in firestore.rules must accept it. ' +
          `Cause: ${String(err)}`,
  );
}

describe('harness self-check', () => {
  it('every seed holds projectPrefs with at least one entry, and every accepted form changes it', () => {
    for (const seed of SEEDS) {
      const prefs = seed.data.projectPrefs as Record<string, unknown> | undefined;
      expect(prefs && Object.keys(prefs).length, `${seed.name} holds projectPrefs`)
        .toBeGreaterThan(0);
      for (const form of FORMS) {
        // A form whose expected document equals its seed would assert a no-op.
        expect(form.expected(seed.data), `${form.name} on ${seed.name} changes the document`)
          .not.toStrictEqual(seed.data);
      }
    }
  });

  it('BOB has no settings document, so the first-write case starts from nothing', async () => {
    await seedAlice(SEEDS[0].data);
    expect(await stored(BOB)).toBeNull();
  });
});

describe.each(SEEDS)('spertcfd_settings holding projectPrefs ($name)', (seed) => {
  beforeEach(async () => {
    await seedAlice(seed.data);
  });

  for (const form of FORMS) {
    it(`ALLOWED: ${form.name}`, async () => {
      await assertSucceeds(form.write(doc(dbAs(ALICE), COL, ALICE))).catch((err: unknown) => {
        throw brokenMessage(form, seed.name, err);
      });
      expect(await stored(ALICE)).toStrictEqual(form.expected(seed.data));
    });
  }

  it('CONTROL: deleting the whole projectPrefs field is accepted, and order writes work after it (the way back)', async () => {
    // CONTROL, not a guard. Accepted under the rule before 2.14.3 too: keys()
    // of the resulting document shrinks. So this CANNOT fail for a revert of
    // 2.14.3. It documents the recovery path the rules comment describes
    // (DASH26 O45): a person's projectPrefs can still be removed by the
    // client, and their order then saves again.
    await assertSucceeds(
      setDoc(doc(dbAs(ALICE), COL, ALICE), { projectPrefs: deleteField() }, { merge: true }),
    );
    const rest = { ...seed.data };
    delete rest.projectPrefs;
    expect(await stored(ALICE)).toStrictEqual(rest);

    const reorder = FORMS.find((f) => f.name.startsWith("reorderProjects'"))!;
    await assertSucceeds(reorder.write(doc(dbAs(ALICE), COL, ALICE)));
    expect(await stored(ALICE)).toStrictEqual(reorder.expected(rest));
  });
});

describe('spertcfd_settings: nothing but the two keys, and only by the owner', () => {
  beforeEach(async () => {
    await seedAlice(SEEDS[0].data);
  });

  for (const form of FORMS) {
    for (const key of NEAR_MISSES) {
      it(`DENIED: ${form.name}, plus a top-level \`${key}\``, async () => {
        await assertFails(form.write(doc(dbAs(ALICE), COL, ALICE), { [key]: 'not allowed' }));
        expect(await stored(ALICE), 'a denial leaves the document alone').toStrictEqual(
          SEEDS[0].data,
        );
      });
    }

    it(`DENIED: ${form.name}, made by another person`, async () => {
      await assertFails(form.write(doc(dbAs(BOB), COL, ALICE)));
      expect(await stored(ALICE), 'a denial leaves the document alone').toStrictEqual(
        SEEDS[0].data,
      );
    });
  }
});

describe("spertcfd_settings: R2's first write, onto a document that does not exist", () => {
  const r2Colour = FORMS.find((f) => f.name.startsWith("R2's colour"))!;

  it("ALLOWED: R2's colour write creates the person's document", async () => {
    await assertSucceeds(r2Colour.write(doc(dbAs(BOB), COL, BOB))).catch((err: unknown) => {
      throw brokenMessage(r2Colour, 'no document', err);
    });
    expect(await stored(BOB)).toStrictEqual({ projectPrefs: { p3: { color: 'red' } } });
  });

  it("DENIED: the same write, plus a top-level `archived`", async () => {
    await assertFails(r2Colour.write(doc(dbAs(BOB), COL, BOB), { archived: 'not allowed' }));
    expect(await stored(BOB)).toBeNull();
  });

  it('DENIED: the same write, made by another person', async () => {
    await assertFails(r2Colour.write(doc(dbAs(ALICE), COL, BOB)));
    expect(await stored(BOB)).toBeNull();
  });
});
