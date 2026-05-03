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

import {revokeInvite} from "../revokeInvite";

const handler = (
  revokeInvite as unknown as {
    run: (req: unknown) => Promise<{revoked: true}>;
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

describe("revokeInvite validation", () => {
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
});

describe("revokeInvite ownership + state", () => {
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

  it("throws failed-precondition when status is already revoked",
    async () => {
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

describe("revokeInvite happy path", () => {
  it("flips status to revoked and stamps updatedAt", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      get: (k: string) => {
        if (k === "inviterUid") return "uid-owner";
        if (k === "status") return "pending";
        return undefined;
      },
    });

    const out = await handler(makeReq());

    expect(out).toEqual({revoked: true});
    expect(fakeTx.update).toHaveBeenCalledWith(
      invitationsDocRef,
      expect.objectContaining({
        status: "revoked",
        updatedAt: "<serverTimestamp>",
      }),
    );
    // Soft-revoke only — no delete.
    expect(fakeTx.delete).not.toHaveBeenCalled();
  });
});
