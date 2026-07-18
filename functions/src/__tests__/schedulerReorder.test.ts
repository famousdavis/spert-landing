// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

// scheduler_reorder_activities is an unexported inline closure registered via
// server.tool() inside registerSchedulerTools. These tests use the capture shim
// (like schedulerBulkImport.test.ts): a fake McpServer records each handler
// by name, then call the reorder handler directly with a mock db and a mocked
// ../mcp/session, exercising the queue-time read gate + prechecks + envelope
// (criterion 2) without a live Firestore. The client owns the authoritative
// drain-time apply.

jest.mock("../mcp/session", () => ({
  getSession: jest.fn(),
  touchSession: jest.fn(),
  writeOpBatch: jest.fn(),
  isBrowserConnected: jest.fn(),
}));

jest.mock("../mcp/rateLimit", () => ({
  checkSessionWriteLimit: jest.fn(() => true),
}));

jest.mock("firebase-functions/logger", () => ({
  warn: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  log: jest.fn(),
  debug: jest.fn(),
}));

import type {DocumentData} from "firebase-admin/firestore";
import {getSession, writeOpBatch, isBrowserConnected} from "../mcp/session";
import {registerSchedulerTools} from "../mcp/tools/scheduler";

const mockGetSession =
  getSession as jest.MockedFunction<typeof getSession>;
const mockWriteOpBatch =
  writeOpBatch as jest.MockedFunction<typeof writeOpBatch>;
const mockIsBrowserConnected =
  isBrowserConnected as jest.MockedFunction<typeof isBrowserConnected>;

type ToolResult = {content: Array<{type: string; text: string}>};
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

const SID = "00000000-0000-4000-8000-000000000000";

/**
 * Build a session doc stub with the given Read-Mode consent flag.
 * @param {boolean} consentRead Whether Read Mode is granted.
 * @return {DocumentData} A session-shaped stub.
 */
function session(consentRead: boolean): DocumentData {
  return {consentRead, connected: {browser: true}} as unknown as DocumentData;
}

/**
 * Build a mock db whose snapshot chain returns a project with one scenario
 * carrying the given activity ids and dependency-mode flag. When
 * `dependencyMode` is omitted, the key is ABSENT from the snapshot scenario
 * (the malformed/legacy case — affectsDates must default to true).
 * @param {object} opts scenarioId, dependencyMode, activityIds for scenario.
 * @return {{db: object, snapshotGet: jest.Mock}} Mock db + the snapshot spy.
 */
function makeDb(opts: {
  scenarioId?: string;
  dependencyMode?: boolean;
  activityIds?: string[];
}): {db: object; snapshotGet: jest.Mock} {
  const scenario: Record<string, unknown> = {
    id: opts.scenarioId ?? "s1",
    activities: (opts.activityIds ?? ["a", "b", "c"]).map((id) => ({id})),
  };
  if (opts.dependencyMode !== undefined) {
    scenario.dependencyMode = opts.dependencyMode;
  }
  const snapshotGet = jest.fn(async () => ({
    exists: true,
    data: () => ({project: {scenarios: [scenario]}}),
  }));
  const db = {
    collection: jest.fn(() => ({
      doc: jest.fn(() => ({
        collection: jest.fn(() => ({doc: jest.fn(() => ({get: snapshotGet}))})),
      })),
    })),
  };
  return {db, snapshotGet};
}

/**
 * Register scheduler tools against a capturing fake McpServer and return the
 * scheduler_reorder_activities handler bound to the given db.
 * @param {object} db Mock db injected into registerSchedulerTools.
 * @return {Handler} The scheduler_reorder_activities tool handler.
 */
function reorderHandler(db: object): Handler {
  const handlers: Record<string, Handler> = {};
  const fakeServer = {
    tool: (...toolArgs: unknown[]) => {
      const name = toolArgs[0] as string;
      handlers[name] = toolArgs[toolArgs.length - 1] as Handler;
    },
  };
  registerSchedulerTools(
    fakeServer as unknown as Parameters<typeof registerSchedulerTools>[0],
    db as Parameters<typeof registerSchedulerTools>[1],
  );
  return handlers["scheduler_reorder_activities"];
}

/**
 * Invoke the reorder handler and parse its JSON envelope.
 * @param {object} db Mock db for the handler.
 * @param {Record<string, unknown>} args Tool arguments.
 * @return {Promise<Record<string, unknown>>} The parsed response body.
 */
async function call(
  db: object,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await reorderHandler(db)(args);
  return JSON.parse(result.content[0].text);
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockWriteOpBatch.mockReset();
  mockIsBrowserConnected.mockReset();
  mockWriteOpBatch.mockResolvedValue({firstSeq: 7, lastSeq: 7});
  mockIsBrowserConnected.mockReturnValue(true);
});

