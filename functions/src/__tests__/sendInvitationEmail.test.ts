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
// Track which appId-derived collection was last looked up so per-test
// assertions can verify CFD vs AHP routing.
let lastProjectsCollection: string | null = null;
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
    // Multi-app: any `<appId>_projects` collection routes to the
    // shared projectsDoc mock so a single test can drive AHP or CFD.
    if (name.endsWith("_projects")) {
      lastProjectsCollection = name;
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

import {render as mockedRender} from "@react-email/render";
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
  const origin = (overrides.origin as string | undefined) ?? "";
  return {
    auth: {
      uid: "uid-owner",
      token: {
        name: "Alice Owner",
        email: "alice@example.com",
        ...((overrides.tokenOverrides as Record<string, unknown>) ?? {}),
      },
    },
    rawRequest: {
      headers: {
        origin: origin,
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

  (mockedRender as jest.Mock).mockClear();

  fakeTx.get.mockReset();
  fakeTx.set.mockReset();
  fakeTx.update.mockReset();
  fakeTx.delete.mockReset();

  projectsDocGet.mockReset();
  invitationsQueryGet.mockReset();
  invitationsDocSet.mockClear();
  profilesQueryGet.mockReset();
  lastProjectsCollection = null;

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

  it("accepts ganttapp as a valid appId", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    // GanttApp project docs follow the same members-only schema as CFD —
    // no `collaborators` array, no `responses` map.
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        name: "MyGanttProject",
      }),
    });
    await expect(
      handler(makeReq({dataOverrides: {appId: "ganttapp"}})),
    ).resolves.toMatchObject({invited: ["new@example.com"]});
    expect(lastProjectsCollection).toBe("ganttapp_projects");
  });

  it("accepts spertahp", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    await expect(
      handler(makeReq({dataOverrides: {appId: "spertahp"}})),
    ).resolves.toMatchObject({invited: ["new@example.com"]});
  });

  it("accepts spertcfd", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    // CFD model docs have no `collaborators` array — just members.
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        name: "MyCfdProject",
      }),
    });
    await expect(
      handler(makeReq({dataOverrides: {appId: "spertcfd"}})),
    ).resolves.toMatchObject({invited: ["new@example.com"]});
    expect(lastProjectsCollection).toBe("spertcfd_projects");
  });

  it("accepts spertforecaster as a valid appId", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    // Forecaster project docs follow the same members-only schema as CFD
    // and GanttApp — no `collaborators` array, no `responses` map.
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        name: "MyForecasterProject",
      }),
    });
    await expect(
      handler(makeReq({dataOverrides: {appId: "spertforecaster"}})),
    ).resolves.toMatchObject({invited: ["new@example.com"]});
    expect(lastProjectsCollection).toBe("spertforecaster_projects");
  });

  it("accepts spertscheduler as a valid appId", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    // Scheduler project docs follow Shape A — `members` map doubles as the
    // security index. No `collaborators` array, no `responses` map (those
    // are AHP-specific and must NOT appear in Scheduler fixtures).
    const schedulerProjectFixture = {
      owner: "uid-owner",
      members: {"uid-owner": "owner"},
      name: "MySchedulerProject",
    } as Record<string, unknown>;
    expect(schedulerProjectFixture.collaborators).toBeUndefined();
    expect(schedulerProjectFixture.responses).toBeUndefined();
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => schedulerProjectFixture,
    });
    await expect(
      handler(makeReq({dataOverrides: {appId: "spertscheduler"}})),
    ).resolves.toMatchObject({invited: ["new@example.com"]});
    expect(lastProjectsCollection).toBe("spertscheduler_projects");
  });

  it("accepts myscrumbudget as a valid appId", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    // MyScrumBudget project docs follow Shape A — `members` map doubles as
    // the security index (owner UID duplicated into `members` with role
    // 'owner'; matches firestoreRepo.ts:151 in the MSB app). No
    // `collaborators` array, no `responses` map (those are AHP-specific
    // and must NOT appear in MSB fixtures).
    const msbProjectFixture = {
      owner: "uid-owner",
      members: {"uid-owner": "owner"},
      name: "MyMsbProject",
    } as Record<string, unknown>;
    expect(msbProjectFixture.collaborators).toBeUndefined();
    expect(msbProjectFixture.responses).toBeUndefined();
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => msbProjectFixture,
    });
    await expect(
      handler(makeReq({dataOverrides: {appId: "myscrumbudget"}})),
    ).resolves.toMatchObject({invited: ["new@example.com"]});
    expect(lastProjectsCollection).toBe("myscrumbudget_projects");
  });

  it("accepts owner with members-as-security-index (spertstorymap schema)",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });
      // Story Map's Firestore schema (Shape A): `members` doubles as the
      // security index — every UID with access (including the owner and any
      // editors) is enumerated in the map. The Cloud Function must trust the
      // top-level `owner` field for the ownership check; the editor entry is
      // present here purely to confirm a non-empty members map is accepted.
      projectsDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {
            "uid-owner": "owner",
            "uid-editor": "editor",
          },
          name: "Test Story Map Project",
          schemaVersion: 2,
        }),
      });
      await expect(
        handler(makeReq({dataOverrides: {appId: "spertstorymap"}})),
      ).resolves.toMatchObject({invited: ["new@example.com"]});
      expect(lastProjectsCollection).toBe("spertstorymap_projects");
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

  it("accepts owner with empty members map (Forecaster schema)", async () => {
    // Regression for SPERT Forecaster v0.26.0 production bug: Forecaster's
    // schema treats `owner` and `members` as orthogonal — owner UID lives in
    // the top-level `owner` field only, never duplicated into `members`. The
    // canonical owner check must trust the `owner` field alone.
    fakeTx.get.mockResolvedValueOnce({exists: false, get: () => undefined});
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {},
        name: "ForecasterProject",
      }),
    });
    await expect(
      handler(makeReq({dataOverrides: {appId: "spertforecaster"}})),
    ).resolves.toMatchObject({invited: ["new@example.com"]});
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
      const fromAddr = resendSend.mock.calls[0][0].from as string;
      expect(fromAddr).toContain("invitations@spertsuite.com");
      expect(fromAddr).not.toContain("noreply@");
      expect(fromAddr).toContain("via SPERT AHP");
      const subject = resendSend.mock.calls[0][0].subject as string;
      expect(subject).toContain("in SPERT AHP");
    });

  it("CFD: persists appId='spertcfd' on the invitation doc and brands " +
    "From + subject as SPERT CFD",
  async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        name: "MyCfdProject",
      }),
    });

    const out = await handler(makeReq({
      dataOverrides: {appId: "spertcfd"},
    }));

    expect(out.invited).toEqual(["new@example.com"]);
    expect(invitationsDocSet).toHaveBeenCalledWith(
      expect.objectContaining({appId: "spertcfd"}),
    );
    const fromAddr = resendSend.mock.calls[0][0].from as string;
    expect(fromAddr).toContain("via SPERT CFD");
    const subject = resendSend.mock.calls[0][0].subject as string;
    expect(subject).toContain("in SPERT CFD");
    expect(lastProjectsCollection).toBe("spertcfd_projects");
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
      const fromAddr = resendSend.mock.calls[0][0].from as string;
      expect(fromAddr).toContain("invitations@spertsuite.com");
      expect(fromAddr).not.toContain("noreply@");
    });

  it("CFD auto-add: writes only members.{uid} (no collaborators array, " +
    "no response slot) when the model doc has no collaborators field",
  async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    // Pre-tx model doc — CFD shape, no collaborators.
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        name: "MyCfdProject",
      }),
    });
    profilesQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [{id: "uid-existing", data: () => ({})}],
    });
    // Branch A re-read — also no collaborators.
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
      }),
    });
    // Throttle doc absent — notification will fire.
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });

    const out = await handler(makeReq({
      dataOverrides: {
        appId: "spertcfd",
        emails: ["existing@example.com"],
      },
    }));

    expect(out.added).toEqual(["existing@example.com"]);
    // Verify the model update includes members but NOT collaborators
    // or responses. The update payload is the second argument to
    // tx.update; pull the model-update call (the one with the matching
    // members.{uid} key) and inspect it.
    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)["members.uid-existing"] !==
        undefined,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected modelUpdateCall to be defined");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(update["members.uid-existing"]).toBe("editor");
    expect(update.collaborators).toBeUndefined();
    expect(update["responses.uid-existing"]).toBeUndefined();
    expect(lastProjectsCollection).toBe("spertcfd_projects");
  });

  it("spertforecaster update contains members.{uid} but neither " +
    "collaborators nor responses.{uid}",
  async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    // Pre-tx model doc — Forecaster shape, no collaborators.
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        name: "MyForecasterProject",
      }),
    });
    profilesQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [{id: "uid-existing", data: () => ({})}],
    });
    // Branch A re-read — also no collaborators.
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
      }),
    });
    // Throttle doc absent — notification will fire.
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });

    const out = await handler(makeReq({
      dataOverrides: {
        appId: "spertforecaster",
        emails: ["existing@example.com"],
      },
    }));

    expect(out.added).toEqual(["existing@example.com"]);
    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)["members.uid-existing"] !==
        undefined,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected modelUpdateCall to be defined");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(update["members.uid-existing"]).toBe("editor");
    expect(update.collaborators).toBeUndefined();
    expect(update["responses.uid-existing"]).toBeUndefined();
    expect(lastProjectsCollection).toBe("spertforecaster_projects");
  });

  it("spertstorymap update contains members.{uid} but neither " +
    "collaborators nor responses.{uid}",
  async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    // Pre-tx model doc — Story Map shape (Shape A): owner field plus members
    // map; no `collaborators` array, no `responses` map.
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        name: "Test Story Map Project",
        schemaVersion: 2,
      }),
    });
    profilesQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [{id: "uid-existing", data: () => ({})}],
    });
    // Branch A re-read — also no collaborators.
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
      }),
    });
    // Throttle doc absent — notification will fire.
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });

    const out = await handler(makeReq({
      dataOverrides: {
        appId: "spertstorymap",
        emails: ["existing@example.com"],
      },
    }));

    expect(out.added).toEqual(["existing@example.com"]);
    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)["members.uid-existing"] !==
        undefined,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected modelUpdateCall to be defined");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(update["members.uid-existing"]).toBe("editor");
    expect(update.collaborators).toBeUndefined();
    expect(update["responses.uid-existing"]).toBeUndefined();
    expect(lastProjectsCollection).toBe("spertstorymap_projects");
  });

  it("spertscheduler update contains members.{uid} but neither " +
    "collaborators nor responses.{uid}",
  async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    // Pre-tx model doc — Scheduler shape (Shape A): owner field plus members
    // map; no `collaborators` array, no `responses` map.
    const schedulerProjectFixture = {
      owner: "uid-owner",
      members: {"uid-owner": "owner"},
      name: "Test Scheduler Project",
    } as Record<string, unknown>;
    expect(schedulerProjectFixture.collaborators).toBeUndefined();
    expect(schedulerProjectFixture.responses).toBeUndefined();
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => schedulerProjectFixture,
    });
    profilesQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [{id: "uid-existing", data: () => ({})}],
    });
    // Branch A re-read — also no collaborators.
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
      }),
    });
    // Throttle doc absent — notification will fire.
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });

    const out = await handler(makeReq({
      dataOverrides: {
        appId: "spertscheduler",
        emails: ["existing@example.com"],
      },
    }));

    expect(out.added).toEqual(["existing@example.com"]);
    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)["members.uid-existing"] !==
        undefined,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected modelUpdateCall to be defined");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(update["members.uid-existing"]).toBe("editor");
    expect(update.collaborators).toBeUndefined();
    expect(update["responses.uid-existing"]).toBeUndefined();
    expect(lastProjectsCollection).toBe("spertscheduler_projects");
  });

  it("ganttapp update contains members.{uid} but neither collaborators " +
    "nor responses.{uid}",
  async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    // Pre-tx model doc — GanttApp shape, no collaborators.
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        name: "MyGanttProject",
      }),
    });
    profilesQueryGet.mockResolvedValueOnce({
      empty: false,
      docs: [{id: "uid-existing", data: () => ({})}],
    });
    // Branch A re-read — also no collaborators.
    fakeTx.get.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
      }),
    });
    // Throttle doc absent — notification will fire.
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });

    const out = await handler(makeReq({
      dataOverrides: {
        appId: "ganttapp",
        emails: ["existing@example.com"],
      },
    }));

    expect(out.added).toEqual(["existing@example.com"]);
    const modelUpdateCall = fakeTx.update.mock.calls.find(
      (c) => (c[1] as Record<string, unknown>)["members.uid-existing"] !==
        undefined,
    );
    if (!modelUpdateCall) {
      throw new Error("Expected modelUpdateCall to be defined");
    }
    const update = modelUpdateCall[1] as Record<string, unknown>;
    expect(update["members.uid-existing"]).toBe("editor");
    expect(update.collaborators).toBeUndefined();
    expect(update["responses.uid-existing"]).toBeUndefined();
    expect(lastProjectsCollection).toBe("ganttapp_projects");
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

