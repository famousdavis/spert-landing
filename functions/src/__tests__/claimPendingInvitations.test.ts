// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {Timestamp} from "firebase-admin/firestore";

const fakeTx = {
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const queryChain = {
  where: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  get: jest.fn(),
};

const fakeDoc = jest.fn();
// Track which collection name `db.collection()` was last invoked with —
// lets per-test assertions verify CFD vs AHP project routing.
let lastCollectionName: string | null = null;

const fakeDb = {
  collection: jest.fn((name: string) => {
    lastCollectionName = name;
    return {
      where: queryChain.where,
      orderBy: queryChain.orderBy,
      get: queryChain.get,
      doc: fakeDoc,
    };
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

import {claimPendingInvitations} from "../claimPendingInvitations";

const handler = (
  claimPendingInvitations as unknown as {
    run: (req: unknown) => Promise<{ claimed: unknown[] }>;
  }
).run;

const futureTs = Timestamp.fromMillis(Date.now() + 86_400_000);

/**
 * The `firebase` claim every real, verified ID token carries — on
 * DecodedIdToken `firebase.sign_in_provider: string` is NON-optional. Every
 * token these tests build carries one, so a refusal in this file is
 * attributable to the provider VALUE and never to an absent claim, which is
 * a shape no real token has.
 * @param {string} provider The `sign_in_provider` of this sign-in.
 * @return {Record<string, unknown>} A `firebase` claim shaped like the real one.
 */
function firebaseClaim(provider: string): Record<string, unknown> {
  return {
    identities: {
      [provider]: [`${provider}-subject`],
      email: ["claim@example.com"],
    },
    sign_in_provider: provider,
  };
}

/**
 * Build a fake CallableRequest for handler.run().
 * @param {Record<string, unknown>} overrides Optional sub-objects to merge
 *   in (tokenOverrides for auth.token, top-level for the request itself).
 *   The default token is a verified `google.com` sign-in; pass
 *   `tokenOverrides.firebase` to change the provider.
 * @return {unknown} A v2 CallableRequest-shaped object.
 */
function makeReq(overrides: Record<string, unknown> = {}): unknown {
  return {
    auth: {
      uid: "uid-claim",
      token: {
        email: "claim@example.com",
        email_verified: true,
        firebase: firebaseClaim("google.com"),
        ...((overrides.tokenOverrides as Record<string, unknown>) ?? {}),
      },
    },
    data: {},
    ...overrides,
  };
}

beforeEach(() => {
  fakeTx.get.mockReset();
  fakeTx.set.mockReset();
  fakeTx.update.mockReset();
  fakeTx.delete.mockReset();
  queryChain.where.mockClear();
  queryChain.orderBy.mockClear();
  queryChain.get.mockReset();
  fakeDoc.mockReset();
  fakeDb.collection.mockClear();
  fakeDb.runTransaction.mockClear();
  lastCollectionName = null;
});

describe("claimPendingInvitations", () => {
  it("refuses a google.com token with email_verified: false " +
    "(failed-precondition)",
  async () => {
    await expect(
      handler(makeReq({tokenOverrides: {email_verified: false}})),
    ).rejects.toMatchObject({code: "failed-precondition"});
  });

  it("claims a fresh invitation: marks accepted and adds member", async () => {
    const inviteRef = {id: "tok-1"};
    const inviteDoc = {
      id: "tok-1",
      ref: inviteRef,
      get: (k: string) => (
        {
          appId: "spertahp",
          modelId: "model-A",
          role: "editor",
          isVoting: true,
          modelName: "My Model",
          expiresAt: futureTs,
        } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});

    const modelRef = {id: "model-A"};
    fakeDoc.mockReturnValueOnce(modelRef);

    fakeTx.get
      .mockResolvedValueOnce({
        // re-read of invite inside transaction
        exists: true,
        get: (k: string) => (k === "status" ? "pending" : undefined),
      })
      .mockResolvedValueOnce({
        // re-read of model
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          collaborators: [{userId: "uid-owner", role: "owner",
            isVoting: true}],
          responses: {},
        }),
      });

    const out = await handler(makeReq());

    expect(out.claimed).toEqual([
      {appId: "spertahp", modelId: "model-A", modelName: "My Model"},
    ]);
    expect(fakeTx.update).toHaveBeenCalledWith(
      modelRef,
      expect.objectContaining({"members.uid-claim": "editor"}),
    );
    expect(fakeTx.update).toHaveBeenCalledWith(
      inviteRef,
      expect.objectContaining({status: "accepted"}),
    );
  });

  it("CFD: claims with members.{uid} only — no collaborators or responses " +
    "writes when model doc has no collaborators field",
  async () => {
    const inviteRef = {id: "tok-cfd"};
    const inviteDoc = {
      id: "tok-cfd",
      ref: inviteRef,
      get: (k: string) => (
        {
          appId: "spertcfd",
          modelId: "project-Z",
          role: "editor",
          isVoting: false,
          modelName: "My CFD Project",
          expiresAt: futureTs,
        } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});

    const modelRef = {id: "project-Z"};
    fakeDoc.mockReturnValueOnce(modelRef);

    fakeTx.get
      .mockResolvedValueOnce({
        exists: true,
        get: (k: string) => (k === "status" ? "pending" : undefined),
      })
      .mockResolvedValueOnce({
        // CFD model doc shape — no `collaborators` field at all.
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
        }),
      });

    const out = await handler(makeReq());

    expect(out.claimed).toEqual([
      {appId: "spertcfd", modelId: "project-Z", modelName: "My CFD Project"},
    ]);
    // The model-update payload is the second arg to tx.update for the
    // model ref. It must contain members.{uid} but MUST NOT contain
    // collaborators or any responses.{uid} write.
    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => c[0] === modelRef,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected modelUpdateCall to be defined");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(update["members.uid-claim"]).toBe("editor");
    expect(update.collaborators).toBeUndefined();
    expect(update["responses.uid-claim"]).toBeUndefined();
    // Routes to the CFD project collection.
    expect(fakeDb.collection).toHaveBeenCalledWith("spertcfd_projects");
    expect(lastCollectionName).toBe("spertcfd_projects");
  });

  it("ganttapp claim update omits collaborators and responses for " +
    "members-only schema",
  async () => {
    const inviteRef = {id: "tok-gantt"};
    const inviteDoc = {
      id: "tok-gantt",
      ref: inviteRef,
      get: (k: string) => (
        {
          appId: "ganttapp",
          modelId: "project-G",
          role: "editor",
          isVoting: false,
          modelName: "My Gantt Project",
          expiresAt: futureTs,
        } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});

    const modelRef = {id: "project-G"};
    fakeDoc.mockReturnValueOnce(modelRef);

    fakeTx.get
      .mockResolvedValueOnce({
        exists: true,
        get: (k: string) => (k === "status" ? "pending" : undefined),
      })
      .mockResolvedValueOnce({
        // GanttApp model doc shape — no `collaborators` field at all.
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
        }),
      });

    const out = await handler(makeReq());

    expect(out.claimed).toEqual([
      {appId: "ganttapp", modelId: "project-G", modelName: "My Gantt Project"},
    ]);
    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => c[0] === modelRef,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected modelUpdateCall to be defined");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(update["members.uid-claim"]).toBe("editor");
    expect(update.collaborators).toBeUndefined();
    expect(update["responses.uid-claim"]).toBeUndefined();
    // Routes to the GanttApp project collection.
    expect(fakeDb.collection).toHaveBeenCalledWith("ganttapp_projects");
    expect(lastCollectionName).toBe("ganttapp_projects");
  });

  it("spertforecaster claim update omits collaborators and responses for " +
    "members-only schema",
  async () => {
    const inviteRef = {id: "tok-forecaster"};
    const inviteDoc = {
      id: "tok-forecaster",
      ref: inviteRef,
      get: (k: string) => (
        {
          appId: "spertforecaster",
          modelId: "project-F",
          role: "editor",
          isVoting: false,
          modelName: "My Forecaster Project",
          expiresAt: futureTs,
        } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});

    const modelRef = {id: "project-F"};
    fakeDoc.mockReturnValueOnce(modelRef);

    fakeTx.get
      .mockResolvedValueOnce({
        exists: true,
        get: (k: string) => (k === "status" ? "pending" : undefined),
      })
      .mockResolvedValueOnce({
        // Forecaster model doc shape — no `collaborators` field at all.
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
        }),
      });

    const out = await handler(makeReq());

    expect(out.claimed).toEqual([
      {
        appId: "spertforecaster",
        modelId: "project-F",
        modelName: "My Forecaster Project",
      },
    ]);
    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => c[0] === modelRef,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected modelUpdateCall to be defined");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(update["members.uid-claim"]).toBe("editor");
    expect(update.collaborators).toBeUndefined();
    expect(update["responses.uid-claim"]).toBeUndefined();
    // Routes to the Forecaster project collection.
    expect(fakeDb.collection).toHaveBeenCalledWith("spertforecaster_projects");
    expect(lastCollectionName).toBe("spertforecaster_projects");
  });

  it("spertstorymap claim update omits collaborators and responses for " +
    "members-as-security-index schema",
  async () => {
    const inviteRef = {id: "tok-storymap"};
    const inviteDoc = {
      id: "tok-storymap",
      ref: inviteRef,
      get: (k: string) => (
        {
          appId: "spertstorymap",
          modelId: "project-S",
          role: "editor",
          isVoting: false,
          modelName: "My Story Map Project",
          expiresAt: futureTs,
        } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});

    const modelRef = {id: "project-S"};
    fakeDoc.mockReturnValueOnce(modelRef);

    fakeTx.get
      .mockResolvedValueOnce({
        exists: true,
        get: (k: string) => (k === "status" ? "pending" : undefined),
      })
      .mockResolvedValueOnce({
        // Story Map model doc shape (Shape A) — owner field plus members map
        // doubling as the security index. No `collaborators`, no `responses`.
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          schemaVersion: 2,
        }),
      });

    const out = await handler(makeReq());

    expect(out.claimed).toEqual([
      {
        appId: "spertstorymap",
        modelId: "project-S",
        modelName: "My Story Map Project",
      },
    ]);
    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => c[0] === modelRef,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected modelUpdateCall to be defined");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(update["members.uid-claim"]).toBe("editor");
    expect(update.collaborators).toBeUndefined();
    expect(update["responses.uid-claim"]).toBeUndefined();
    // Routes to the Story Map project collection.
    expect(fakeDb.collection).toHaveBeenCalledWith("spertstorymap_projects");
    expect(lastCollectionName).toBe("spertstorymap_projects");
  });

  it("spertscheduler claim update omits collaborators and responses for " +
    "members-as-security-index schema",
  async () => {
    const inviteRef = {id: "tok-scheduler"};
    const inviteDoc = {
      id: "tok-scheduler",
      ref: inviteRef,
      get: (k: string) => (
        {
          appId: "spertscheduler",
          modelId: "project-SCH",
          role: "editor",
          isVoting: false,
          modelName: "My Scheduler Project",
          expiresAt: futureTs,
        } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});

    const modelRef = {id: "project-SCH"};
    fakeDoc.mockReturnValueOnce(modelRef);

    // Shape A fixture — owner field plus members map; no `collaborators`
    // array, no `responses` map (those are AHP-specific and must NOT
    // appear in Scheduler fixtures).
    const schedulerProjectFixture = {
      owner: "uid-owner",
      members: {"uid-owner": "owner"},
    } as Record<string, unknown>;
    expect(schedulerProjectFixture.collaborators).toBeUndefined();
    expect(schedulerProjectFixture.responses).toBeUndefined();

    fakeTx.get
      .mockResolvedValueOnce({
        exists: true,
        get: (k: string) => (k === "status" ? "pending" : undefined),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => schedulerProjectFixture,
      });

    const out = await handler(makeReq());

    expect(out.claimed).toEqual([
      {
        appId: "spertscheduler",
        modelId: "project-SCH",
        modelName: "My Scheduler Project",
      },
    ]);
    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => c[0] === modelRef,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected modelUpdateCall to be defined");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(update["members.uid-claim"]).toBe("editor");
    expect(update.collaborators).toBeUndefined();
    expect(update["responses.uid-claim"]).toBeUndefined();
    // Routes to the Scheduler project collection.
    expect(fakeDb.collection).toHaveBeenCalledWith("spertscheduler_projects");
    expect(lastCollectionName).toBe("spertscheduler_projects");
  });

  it("idempotently accepts when caller is already a member", async () => {
    const inviteRef = {id: "tok-2"};
    const inviteDoc = {
      id: "tok-2",
      ref: inviteRef,
      get: (k: string) => (
        {
          appId: "spertahp",
          modelId: "model-B",
          role: "viewer",
          isVoting: false,
          modelName: "Model B",
          expiresAt: futureTs,
        } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});
    fakeDoc.mockReturnValueOnce({id: "model-B"});

    fakeTx.get
      .mockResolvedValueOnce({
        exists: true,
        get: () => "pending",
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner", "uid-claim": "editor"},
          collaborators: [],
          responses: {},
        }),
      });

    const out = await handler(makeReq());

    expect(out.claimed).toHaveLength(1);
    // The model-doc update for adding members should NOT be called —
    // only the invite-doc accepted update.
    expect(fakeTx.update).toHaveBeenCalledWith(
      inviteRef,
      expect.objectContaining({status: "accepted"}),
    );
  });

  it("marks invite expired when model has been deleted", async () => {
    const inviteRef = {id: "tok-3"};
    const inviteDoc = {
      id: "tok-3",
      ref: inviteRef,
      get: (k: string) => (
        {
          appId: "spertahp",
          modelId: "ghost",
          role: "editor",
          isVoting: true,
          modelName: "Gone",
          expiresAt: futureTs,
        } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});
    fakeDoc.mockReturnValueOnce({id: "ghost"});

    fakeTx.get
      .mockResolvedValueOnce({
        exists: true,
        get: () => "pending",
      })
      .mockResolvedValueOnce({
        exists: false,
        data: () => ({}),
      });

    const out = await handler(makeReq());

    expect(out.claimed).toEqual([]);
    expect(fakeTx.update).toHaveBeenCalledWith(
      inviteRef,
      expect.objectContaining({status: "expired"}),
    );
  });

  it("skips unsupported-app invitations without reading arbitrary " +
    "collections",
  async () => {
    const inviteDoc = {
      id: "tok-rogue",
      ref: {id: "tok-rogue"},
      get: (k: string) => (
          {
            appId: "evil_collection",
            modelId: "x",
            role: "editor",
            isVoting: true,
            modelName: "Rogue",
            expiresAt: futureTs,
          } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});

    const out = await handler(makeReq());

    expect(out.claimed).toEqual([]);
    expect(fakeDb.runTransaction).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// PC-2 (Brief 19) — the project-doc `updatedAt` is an ISO 8601 string.
//
// This function has FOUR `updatedAt` writes and exactly one converts: the
// project-doc update. The other three are invitation-doc writes and keep
// serverTimestamp(). The second test pins that boundary, because the defect
// Brief 19 fixed was precisely one-of-N converted.
//
// The regex is load-bearing: `FieldValue.serverTimestamp` is mocked in this
// file to return the literal "<serverTimestamp>", which is a string. A
// `typeof === "string"` assertion would have passed BEFORE the change.
// ─────────────────────────────────────────────────────────────────────────
const ISO_8601_MS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe("claimPendingInvitations updatedAt convergence (PC-2)", () => {
  it("writes updatedAt to the project doc as an ISO 8601 string, and leaves " +
    "the invitation doc on serverTimestamp()",
  async () => {
    const inviteRef = {id: "tok-iso"};
    const inviteDoc = {
      id: "tok-iso",
      ref: inviteRef,
      get: (k: string) => (
        {
          appId: "spertcfd",
          modelId: "model-ISO",
          role: "editor",
          isVoting: false,
          modelName: "ISO Project",
          expiresAt: futureTs,
        } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});

    const modelRef = {id: "model-ISO"};
    fakeDoc.mockReturnValueOnce(modelRef);

    fakeTx.get
      .mockResolvedValueOnce({
        exists: true,
        get: (k: string) => (k === "status" ? "pending" : undefined),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({owner: "uid-owner", members: {"uid-owner": "owner"}}),
      });

    await handler(makeReq());

    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)["members.uid-claim"] !==
        undefined,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected the project-doc update to have been called");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(typeof update.updatedAt).toBe("string");
    expect(update.updatedAt as string).toMatch(ISO_8601_MS_UTC);
    expect(new Date(update.updatedAt as string).toISOString())
      .toBe(update.updatedAt);

    // The invitation-doc write in the SAME transaction is out of scope and
    // deliberately still a server timestamp.
    const inviteUpdateCall = fakeTx.update.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>).status === "accepted",
    );
    if (!inviteUpdateCall) {
      throw new Error("Expected the invitation-doc update to have been called");
    }
    expect((inviteUpdateCall[1] as Record<string, unknown>).updatedAt)
      .toBe("<serverTimestamp>");
  });
});


