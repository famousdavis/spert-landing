import {Timestamp} from "firebase-admin/firestore";

// ===== Resend mock =====
const resendSend = jest.fn();
jest.mock("resend", () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {send: resendSend},
  })),
}));

// ===== Secret-param mock =====
jest.mock("firebase-functions/params", () => ({
  defineSecret: jest.fn(() => ({value: () => "test-key"})),
}));

// ===== Render mock =====
jest.mock("@react-email/render", () => ({
  render: jest.fn(async () => "<html>rendered</html>"),
}));

// ===== Firestore mock — collection-name routing =====
const fakeTx = {
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const projectsDocGet = jest.fn();
const projectsDoc = jest.fn(() => ({
  id: "model-X",
  get: projectsDocGet,
}));

const invitationsQueryGet = jest.fn();
const invitationsQuery = {
  where: jest.fn().mockReturnThis(),
  get: invitationsQueryGet,
};
const invitationsDocSet = jest.fn().mockResolvedValue(undefined);
const invitationsDoc = jest.fn(() => ({set: invitationsDocSet}));

const profilesQueryGet = jest.fn();
const profilesQuery = {
  where: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  get: profilesQueryGet,
};

const rateLimitDocRef = {id: "rate-uid"};
const rateLimitDoc = jest.fn(() => rateLimitDocRef);

const throttleDocRef = {id: "throttle-x"};
const throttleDoc = jest.fn(() => throttleDocRef);

const fakeDb = {
  collection: jest.fn((name: string) => {
    if (name === "spertahp_projects") {
      return {doc: projectsDoc};
    }
    if (name === "spertsuite_invitations") {
      return {
        where: invitationsQuery.where,
        get: invitationsQuery.get,
        doc: invitationsDoc,
      };
    }
    if (name === "spertsuite_profiles") {
      return {
        where: profilesQuery.where,
        limit: profilesQuery.limit,
        get: profilesQuery.get,
      };
    }
    if (name === "spertsuite_rate_limits") {
      return {doc: rateLimitDoc};
    }
    if (name === "spertsuite_notification_throttle") {
      return {doc: throttleDoc};
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

import {sendInvitationEmail} from "../sendInvitationEmail";

const handler = (
  sendInvitationEmail as unknown as {
    run: (req: unknown) => Promise<{
      added: string[]; invited: string[]; failed: { email: string;
        reason: string; }[]; }>;
  }
).run;

/**
 * Build a fake CallableRequest for handler.run().
 * @param {Record<string, unknown>} overrides Optional sub-objects to merge
 *   into auth.token and request.data.
 * @return {unknown} A v2 CallableRequest-shaped object.
 */
function makeReq(overrides: Record<string, unknown> = {}): unknown {
  return {
    auth: {
      uid: "uid-owner",
      token: {
        name: "Alice Owner",
        email: "alice@example.com",
        ...((overrides.tokenOverrides as Record<string, unknown>) ?? {}),
      },
    },
    data: {
      appId: "spertahp",
      modelId: "model-X",
      emails: ["new@example.com"],
      role: "editor" as const,
      isVoting: true,
      ...((overrides.dataOverrides as Record<string, unknown>) ?? {}),
    },
  };
}

beforeEach(() => {
  resendSend.mockReset();
  resendSend.mockResolvedValue({data: {id: "mock_id"}, error: null});

  fakeTx.get.mockReset();
  fakeTx.set.mockReset();
  fakeTx.update.mockReset();
  fakeTx.delete.mockReset();

  projectsDocGet.mockReset();
  invitationsQueryGet.mockReset();
  invitationsDocSet.mockClear();
  profilesQueryGet.mockReset();

  // Default model doc — owner is caller, name "MyModel".
  projectsDocGet.mockResolvedValue({
    exists: true,
    data: () => ({
      owner: "uid-owner",
      members: {"uid-owner": "owner"},
      name: "MyModel",
      collaborators: [],
      responses: {},
    }),
  });

  // Default: no pending dedup hits, no profile hits.
  invitationsQueryGet.mockResolvedValue({docs: []});
  profilesQueryGet.mockResolvedValue({empty: true, docs: []});

  // Default rate-limit transaction: doc doesn't exist → fresh.
  // First fakeTx.get call comes from rateLimiter; later calls vary.
  // Tests can override.

  fakeDb.runTransaction.mockClear();
  fakeDb.collection.mockClear();
});

describe("sendInvitationEmail validation", () => {
  it("rejects unauthenticated callers", async () => {
    await expect(
      handler({...(makeReq() as object), auth: undefined}),
    ).rejects.toMatchObject({code: "unauthenticated"});
  });

  it("rejects empty emails array", async () => {
    await expect(
      handler(makeReq({dataOverrides: {emails: []}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("rejects emails array > 25", async () => {
    const big = Array.from({length: 26}, (_, i) => `e${i}@example.com`);
    await expect(
      handler(makeReq({dataOverrides: {emails: big}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("rejects bad role", async () => {
    await expect(
      handler(makeReq({dataOverrides: {role: "admin"}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("rejects non-boolean isVoting", async () => {
    await expect(
      handler(makeReq({dataOverrides: {isVoting: "yes"}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("rejects non-spertahp appId", async () => {
    await expect(
      handler(makeReq({dataOverrides: {appId: "ganttapp"}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });

  it("rejects empty modelId", async () => {
    await expect(
      handler(makeReq({dataOverrides: {modelId: ""}})),
    ).rejects.toMatchObject({code: "invalid-argument"});
  });
});

describe("sendInvitationEmail ownership", () => {
  it("rejects non-owner with permission-denied", async () => {
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "someone-else",
        members: {"someone-else": "owner", "uid-owner": "editor"},
        name: "MyModel",
      }),
    });
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "permission-denied",
    });
  });

  it("rejects when model doc is missing", async () => {
    projectsDocGet.mockResolvedValueOnce({exists: false, data: () => ({})});
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "not-found",
    });
  });
});

describe("sendInvitationEmail rate limit", () => {
  it("throws resource-exhausted when over the daily cap", async () => {
    // Rate-limit transaction reads existing count = 25; next is over.
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      get: (k: string) => {
        const today = new Date().toISOString().slice(0, 10);
        return k === "date" ? today : 25;
      },
    });

    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "resource-exhausted",
    });
  });
});

describe("sendInvitationEmail happy paths", () => {
  it("invites a brand-new email (Branch B): writes invitation doc + sends",
    async () => {
      // Rate-limit tx: fresh.
      fakeTx.get.mockResolvedValueOnce({
        exists: false,
        get: () => undefined,
      });

      const out = await handler(makeReq());

      expect(out.invited).toEqual(["new@example.com"]);
      expect(out.added).toEqual([]);
      expect(out.failed).toEqual([]);
      expect(invitationsDocSet).toHaveBeenCalledWith(
        expect.objectContaining({
          appId: "spertahp",
          modelId: "model-X",
          inviteeEmail: "new@example.com",
          role: "editor",
          status: "pending",
          emailSendCount: 1,
        }),
      );
      expect(resendSend).toHaveBeenCalledTimes(1);
    });

  it("auto-adds an existing user (Branch A): updates model + notifies",
    async () => {
      // Rate-limit tx: fresh.
      fakeTx.get.mockResolvedValueOnce({
        exists: false,
        get: () => undefined,
      });

      // Profile found.
      profilesQueryGet.mockResolvedValueOnce({
        empty: false,
        docs: [{id: "uid-existing", data: () => ({})}],
      });

      // Branch A transaction: re-read model — owner OK, member absent.
      fakeTx.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          collaborators: [],
          responses: {},
        }),
      });

      // Throttle transaction: throttle doc absent → send notification.
      fakeTx.get.mockResolvedValueOnce({
        exists: false,
        get: () => undefined,
      });

      const out = await handler(makeReq({
        dataOverrides: {emails: ["existing@example.com"]},
      }));

      expect(out.added).toEqual(["existing@example.com"]);
      expect(out.invited).toEqual([]);

      // Model update applied with members + collaborators + response.
      expect(fakeTx.update).toHaveBeenCalledWith(
        expect.objectContaining({id: "model-X"}),
        expect.objectContaining({
          "members.uid-existing": "editor",
          "responses.uid-existing": expect.objectContaining({
            userId: "uid-existing",
            status: "in_progress",
          }),
        }),
      );

      // Notification sent.
      expect(resendSend).toHaveBeenCalledTimes(1);
    });
});

describe("sendInvitationEmail dedup", () => {
  it("flags already-invited when a pending invite exists for (modelId, email)",
    async () => {
      // Rate-limit tx: fresh.
      fakeTx.get.mockResolvedValueOnce({
        exists: false,
        get: () => undefined,
      });

      invitationsQueryGet.mockResolvedValueOnce({
        docs: [{
          get: (k: string) => k === "modelId" ? "model-X" : undefined,
        }],
      });

      const out = await handler(makeReq());

      expect(out.failed).toEqual([
        {email: "new@example.com", reason: "already-invited"},
      ]);
      expect(invitationsDocSet).not.toHaveBeenCalled();
      expect(resendSend).not.toHaveBeenCalled();
    });
});

describe("sendInvitationEmail notification throttle", () => {
  it("does NOT send a second notification within 24h",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      }); // rate limit fresh

      profilesQueryGet.mockResolvedValueOnce({
        empty: false,
        docs: [{id: "uid-existing", data: () => ({})}],
      });

      fakeTx.get.mockResolvedValueOnce({
        // model re-read for branch A
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          collaborators: [],
          responses: {},
        }),
      });

      fakeTx.get.mockResolvedValueOnce({
        // throttle doc — recent (1 hour ago)
        exists: true,
        get: (k: string) => k === "lastNotifiedAt" ?
          Timestamp.fromMillis(Date.now() - 3_600_000) :
          undefined,
      });

      await handler(makeReq({
        dataOverrides: {emails: ["existing@example.com"]},
      }));

      // Throttle should NOT call tx.set on the throttle doc.
      // (It was called only zero times since throttle was active.)
      // But model.update for the auto-add still happens.
      expect(resendSend).not.toHaveBeenCalled();
    });

  it("DOES send a notification after the 24h window resets",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });

      profilesQueryGet.mockResolvedValueOnce({
        empty: false,
        docs: [{id: "uid-existing", data: () => ({})}],
      });

      fakeTx.get.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          collaborators: [],
          responses: {},
        }),
      });

      fakeTx.get.mockResolvedValueOnce({
        // throttle doc — > 24h ago
        exists: true,
        get: (k: string) => k === "lastNotifiedAt" ?
          Timestamp.fromMillis(Date.now() - 25 * 3_600_000) :
          undefined,
      });

      await handler(makeReq({
        dataOverrides: {emails: ["existing@example.com"]},
      }));

      expect(resendSend).toHaveBeenCalledTimes(1);
    });
});

describe("sendInvitationEmail Resend errors", () => {
  it("Resend envelope error → send-failed in failed[], not a batch throw",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });

      resendSend.mockResolvedValueOnce({
        data: null,
        error: {name: "internal_server_error", message: "mock failure"},
      });

      const out = await handler(makeReq());

      expect(out.invited).toEqual([]);
      expect(out.failed).toEqual([
        {email: "new@example.com", reason: "send-failed"},
      ]);
    });
});

describe("sendInvitationEmail invalid-email filter", () => {
  it("flags invalid-email without calling Resend or writing invitations",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });

      const out = await handler(
        makeReq({dataOverrides: {emails: ["not-an-email"]}}),
      );

      expect(out.failed).toEqual([
        {email: "not-an-email", reason: "invalid-email"},
      ]);
      expect(invitationsDocSet).not.toHaveBeenCalled();
      expect(resendSend).not.toHaveBeenCalled();
    });
});