describe("sendInvitationEmail urlBase resolution", () => {
  it("uses the request origin when it is in the allowlist (Branch B)",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });

      await handler(makeReq({origin: "http://localhost:5176"}));

      const calls = (mockedRender as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const element = calls[0][0] as { props: { urlBase: string } };
      expect(element.props.urlBase).toBe("http://localhost:5176");
    });

  it("CFD: accepts http://localhost:3000 as an allowlisted origin",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });
      projectsDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          name: "MyCfdProject",
        }),
      });

      await handler(makeReq({
        origin: "http://localhost:3000",
        dataOverrides: {appId: "spertcfd"},
      }));

      const calls = (mockedRender as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const element = calls[0][0] as { props: { urlBase: string } };
      expect(element.props.urlBase).toBe("http://localhost:3000");
    });

  it("CFD: accepts http://localhost:3007 as an allowlisted origin",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });
      projectsDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          name: "MyCfdProject",
        }),
      });

      await handler(makeReq({
        origin: "http://localhost:3007",
        dataOverrides: {appId: "spertcfd"},
      }));

      const calls = (mockedRender as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const element = calls[0][0] as { props: { urlBase: string } };
      expect(element.props.urlBase).toBe("http://localhost:3007");
    });

  it("CFD: rejects an AHP dev port (5176) and falls back to CFD prod",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });
      projectsDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          name: "MyCfdProject",
        }),
      });

      await handler(makeReq({
        origin: "http://localhost:5176",
        dataOverrides: {appId: "spertcfd"},
      }));

      const calls = (mockedRender as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const element = calls[0][0] as { props: { urlBase: string } };
      expect(element.props.urlBase).toBe("https://cfd.spertsuite.com");
    });

  it("falls back to AHP prod when the AHP origin is not in the allowlist",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });

      await handler(makeReq({origin: "http://evil.com"}));

      const calls = (mockedRender as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const element = calls[0][0] as { props: { urlBase: string } };
      expect(element.props.urlBase).toBe("https://ahp.spertsuite.com");
    });

  it("falls back to AHP prod when the origin header is missing",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });

      await handler(makeReq());

      const calls = (mockedRender as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const element = calls[0][0] as { props: { urlBase: string } };
      expect(element.props.urlBase).toBe("https://ahp.spertsuite.com");
    });

  it("propagates allowed origin into AddedNotificationEmail (Branch A)",
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
        exists: false, get: () => undefined,
      });

      await handler(makeReq({
        origin: "http://localhost:5177",
        dataOverrides: {emails: ["existing@example.com"]},
      }));

      const calls = (mockedRender as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const element = calls[0][0] as { props: { urlBase: string } };
      expect(element.props.urlBase).toBe("http://localhost:5177");
    });
});

