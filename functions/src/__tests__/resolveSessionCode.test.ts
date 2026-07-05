// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

// resolve_session_code is an unexported inline closure registered via
// server.tool() inside registerSharedSessionTools. These tests use a capture
// shim: a fake McpServer records each tool handler by name, then we call
// the resolve_session_code handler directly with a configurable mock db.
//
// Mock strategy (Option B): a per-test mock for the pairing_codes
// collection plus a file-level mock of ../mcp/session, so getSession is
// driven to a live session or null without an anonymous_sessions store.

jest.mock("../mcp/session", () => ({
  getSession: jest.fn(),
  touchSession: jest.fn(),
  writeOpBatch: jest.fn(),
  isBrowserConnected: jest.fn(),
}));

jest.mock("firebase-functions/logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
  debug: jest.fn(),
}));

import {getSession} from "../mcp/session";
import {registerSharedSessionTools} from "../mcp/tools/shared";

const mockGetSession = getSession as jest.MockedFunction<typeof getSession>;

type ToolResult = {content: Array<{type: string; text: string}>};
type Handler = (args: {code: string}) => Promise<ToolResult>;
type Snap = {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
};

/**
 * Build a minimal Firestore DocumentSnapshot stub.
 * @param {Record<string, unknown> | null} data Document data, or null to
 *   represent a non-existent document.
 * @return {Snap} A snapshot-shaped object exposing exists and data().
 */
function snap(data: Record<string, unknown> | null): Snap {
  return {
    exists: data !== null,
    data: () => (data === null ? undefined : data),
  };
}

/**
 * Build a mock db for the pairing_codes collection with independently
 * configurable plain-read and transaction-read snapshots.
 * @param {object} opts Snapshot config (getSnap, getReject, txSnap).
 * @return {{db: object, txUpdate: jest.Mock}} The mock db plus the
 *   tx.update spy for asserting writes.
 */
function makeDb(opts: {
  getSnap?: Snap;
  getReject?: Error;
  txSnap?: Snap;
}): {db: object; txUpdate: jest.Mock} {
  const txUpdate = jest.fn();
  const fakeTx = {
    get: jest.fn(async () => opts.txSnap ?? opts.getSnap),
    update: txUpdate,
  };
  const ref = {
    get: jest.fn(async () => {
      if (opts.getReject) throw opts.getReject;
      return opts.getSnap;
    }),
  };
  const db = {
    collection: jest.fn((name: string) => {
      if (name !== "pairing_codes") {
        throw new Error("unexpected collection: " + name);
      }
      return {doc: jest.fn(() => ref)};
    }),
    runTransaction: jest.fn(
      async (fn: (tx: typeof fakeTx) => unknown) => fn(fakeTx),
    ),
  };
  return {db, txUpdate};
}

/**
 * Register the shared session tools against a capturing fake McpServer and
 * return the resolve_session_code handler bound to the given db.
 * @param {object} db Mock db injected into registerSharedSessionTools.
 * @return {Handler} The resolve_session_code tool handler.
 */
function resolveHandler(db: object): Handler {
  const handlers: Record<string, Handler> = {};
  const fakeServer = {
    tool: (...toolArgs: unknown[]) => {
      const name = toolArgs[0] as string;
      handlers[name] = toolArgs[toolArgs.length - 1] as Handler;
    },
  };
  registerSharedSessionTools(
    fakeServer as unknown as Parameters<typeof registerSharedSessionTools>[0],
    db as Parameters<typeof registerSharedSessionTools>[1],
  );
  return handlers["resolve_session_code"];
}

/**
 * Invoke the resolve_session_code handler and parse its JSON payload.
 * @param {object} db Mock db for the handler.
 * @param {string} code The pairing code argument.
 * @return {Promise<Record<string, unknown>>} The parsed response body.
 */
async function call(
  db: object,
  code: string,
): Promise<Record<string, unknown>> {
  const result = await resolveHandler(db)({code});
  return JSON.parse(result.content[0].text);
}

const FUTURE = {toDate: () => new Date(Date.now() + 60_000)};
const PAST = {toDate: () => new Date(Date.now() - 60_000)};
const SID = "11111111-1111-1111-1111-111111111111";
const SUCCESS_MSG =
  "Session resolved. Call get_session_info to learn which project is open.";