// ─────────────────────────────────────────────────────────────────────────
// WI-1 (v2.5.34) — the provider gate.
//
// Firebase records every `microsoft.com` sign-in as `email_verified: false`,
// so the gate accepts that provider unverified and refuses every other
// unverified identity.
//
// PC1 and PC2 are ONE token shape — `email_verified: false` plus a complete
// `firebase` claim — differing only in the `sign_in_provider` string. That is
// the only construction under which PC2's refusal is attributable to the
// provider VALUE: a token with no `firebase` claim at all is refused too, but
// for a reason no real token can have. The third test pins that fail-closed
// branch separately and by name, so it can never be mistaken for PC2.
// ─────────────────────────────────────────────────────────────────────────
describe("claimPendingInvitations provider gate (WI-1)", () => {
  const unverifiedTokenFor = (provider: string): unknown => makeReq({
    tokenOverrides: {email_verified: false, firebase: firebaseClaim(provider)},
  });

  it("PC1: microsoft.com with email_verified: false CLAIMS — members.{uid} " +
    "written and the invitation marked accepted",
  async () => {
    const inviteRef = {id: "tok-ms"};
    const inviteDoc = {
      id: "tok-ms",
      ref: inviteRef,
      get: (k: string) => (
        {
          appId: "myscrumbudget",
          modelId: "project-MSB",
          role: "editor",
          isVoting: false,
          modelName: "Sprint Budget",
          expiresAt: futureTs,
        } as Record<string, unknown>
      )[k],
    };
    queryChain.get.mockResolvedValueOnce({docs: [inviteDoc]});

    const modelRef = {id: "project-MSB"};
    fakeDoc.mockReturnValueOnce(modelRef);

    fakeTx.get
      .mockResolvedValueOnce({
        exists: true,
        get: (k: string) => (k === "status" ? "pending" : undefined),
      })
      .mockResolvedValueOnce({
        // MyScrumBudget project shape — owner plus members map, nothing else.
        exists: true,
        data: () => ({owner: "uid-owner", members: {"uid-owner": "owner"}}),
      });

    const out = await handler(unverifiedTokenFor("microsoft.com"));

    expect(out.claimed).toEqual([
      {appId: "myscrumbudget", modelId: "project-MSB", modelName: "Sprint Budget"},
    ]);
    expect(fakeTx.update).toHaveBeenCalledWith(
      modelRef,
      expect.objectContaining({"members.uid-claim": "editor"}),
    );
    expect(fakeTx.update).toHaveBeenCalledWith(
      inviteRef,
      expect.objectContaining({status: "accepted", acceptedByUid: "uid-claim"}),
    );
    expect(lastCollectionName).toBe("myscrumbudget_projects");
  });

  it("PC2: password with email_verified: false — the SAME token shape, only " +
    "the provider string differs — is refused with failed-precondition " +
    "before any Firestore read",
  async () => {
    let caught: unknown;
    try {
      await handler(unverifiedTokenFor("password"));
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({code: "failed-precondition"});
    const {message} = caught as {message: string};
    expect(message).toContain("Google or Microsoft");
    // The old text advised "a Microsoft work or school account" — the exact
    // case that was failing. Pinned so it cannot come back.
    expect(message).not.toMatch(/work or school/);
    expect(queryChain.get).not.toHaveBeenCalled();
    expect(fakeDb.runTransaction).not.toHaveBeenCalled();
  });

  it("a token with NO firebase claim — a shape no real token has — fails " +
    "CLOSED with failed-precondition, not a TypeError",
  async () => {
    await expect(
      handler(makeReq({
        tokenOverrides: {email_verified: false, firebase: undefined},
      })),
    ).rejects.toMatchObject({code: "failed-precondition"});
  });
});