describe("sendInvitationEmail modelName resolution", () => {
  it("uses modelData.title when present (no name)", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        title: "Q3 vendor selection",
        collaborators: [],
        responses: {},
      }),
    });

    await handler(makeReq());

    expect(invitationsDocSet).toHaveBeenCalledWith(
      expect.objectContaining({modelName: "Q3 vendor selection"}),
    );
  });

  it("falls back to modelData.name when title is absent", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        name: "Legacy field",
        collaborators: [],
        responses: {},
      }),
    });

    await handler(makeReq());

    expect(invitationsDocSet).toHaveBeenCalledWith(
      expect.objectContaining({modelName: "Legacy field"}),
    );
  });

  it("falls back to \"Untitled\" when neither title nor name is set",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });
      projectsDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          collaborators: [],
          responses: {},
        }),
      });

      await handler(makeReq());

      expect(invitationsDocSet).toHaveBeenCalledWith(
        expect.objectContaining({modelName: "Untitled"}),
      );
    });

  it("prefers title over name when both are present", async () => {
    fakeTx.get.mockResolvedValueOnce({
      exists: false, get: () => undefined,
    });
    projectsDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        owner: "uid-owner",
        members: {"uid-owner": "owner"},
        title: "Real title",
        name: "Old name",
        collaborators: [],
        responses: {},
      }),
    });

    await handler(makeReq());

    expect(invitationsDocSet).toHaveBeenCalledWith(
      expect.objectContaining({modelName: "Real title"}),
    );
  });
});