beforeEach(() => {
  mockGetSession.mockReset();
});

describe("resolve_session_code idempotency", () => {
  test("1: unknown code returns code_not_found", async () => {
    const {db} = makeDb({getSnap: snap(null)});
    const body = await call(db, "UNKNOWN-0000");
    expect(body.status).toBe("error");
    expect(body.error).toBe("code_not_found");
  });

  test("2: expired code (used:false) returns code_expired", async () => {
    const {db} = makeDb({
      getSnap: snap({expiresAt: PAST, used: false, sessionId: SID}),
    });
    const body = await call(db, "CRANE-0001");
    expect(body.error).toBe("code_expired");
  });

  test("3: expired code (used:true) returns code_expired and never " +
    "calls getSession", async () => {
    const {db} = makeDb({
      getSnap: snap({expiresAt: PAST, used: true, sessionId: SID}),
    });
    const body = await call(db, "CRANE-0002");
    expect(body.error).toBe("code_expired");
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  test("4: valid unused code is claimed and writes used:true", async () => {
    const {db, txUpdate} = makeDb({
      getSnap: snap({expiresAt: FUTURE, used: false, sessionId: SID}),
    });
    const body = await call(db, "CRANE-0003");
    expect(body.status).toBe("ok");
    expect(body.sessionId).toBe(SID);
    expect(txUpdate).toHaveBeenCalledWith(expect.anything(), {used: true});
  });

  test("5: valid used code with a live session re-confirms with no write",
    async () => {
      mockGetSession.mockResolvedValue({consentWrite: true});
      const {db, txUpdate} = makeDb({
        getSnap: snap({expiresAt: FUTURE, used: true, sessionId: SID}),
      });
      const body = await call(db, "CRANE-0004");
      expect(body.status).toBe("ok");
      expect(body.sessionId).toBe(SID);
      expect(body.message).toBe(SUCCESS_MSG);
      expect(txUpdate).not.toHaveBeenCalled();
    });

  test("6: valid used code with an ended session returns " +
    "session_not_found", async () => {
    mockGetSession.mockResolvedValue(null);
    const {db} = makeDb({
      getSnap: snap({expiresAt: FUTURE, used: true, sessionId: SID}),
    });
    const body = await call(db, "CRANE-0005");
    expect(body.status).toBe("error");
    expect(body.error).toBe("session_not_found");
  });

  test("7: race loser (plain used:false, tx used:true) succeeds with no " +
    "write", async () => {
    const {db, txUpdate} = makeDb({
      getSnap: snap({expiresAt: FUTURE, used: false, sessionId: SID}),
      txSnap: snap({expiresAt: FUTURE, used: true, sessionId: SID}),
    });
    const body = await call(db, "CRANE-0006");
    expect(body.status).toBe("ok");
    expect(body.sessionId).toBe(SID);
    expect(body.message).toBe(SUCCESS_MSG);
    expect(txUpdate).not.toHaveBeenCalled();
  });

  test("8: missing expiresAt is treated as expired (fail-closed)",
    async () => {
      const {db} = makeDb({getSnap: snap({used: false, sessionId: SID})});
      const body = await call(db, "CRANE-0007");
      expect(body.error).toBe("code_expired");
    });

  test("8b: non-Timestamp expiresAt is expired without throwing",
    async () => {
      const {db} = makeDb({
        getSnap: snap({expiresAt: "2026-01-01", used: false}),
      });
      const body = await call(db, "CRANE-0008");
      expect(body.status).toBe("error");
      expect(body.error).toBe("code_expired");
    });

  test("9: doc deleted before the tx re-read returns code_not_found",
    async () => {
      const {db, txUpdate} = makeDb({
        getSnap: snap({expiresAt: FUTURE, used: false, sessionId: SID}),
        txSnap: snap(null),
      });
      const body = await call(db, "CRANE-0009");
      expect(body.status).toBe("error");
      expect(body.error).toBe("code_not_found");
      expect(txUpdate).not.toHaveBeenCalled();
    });

  test("10: a transient ref.get() error returns internal", async () => {
    const {db} = makeDb({getReject: new Error("firestore unavailable")});
    const body = await call(db, "CRANE-0010");
    expect(body.status).toBe("error");
    expect(body.error).toBe("internal");
  });
});