describe("scheduler_reorder_activities — affectsDates polarity", () => {
  test("sequential mode → affectsDates true + sequential message", async () => {
    mockGetSession.mockResolvedValue(session(true));
    const {db} = makeDb({scenarioId: "s1", dependencyMode: false});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      orderedActivityIds: ["c", "b", "a"],
    });
    expect(res.status).toBe("success");
    expect(res.affectsDates).toBe(true);
    expect(res.packed).toBe(3);
    expect(res.message).toContain("reordering CHANGES");
    expect(res.message).toContain("start/finish dates");
    expect(mockWriteOpBatch).toHaveBeenCalledTimes(1);
    const ops = mockWriteOpBatch.mock.calls[0][2] as Array<{op: string}>;
    expect(ops[0].op).toBe("reorder_activities");
  });

  test("dependency mode → affectsDates false + display message", async () => {
    mockGetSession.mockResolvedValue(session(true));
    const {db} = makeDb({scenarioId: "s1", dependencyMode: true});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      orderedActivityIds: ["c", "b", "a"],
    });
    expect(res.status).toBe("success");
    expect(res.affectsDates).toBe(false);
    expect(res.message).toContain("DISPLAY ORDER ONLY");
    expect(res.message).toContain("no dates move");
  });

  test("absent dependencyMode → affectsDates true (finding 7)", async () => {
    // A malformed/legacy snapshot scenario with no dependencyMode key:
    // !undefined === true → default to the sequential (dates-move) message.
    mockGetSession.mockResolvedValue(session(true));
    const {db} = makeDb({scenarioId: "s1", activityIds: ["a", "b", "c"]});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      orderedActivityIds: ["b", "a", "c"],
    });
    expect(res.status).toBe("success");
    expect(res.affectsDates).toBe(true);
    expect(res.message).toContain("reordering CHANGES");
  });

  test("disconnected browser → the reopen-frame message", async () => {
    mockGetSession.mockResolvedValue(session(true));
    mockIsBrowserConnected.mockReturnValue(false);
    const {db} = makeDb({scenarioId: "s1", dependencyMode: true});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      orderedActivityIds: ["c", "b", "a"],
    });
    expect(res.status).toBe("success");
    expect(res.browserConnected).toBe(false);
    expect(res.message).toContain("applies when the user reopens");
  });
});

describe("scheduler_reorder_activities — prechecks + gate", () => {
  test("duplicate id → invalid_order, nothing written", async () => {
    mockGetSession.mockResolvedValue(session(true));
    const {db} = makeDb({scenarioId: "s1", activityIds: ["a", "b", "c"]});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      orderedActivityIds: ["a", "a", "b"],
    });
    expect(res.status).toBe("error");
    expect(res.error).toBe("invalid_order");
    expect(res.message).toContain("a");
    expect(res.message).toContain("verify after"); // staleness hedge
    expect(mockWriteOpBatch).not.toHaveBeenCalled();
  });

  test("set mismatch (extra id) → stale_order, nothing written", async () => {
    mockGetSession.mockResolvedValue(session(true));
    const {db} = makeDb({scenarioId: "s1", activityIds: ["a", "b", "c"]});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      orderedActivityIds: ["a", "b", "x"], // equal length, x is not live
    });
    expect(res.status).toBe("error");
    expect(res.error).toBe("stale_order");
    expect(res.message).toContain("unexpected: x");
    expect(res.message).toContain("verify after");
    expect(mockWriteOpBatch).not.toHaveBeenCalled();
  });

  test("length mismatch (missing id) → stale_order", async () => {
    mockGetSession.mockResolvedValue(session(true));
    const {db} = makeDb({scenarioId: "s1", activityIds: ["a", "b", "c", "d"]});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      orderedActivityIds: ["c", "b", "a"], // missing d
    });
    expect(res.status).toBe("error");
    expect(res.error).toBe("stale_order");
    expect(res.message).toContain("missing: d");
    expect(mockWriteOpBatch).not.toHaveBeenCalled();
  });

  test("Read Mode off → read_not_permitted, snapshot not read", async () => {
    mockGetSession.mockResolvedValue(session(false));
    const {db, snapshotGet} = makeDb({scenarioId: "s1"});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      orderedActivityIds: ["c", "b", "a"],
    });
    expect(res.status).toBe("read_not_permitted");
    expect(res.error).toBeUndefined(); // field-less refusal envelope (the norm)
    expect(snapshotGet).not.toHaveBeenCalled();
    expect(mockWriteOpBatch).not.toHaveBeenCalled();
  });

  test("unknown scenario → scenario_not_found, nothing written", async () => {
    mockGetSession.mockResolvedValue(session(true));
    const {db} = makeDb({scenarioId: "s1"});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "sX", // not in the snapshot
      orderedActivityIds: ["c", "b", "a"],
    });
    expect(res.status).toBe("error");
    expect(res.error).toBe("scenario_not_found");
    expect(mockWriteOpBatch).not.toHaveBeenCalled();
  });
});
