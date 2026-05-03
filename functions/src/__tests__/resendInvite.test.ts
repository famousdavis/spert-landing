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

// ===== Firestore mock =====
const fakeTx = {
  get: jest.fn(),
  set: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

const invitationsDocGet = jest.fn();
const invitationsDocRef = {id: "tok-1", get: invitationsDocGet};
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
      increment: jest.fn((n: number) => `<increment:${n}>`),
    },
    getFirestore: jest.fn(() => fakeDb),
  };
});

import {resendInvite} from "../resendInvite";

const handler = (
  resendInvite as unknown as {
    run: (req: unknown) => Promise<{resent: true; emailSendCount: number}>;
  }
).run;

/**
 * Build a fake CallableRequest for handler.run().
 * @param {Record<string, unknown>} overrides Optional sub-objects to merge.
 * @return {unknown} A v2 CallableRequest-shaped object.
 */
function makeReq(overrides: Record<string, unknown> = {}): unknown {
  const origin = (overrides.origin as string | undefined) ?? "";
  return {
    auth: {
      uid: "uid-owner",
      token: {email: "alice@example.com"},
    },
    rawRequest: {headers: {origin: origin}},
    data: {
      tokenId: "tok-1",
      ...((overrides.dataOverrides as Record<string, unknown>) ?? {}),
    },
  };
}

interface SnapStub {
  exists: boolean;
  get: (k: string) => unknown;
}

/**
 * Build a default invitation snapshot suitable for the
 * pre-transaction read. Override individual fields per test via the
 * overrides arg.
 *
 * @param {Record<string, unknown>} overrides Field overrides.
 * @return {SnapStub} Snap stub.
 */
function inviteSnap(
  overrides: Record<string, unknown> = {},
): SnapStub {
  const fields: Record<string, unknown> = {
    inviterUid: "uid-owner",
    status: "pending",
    emailSendCount: 1,
    inviteeEmail: "new@example.com",
    inviterName: "Alice Owner",
    inviterEmail: "alice@example.com",
    modelName: "MyModel",
    ...overrides,
  };
  return {
    exists: true,
    get: (k: string) => fields[k],
  };
}

beforeEach(() => {
  resendSend.mockReset();
  resendSend.mockResolvedValue({data: {id: "mock_id"}, error: null});

  fakeTx.get.mockReset();
  fakeTx.set.mockReset();
  fakeTx.update.mockReset();
  fakeTx.delete.mockReset();
  fakeDb.runTransaction.mockClear();
  fakeDb.collection.mockClear();
  invitationsDocGet.mockReset();
  invitationsDoc.mockClear();
});

describe("resendInvite validation", () => {
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
});

describe("resendInvite ownership + state", () => {
  it("throws not-found when invitation doc missing", async () => {
    invitationsDocGet.mockResolvedValueOnce({
      exists: false,
      get: () => undefined,
    });
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "not-found",
    });
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("throws permission-denied when caller is not the inviter", async () => {
    invitationsDocGet.mockResolvedValueOnce(
      inviteSnap({inviterUid: "someone-else"}),
    );
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "permission-denied",
    });
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("throws failed-precondition when status is accepted", async () => {
    invitationsDocGet.mockResolvedValueOnce(
      inviteSnap({status: "accepted"}),
    );
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "failed-precondition",
    });
    expect(resendSend).not.toHaveBeenCalled();
  });

  it("throws failed-precondition when status is revoked", async () => {
    invitationsDocGet.mockResolvedValueOnce(
      inviteSnap({status: "revoked"}),
    );
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "failed-precondition",
    });
    expect(resendSend).not.toHaveBeenCalled();
  });
});

describe("resendInvite resend cap", () => {
  it("throws resource-exhausted when emailSendCount === 5", async () => {
    invitationsDocGet.mockResolvedValueOnce(
      inviteSnap({emailSendCount: 5}),
    );
    await expect(handler(makeReq())).rejects.toMatchObject({
      code: "resource-exhausted",
    });
    expect(resendSend).not.toHaveBeenCalled();
    expect(fakeTx.update).not.toHaveBeenCalled();
  });

  it("throws resource-exhausted when emailSendCount > 5 (defensive)",
    async () => {
      invitationsDocGet.mockResolvedValueOnce(
        inviteSnap({emailSendCount: 7}),
      );
      await expect(handler(makeReq())).rejects.toMatchObject({
        code: "resource-exhausted",
      });
      expect(resendSend).not.toHaveBeenCalled();
    });
});