describe("sendInvitationEmail body quoting (v0.29 double-quote regression)",
  () => {
    // Locks in the v0.29.4 fix: upstream must pass display-safe (CRLF
    // stripped, NOT RFC 5322-quoted) name values to the body templates.
    // The body templates supply the visible quotes around the project
    // name; if the upstream pre-quotes via sanitizeDisplayName, the body
    // ends up with ""Project, Name"" instead of "Project, Name".
    it("Branch B: passes a comma-bearing modelName to the template " +
      "WITHOUT RFC 5322 quotes",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });
      projectsDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          title: "Virtual Art Museum - Thomas, Jenny",
          collaborators: [],
          responses: {},
        }),
      });

      await handler(makeReq());

      const calls = (mockedRender as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const props = (calls[0][0] as { props: Record<string, string> }).props;
      // The template adds visible quotes around modelName; the upstream
      // must NOT pre-quote, otherwise the body shows ""…"".
      expect(props.modelName).toBe("Virtual Art Museum - Thomas, Jenny");
      expect(props.modelName.startsWith("\"")).toBe(false);
      expect(props.modelName.endsWith("\"")).toBe(false);

      // Subject template now adds literal quotes — exactly one pair,
      // regardless of whether the name has commas.
      const subject = resendSend.mock.calls[0][0].subject as string;
      expect(subject).toContain("\"Virtual Art Museum - Thomas, Jenny\"");
      expect(subject).not.toContain("\"\"Virtual");

      // From header still uses RFC 5322 quoting for the owner name when
      // it contains specials. Owner name "Alice Owner" has no specials,
      // so it is NOT quoted here.
      const fromAddr = resendSend.mock.calls[0][0].from as string;
      expect(fromAddr).toContain("Alice Owner via SPERT AHP");
    });

    it("Branch B: From header RFC 5322-quotes a comma-bearing owner name " +
      "while the body shows the un-quoted display form",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });

      // Caller's token name is the AD "Last, First" form; after
      // denormalizeLastFirst it becomes "William W Davis" — no comma —
      // so the From header passes through without RFC quoting. Use a
      // name that retains a comma after denormalization to actually
      // exercise the header-quoting path. denormalizeLastFirst on a
      // single-token "Cher" returns "Cher"; with a comma but only one
      // part after filter, it returns the trimmed source unchanged.
      // Easiest: bypass denormalization by providing a name with no
      // comma but with another RFC special — e.g. an `@` from a typo.
      const out = await handler(makeReq({
        tokenOverrides: {name: "DevOps@Acme"},
      }));
      expect(out.invited).toEqual(["new@example.com"]);

      const fromAddr = resendSend.mock.calls[0][0].from as string;
      // RFC 5322 wraps the name in quotes because of the '@'.
      expect(fromAddr).toContain("\"DevOps@Acme\" via SPERT AHP");

      const calls = (mockedRender as jest.Mock).mock.calls;
      const props = (calls[0][0] as { props: Record<string, string> }).props;
      // Body sees the raw display form — NOT the RFC-quoted form.
      expect(props.ownerName).toBe("DevOps@Acme");
    });

    it("Branch A: passes display-safe (un-quoted) modelName + ownerName " +
      "to the AddedNotificationEmail template",
    async () => {
      fakeTx.get.mockResolvedValueOnce({
        exists: false, get: () => undefined,
      });
      projectsDocGet.mockResolvedValueOnce({
        exists: true,
        data: () => ({
          owner: "uid-owner",
          members: {"uid-owner": "owner"},
          title: "Virtual Art Museum - Thomas, Jenny",
          collaborators: [],
          responses: {},
        }),
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
        exists: false, get: () => undefined,
      });

      await handler(makeReq({
        dataOverrides: {emails: ["existing@example.com"]},
      }));

      const calls = (mockedRender as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const props = (calls[0][0] as { props: Record<string, string> }).props;
      expect(props.modelName).toBe("Virtual Art Museum - Thomas, Jenny");
      expect(props.modelName.startsWith("\"")).toBe(false);

      const subject = resendSend.mock.calls[0][0].subject as string;
      expect(subject).toContain("\"Virtual Art Museum - Thomas, Jenny\"");
      expect(subject).not.toContain("\"\"Virtual");
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
