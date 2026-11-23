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
 *   THE TEXT - the `spertcfd_settings` match block's statements, comments
 *            removed and whitespace collapsed, equal one pinned string, whose
 *            key list is the register's allowlist; and no other rule in the
 *            file can match the path. The behavioural cases below probe NAMED
 *            keys, and `allowlist-vs-rules` reads only the first `hasOnly(` on
 *            a line, so a widening by an ARBITRARY key - a second `hasOnly`
 *            joined by `||`, or a key added to the rule and the register
 *            together - passes all of them (measured, PR #169's review). Only
 *            a pin of the text sees it, whatever the key is called.
 *   ALLOWED (the guard) - CFD's four `projectOrder` writes, each
 *            `setDoc(..., { merge: true })` as `firestore-driver.ts` sends them
 *            (createProject's arrayUnion append, placedProjectWrite's whole
 *            order, deleteProject's arrayRemove, reorderProjects' whole
 *            order), on three seeds: order + prefs; prefs alone (an invitee
 *            who set a colour before creating a project); and order with an
 *            EMPTY `projectPrefs: {}`, which R2's own nested delete of a
 *            person's last entry leaves, and on which the old rule refuses
 *            CFD's writes just the same.
 *   ALLOWED            - R2's write form, Forecaster's saveProjectPrefs:
 *            `setDoc` with `mergeFields` of one `FieldPath('projectPrefs', id,
 *            field)`, setting a value or a nested `deleteField()`; and the
 *            same onto a document that does not exist yet (an `updateDoc`
 *            there fails not-found, which is why R2 does not use one).
 *   READS  - the owner reads their document; another person and a signed-out
 *            reader are refused.
 *   DENIED - each of those writes plus ONE top-level key from the named near
 *            misses: `color` and `archived` (the two keys a literal reading of
 *            "add the colour and archive keys" would add) and
 *            `projectPrefsSeed` (MyScrumBudget's seeding key, which CFD R2
 *            does not need). And each of them made by another person. Any
 *            OTHER key is the text pin's job, not these cases'.
 *   CONTROL - deleting the whole `projectPrefs` field is accepted. It is
 *            accepted under the old rule too, so it cannot fail for a revert
 *            of 2.14.3. It documents the recovery path the rules comment
 *            describes (DASH26 O45) and pins that it exists.
 *
 * WHAT IT DOES NOT CLAIM. Values are unconstrained: `projectPrefs: 'junk'`,
 * `null`, or an unknown field inside an entry are all accepted (measured while
 * planning DASH26 R2a), and no behavioural case here pins values either way.
 * A value check does not land unnoticed, though: the generated shape 1 in
 * `allowlist-coverage.test.ts` writes `projectPrefs` as a string, so ANY value
 * check, right or wrong, reds shape 1 and must give it a typed value; and the
 * text pin reds on any edit to the block. Neither tests the rules comment's
 * requirement (DASH26 O41) that a value check judge only what a write
 * changes: a whole-document check passes every behavioural case here. That
 * requirement lives in the rules comment only.
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
import { ALLOWLIST_CONTRACTS } from './allowlist-contracts';

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

/**
 * An EMPTY map is still a present key: R2's nested deleteField() of a person's
 * last entry leaves exactly this, and the old rule refuses CFD's writes on it.
 * Only CFD's four writes run on it (R2's forms' expected documents assume PREFS).
 */
const EMPTY_PREFS_SEED: { name: string; data: Doc } = {
  name: 'order + EMPTY prefs',
  data: { projectOrder: ['p1', 'p2', 'p3'], projectPrefs: {} },
};

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
          "people's documents may hold it: every projectOrder write CFD makes to such a " +
          'document (all four are merges) is now refused, an empty projectPrefs map ' +
          'included (a new project or clone is not placed, a deleted id stays in the ' +
          'order, a reorder does not stick). Removing the key is free only until CFD R2 ' +
          'first writes it in production. After that, delete projectPrefs from every ' +
          "person's document first, empty maps included (the old rule allows that), which " +
          "erases their colours and archive. See the spertcfd_settings entry's notes in " +
          'allowlist-contracts.ts. ' +
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

  it('the empty seed holds projectPrefs as a PRESENT, empty map, and every CFD form changes it', () => {
    expect(Object.keys(EMPTY_PREFS_SEED.data)).toContain('projectPrefs');
    expect(EMPTY_PREFS_SEED.data.projectPrefs).toStrictEqual({});
    for (const form of FORMS.filter((f) => f.cfd)) {
      expect(form.expected(EMPTY_PREFS_SEED.data), `${form.name} changes the document`)
        .not.toStrictEqual(EMPTY_PREFS_SEED.data);
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

describe('spertcfd_settings: an EMPTY projectPrefs map is still a held key', () => {
  beforeEach(async () => {
    await seedAlice(EMPTY_PREFS_SEED.data);
  });

  for (const form of FORMS.filter((f) => f.cfd)) {
    it(`ALLOWED: ${form.name}`, async () => {
      await assertSucceeds(form.write(doc(dbAs(ALICE), COL, ALICE))).catch((err: unknown) => {
        throw brokenMessage(form, EMPTY_PREFS_SEED.name, err);
      });
      expect(await stored(ALICE)).toStrictEqual(form.expected(EMPTY_PREFS_SEED.data));
    });
  }
});

describe('spertcfd_settings: reads, only by the owner', () => {
  beforeEach(async () => {
    await seedAlice(SEEDS[0].data);
  });

  it('ALLOWED: the owner reads their own settings', async () => {
    const snap = await assertSucceeds(getDoc(doc(dbAs(ALICE), COL, ALICE)));
    expect(snap.data()).toStrictEqual(SEEDS[0].data);
  });

  it('DENIED: another person reads them', async () => {
    await assertFails(getDoc(doc(dbAs(BOB), COL, ALICE)));
  });

  it('DENIED: a signed-out reader reads them', async () => {
    const signedOut = testEnv.unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDoc(doc(signedOut, COL, ALICE)));
  });
});

describe('spertcfd_settings: the named near-miss keys are refused, and only the owner writes', () => {
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

/**
 * THE TEXT PIN (PR #169's review, -02 and -04).
 *
 * The behavioural cases above refuse three NAMED near-miss keys, and
 * `src/guards/allowlist-vs-rules.test.ts` compares the register with only the
 * first `hasOnly(` on each line. So two one-file or two-file widenings by any
 * OTHER key pass every check in the suite: a second `hasOnly([... 'theme'])`
 * joined to this one by `||` (rule only), and `'theme'` added to the rule and
 * the register together. Measured green in `test:rules` and `npm test` before
 * this pin existed (PR #169's review, its M8 and M4). No behavioural case can
 * refuse "every other key", so this pins the block's text instead, and checks
 * that nothing else in the file can match the path (a second match block, or a
 * wildcard one, would widen it by OR, which is how Firestore combines rules).
 *
 * A deliberate change to the block moves PINNED_BLOCK here and the register
 * entry in the same commit; the last case below holds the two together.
 */
const PINNED_KEYS = ['projectOrder', 'projectPrefs'];
const PINNED_BLOCK =
  'match /spertcfd_settings/{userId} { ' +
  'allow read: if isAuth() && request.auth.uid == userId; ' +
  'allow write: if isAuth() && request.auth.uid == userId ' +
  "&& request.resource.data.keys().hasOnly(['projectOrder', 'projectPrefs']); }";

/** `firestore.rules` with every `//` comment cut off, line by line. */
function strippedRules(): string {
  return readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8')
    .split('\n')
    .map((line) => {
      const i = line.indexOf('//');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

/** The `match /spertcfd_settings/...` block, braces balanced, whitespace collapsed. */
function settingsBlock(stripped: string): string {
  const start = stripped.indexOf('match /spertcfd_settings/');
  if (start === -1) throw new Error('firestore.rules has no `match /spertcfd_settings/` block');
  const segmentEnd = stripped.indexOf('}', start); // closes the `{userId}` path segment
  const open = stripped.indexOf('{', segmentEnd); // the block's own brace
  let depth = 0;
  for (let i = open; i < stripped.length; i++) {
    if (stripped[i] === '{') depth++;
    else if (stripped[i] === '}' && --depth === 0) {
      return stripped.slice(start, i + 1).replace(/\s+/g, ' ').trim();
    }
  }
  throw new Error('unbalanced braces after `match /spertcfd_settings/`');
}

describe('spertcfd_settings: the rule text is pinned', () => {
  it('the match block reads exactly as pinned', () => {
    const found = settingsBlock(strippedRules());
    if (found !== PINNED_BLOCK) {
      throw new Error(
        'SPERTCFD_SETTINGS RULE CHANGED: the match /spertcfd_settings/{userId} block in ' +
          'firestore.rules no longer reads as pinned. Nothing else in the suite sees every ' +
          'widening of this rule: allowlist-vs-rules reads only the first hasOnly( on a line ' +
          'and the generated cases follow the register, so a second hasOnly joined by ||, or ' +
          'a key added to the rule and the register together, passes them. If the change is ' +
          'deliberate, move PINNED_BLOCK (and PINNED_KEYS) here and the spertcfd_settings ' +
          'register entry in the same commit, and add cases for what the new rule allows. ' +
          `\n  pinned: ${PINNED_BLOCK}\n  found:  ${found}`,
      );
    }
    expect(found).toBe(PINNED_BLOCK);
  });

  it('no other rule in the file can match a spertcfd_settings document', () => {
    const stripped = strippedRules();
    expect(
      stripped.match(/match\s+\/spertcfd_settings\//g) ?? [],
      'exactly one match block for the collection',
    ).toHaveLength(1);
    expect(stripped.match(/match\s+\/\{/g) ?? [], 'no match whose first segment is a wildcard')
      .toHaveLength(0);
    expect(stripped.match(/=\*\*\}/g) ?? [], 'no recursive wildcard').toHaveLength(0);
  });

  it("the pinned key list is the register's allowlist, so a deliberate change moves both", () => {
    const entry = ALLOWLIST_CONTRACTS.find((c) => c.key === 'spertcfd_settings');
    expect(entry, 'spertcfd_settings register entry present').toBeDefined();
    expect([...entry!.allowlist].sort()).toStrictEqual([...PINNED_KEYS].sort());
    expect(PINNED_BLOCK).toContain(
      `hasOnly([${PINNED_KEYS.map((k) => `'${k}'`).join(', ')}])`,
    );
  });
});