describe("resendInvite happy path", () => {
  it("sends, increments emailSendCount, stamps lastEmailSentAt",
    async () => {
      invitationsDocGet.mockResolvedValueOnce(
        inviteSnap({emailSendCount: 2}),
      );
      // Post-send tx: re-read, still pending.
      fakeTx.get.mockResolvedValueOnce(
        inviteSnap({emailSendCount: 2}),
      );

      const out = await handler(makeReq());

      expect(out).toEqual({resent: true, emailSendCount: 3});
      expect(resendSend).toHaveBeenCalledTimes(1);
      expect(fakeTx.update).toHaveBeenCalledWith(
        invitationsDocRef,
        expect.objectContaining({
          emailSendCount: "<increment:1>",
          lastEmailSentAt: "<serverTimestamp>",
          updatedAt: "<serverTimestamp>",
        }),
      );

      const fromAddr = resendSend.mock.calls[0][0].from as string;
      expect(fromAddr).toContain("invitations@spertsuite.com");
      expect(fromAddr).not.toContain("noreply@");
    });

  it("succeeds (no increment) if invite was revoked between pre-check and tx",
    async () => {
      invitationsDocGet.mockResolvedValueOnce(
        inviteSnap({emailSendCount: 1}),
      );
      // Post-send tx: status flipped to revoked.
      fakeTx.get.mockResolvedValueOnce(
        inviteSnap({status: "revoked", emailSendCount: 1}),
      );

      const out = await handler(makeReq());

      // Email already sent → success surfaced; counter NOT incremented.
      expect(out).toEqual({resent: true, emailSendCount: 2});
      expect(resendSend).toHaveBeenCalledTimes(1);
      expect(fakeTx.update).not.toHaveBeenCalled();
    });
});

describe("resendInvite Resend errors", () => {
  it("Resend envelope error → internal HttpsError, no increment",
    async () => {
      invitationsDocGet.mockResolvedValueOnce(
        inviteSnap({emailSendCount: 1}),
      );
      resendSend.mockResolvedValueOnce({
        data: null,
        error: {name: "internal_server_error", message: "mock failure"},
      });

      await expect(handler(makeReq())).rejects.toMatchObject({
        code: "internal",
      });

      expect(fakeTx.update).not.toHaveBeenCalled();
      expect(fakeDb.runTransaction).not.toHaveBeenCalled();
    });
});

describe("resendInvite urlBase resolution", () => {
  it("uses an allowlisted origin (localhost:5176)", async () => {
    invitationsDocGet.mockResolvedValueOnce(inviteSnap());
    fakeTx.get.mockResolvedValueOnce(inviteSnap());

    // Reach into the @react-email/render mock to inspect props.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {render: mockedRender} = require("@react-email/render");
    (mockedRender as jest.Mock).mockClear();

    await handler(makeReq({origin: "http://localhost:5176"}));

    const calls = (mockedRender as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const element = calls[0][0] as { props: { urlBase: string } };
    expect(element.props.urlBase).toBe("http://localhost:5176");
  });

  it("falls back to prod when the origin is unknown", async () => {
    invitationsDocGet.mockResolvedValueOnce(inviteSnap());
    fakeTx.get.mockResolvedValueOnce(inviteSnap());

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {render: mockedRender} = require("@react-email/render");
    (mockedRender as jest.Mock).mockClear();

    await handler(makeReq({origin: "http://evil.com"}));

    const calls = (mockedRender as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const element = calls[0][0] as { props: { urlBase: string } };
    expect(element.props.urlBase).toBe("https://ahp.spertsuite.com");
  });

  it("falls back to prod when the origin header is missing", async () => {
    invitationsDocGet.mockResolvedValueOnce(inviteSnap());
    fakeTx.get.mockResolvedValueOnce(inviteSnap());

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {render: mockedRender} = require("@react-email/render");
    (mockedRender as jest.Mock).mockClear();

    await handler(makeReq());

    const calls = (mockedRender as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const element = calls[0][0] as { props: { urlBase: string } };
    expect(element.props.urlBase).toBe("https://ahp.spertsuite.com");
  });
});

describe("resendInvite name normalization", () => {
  it("denormalizes Microsoft 'Last, First Middle' inviterName",
    async () => {
      invitationsDocGet.mockResolvedValueOnce(
        inviteSnap({inviterName: "Davis, William W"}),
      );
      fakeTx.get.mockResolvedValueOnce(
        inviteSnap({inviterName: "Davis, William W"}),
      );

      await handler(makeReq());

      const fromAddr = resendSend.mock.calls[0][0].from as string;
      // After denormalization the comma is gone, so no RFC 5322 quoting
      // — From line is a clean unquoted display-name.
      expect(fromAddr).toContain("William W Davis");
      expect(fromAddr).not.toContain("Davis,");
      expect(fromAddr).toContain("invitations@spertsuite.com");
    });
});
