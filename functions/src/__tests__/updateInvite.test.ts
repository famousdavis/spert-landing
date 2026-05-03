// ===== Firestore mock =====
const fakeTx = {
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const invitationsDocRef = {id: "tok-1"};
const invitationsDoc = jest.fn(() => invitationsDocRef);

const fakeDb = {
  collection: jest.fn((name: string) => {
    if (name === "spertsuite_invitations") {
      return {doc: invitationsDoc};
    }
    throw new Error("unexpected collection: " + name);
  }),
  runTransaction: jest.fn(async (fn: (tx: typeof fakeTx) => unknown) =>
    fn(fakeTx),
  ),
};

jest.mock("firebase-admin/firestore", () => {
  const actual = jest.requireActual("firebase-admin/firestore");
  return {
    ...actual,
    FieldValue: {
      serverTimestamp: jest.fn(() => "<serverTimestamp>"),
    },
    getFirestore: jest.fn(() => fakeDb),
  };
});

import {updateInvite} from "../updateInvite";

const handler = (
  updateInvite as unknown as {
    run: (req: unknown) => Promise<{updated: true}>;
  }
).run;

/**
 * Build a fake CallableRequest for handler.run().
 * @param {Record<string, unknown>} overrides Optional sub-objects to merge
 *   into auth and request.data.
 * @return {unknown} A v2 CallableRequest-shaped object.
 */
function makeReq(overrides: Record<string, unknown> = {}): unknown {
  return {
    auth: overrides.auth === null ? undefined : {
      uid: "uid-owner",
      token: {email: "alice@example.com"},
      ...((overrides.authOverrides as Record<string, unknown>) ?? {}),
    },
    rawRequest: {headers: {origin: ""}},
    data: {
      tokenId: "tok-1",
      isVoting: true,
      ...((overrides.dataOverrides as Record<string, unknown>) ?? {}),
    },
  };
}

beforeEach(() => {
  fakeTx.get.mockReset();
  fakeTx.set.mockReset();
  fakeTx.update.mockReset();
  fakeTx.delete.mockReset();
  fakeDb.runTransaction.mockClear();
  fakeDb.collection.mockClear();
  invitationsDoc.mockClear();
});

describe("updateInvite validation", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(
      handler({...(makeReq() as object), auth: undefined}),
    ).rejects.toMatchObject({code: "unauthenticated"});
  });

  it("rejects missing tokenId", async () => {
    await expect(
      handler(makeReq({dataOverrides: {tokenId: undefined}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("rejects empty-string tokenId", async () => {
    await expect(
      handler(makeReq({dataOverrides: {tokenId: ""}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("rejects non-string tokenId", async () => {
    await expect(
      handler(makeReq({dataOverrides: {tokenId: 12345}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("rejects missing isVoting", async () => {
    await expect(
      handler(makeReq({dataOverrides: {isVoting: undefined}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("rejects non-boolean isVoting", async () => {
    await expect(
      handler(makeReq({dataOverrides: {isVoting: "yes"}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });
});

describe("updateInvite ownership + state", () => {
  it("throws not-found when invitation doc missing", async () => {
    fakeTx.get.mockResolvedValueOnce({exists: false, get: () => undefined});
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "not-found",
    });
  });

  it("throws permission-denied when caller is not the inviter", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      get: (k: string) => {
        if (k === "inviterUid") return "someone-else";
        if (k === "status") return "pending";
        return undefined;
      },
    });
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("throws failed-precondition when status is accepted", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      get: (k: string) => {
        if (k === "inviterUid") return "uid-owner";
        if (k === "status") return "accepted";
        return undefined;
      },
    });
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("throws failed-precondition when status is revoked", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      get: (k: string) => {
        if (k === "inviterUid") return "uid-owner";
        if (k === "status") return "revoked";
        return undefined;
      },
    });
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });

  it("throws failed-precondition when status is expired", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      get: (k: string) => {
        if (k === "inviterUid") return "uid-owner";
        if (k === "status") return "expired";
        return undefined;
      },
    });
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "failed-precondition",
    });
  });
});

describe("updateInvite happy path", () => {
  it("sets isVoting=true and stamps updatedAt without touching status",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: true,
        get: (k: string) => {
          if (k === "inviterUid") return "uid-owner";
          if (k === "status") return "pending";
          return undefined;
        },
      });

      const out = await handler(makeReq());

      expect(out).toEqual({updated: true});
      expect(fakeTx.update).toHaveBeenCalledTimes(1);
      const updateArgs = fakeTx.update.mock.calls[0];
      expect(updateArgs[0]).toBe(invitationsDocRef);
      expect(updateArgs[1]).toEqual({
        isVoting: true,
        updatedAt: "<serverTimestamp>",
      });
      // status field must not be touched
      expect(updateArgs[1]).not.toHaveProperty("status");
      expect(fakeTx.delete).not.toHaveBeenCalled();
    });

  it("sets isVoting=false and stamps updatedAt without touching status",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: true,
        get: (k: string) => {
          if (k === "inviterUid") return "uid-owner";
          if (k === "status") return "pending";
          return undefined;
        },
      });

      const out = await handler(
        makeReq({dataOverrides: {isVoting: false}}),
      );

      expect(out).toEqual({updated: true});
      expect(fakeTx.update).toHaveBeenCalledTimes(1);
      const updateArgs = fakeTx.update.mock.calls[0];
      expect(updateArgs[0]).toBe(invitationsDocRef);
      expect(updateArgs[1]).toEqual({
        isVoting: false,
        updatedAt: "<serverTimestamp>",
      });
      expect(updateArgs[1]).not.toHaveProperty("status");
      expect(fakeTx.delete).not.toHaveBeenCalled();
    });
});
