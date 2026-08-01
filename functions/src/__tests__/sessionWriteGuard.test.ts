// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// The Firestore create rule for anonymous_sessions no longer pins
// consentWrite to true — read-only SPERT apps create sessions with
// consentWrite: false — so assertWriteAllowed() inside writeOpBatch is now
// the ONLY enforcement point for AI-originated writes across the suite.
// These are its unit tests (§3.5 [5]) plus one end-to-end check that
// writeOpBatch itself refuses before touching the op log.

import type {DocumentData} from "firebase-admin/firestore";
import {assertWriteAllowed, writeOpBatch} from "../mcp/session";

interface FakeSnap {
  exists: boolean;
  data: () => DocumentData | undefined;
}

interface FakeColRef {
  doc: (id?: string) => FakeDocRef;
}

interface FakeDocRef {
  get: () => Promise<FakeSnap>;
  update: (data?: object) => Promise<void>;
  collection: (name: string) => FakeColRef;
}

const SID = "00000000-0000-4000-8000-000000000000";

/**
 * Build a Firestore double serving one session document and counting every
 * op-log write made inside the transaction.
 * @param {DocumentData} sessionData The session document to serve.
 * @return {object} The double, plus an opWrites() counter.
 */
function fakeDb(sessionData: DocumentData): {
  db: unknown;
  opWrites: () => number;
} {
  let opWrites = 0;
  const snap: FakeSnap = {exists: true, data: () => sessionData};
  const docRef: FakeDocRef = {
    get: async () => snap,
    update: async () => undefined,
    collection: () => colRef,
  };
  const colRef: FakeColRef = {doc: () => docRef};
  const db = {
    collection: (): FakeColRef => colRef,
    runTransaction: async (
      fn: (tx: {
        get: (ref: unknown) => Promise<FakeSnap>;
        update: (ref: unknown, data: object) => void;
        set: (ref: unknown, data: object) => void;
      }) => Promise<unknown>,
    ): Promise<unknown> =>
      fn({
        get: async () => snap,
        update: () => undefined,
        set: () => {
          opWrites++;
        },
      }),
  };
  return {db, opWrites: () => opWrites};
}

describe("assertWriteAllowed", () => {
  test("permits a session that granted write consent", () => {
    expect(() => assertWriteAllowed({consentWrite: true})).not.toThrow();
  });

  test("refuses consentWrite: false", () => {
    expect(() => assertWriteAllowed({consentWrite: false})).toThrow(
      "write_not_permitted",
    );
  });

  test("refuses undefined session data", () => {
    expect(() => assertWriteAllowed(undefined)).toThrow("write_not_permitted");
  });

  test("refuses a session with no consentWrite key at all", () => {
    // Strict !== true, not a falsy check: a legacy document missing the key
    // must fail closed rather than inherit write access.
    expect(() => assertWriteAllowed({consentRead: true})).toThrow(
      "write_not_permitted",
    );
  });

  test("refuses a truthy non-boolean consentWrite", () => {
    expect(() => assertWriteAllowed({consentWrite: "true"})).toThrow(
      "write_not_permitted",
    );
  });
});

describe("writeOpBatch enforces write consent before appending", () => {
  test("a consentWrite: false session throws and writes zero ops", async () => {
    const {db, opWrites} = fakeDb({consentWrite: false, lastSeq: 0});
    await expect(
      writeOpBatch(db as Parameters<typeof writeOpBatch>[0], SID, [
        {op: "create_theme", payload: {themeId: "t1", name: "T"}},
      ]),
    ).rejects.toThrow("write_not_permitted");
    expect(opWrites()).toBe(0);
  });

  test("a consentWrite: true session still appends normally", async () => {
    const {db, opWrites} = fakeDb({consentWrite: true, lastSeq: 4});
    const range = await writeOpBatch(
      db as Parameters<typeof writeOpBatch>[0],
      SID,
      [
        {op: "create_theme", payload: {themeId: "t1", name: "T"}},
        {op: "create_theme", payload: {themeId: "t2", name: "U"}},
      ],
    );
    expect(range).toEqual({firstSeq: 5, lastSeq: 6});
    expect(opWrites()).toBe(2);
  });
});
