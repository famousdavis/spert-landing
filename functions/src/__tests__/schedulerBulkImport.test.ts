// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

// scheduler_bulk_import is an unexported inline closure registered via
// server.tool() inside registerSchedulerTools. These tests use the capture shim
// (mirroring resolveSessionCode.test.ts): a fake McpServer records each handler
// by name, then we call the bulk-import handler directly with a mock db and a
// mocked ../mcp/session, exercising the composite queue-time gates (Phase 2 §3,
// criterion 3) without a live Firestore. The client-side drain behavior
// (per-item cascades, outcome aggregation) is covered by the scheduler repo.

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
 * Build a mock db whose snapshot chain returns a project carrying one scenario
 * with the given dependency-mode flag. `snapshotGet` is exposed so a test can
 * assert the snapshot was (or was not) read.
 * @param {object} opts scenarioId + dependencyMode for the snapshot scenario.
 * @return {{db: object, snapshotGet: jest.Mock}} Mock db + the snapshot spy.
 */
function makeDb(opts: {
  scenarioId?: string;
  dependencyMode?: boolean;
}): {db: object; snapshotGet: jest.Mock} {
  const snapshotGet = jest.fn(async () => ({
    exists: true,
    data: () => ({
      project: {
        scenarios: [
          {
            id: opts.scenarioId ?? "s1",
            dependencyMode: opts.dependencyMode ?? false,
            activities: [],
          },
        ],
      },
    }),
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
 * scheduler_bulk_import handler bound to the given db.
 * @param {object} db Mock db injected into registerSchedulerTools.
 * @return {Handler} The scheduler_bulk_import tool handler.
 */
function importHandler(db: object): Handler {
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
  return handlers["scheduler_bulk_import"];
}

/**
 * Invoke the bulk-import handler and parse its JSON envelope.
 * @param {object} db Mock db for the handler.
 * @param {Record<string, unknown>} args Tool arguments.
 * @return {Promise<Record<string, unknown>>} The parsed response body.
 */
async function call(
  db: object,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const result = await importHandler(db)(args);
  return JSON.parse(result.content[0].text);
}

const activity = {id: "a0", name: "A0", min: 1, mostLikely: 2, max: 3};
const milestone = {id: "m0", name: "M0", targetDate: "2025-03-01"};
const edge = {fromActivityId: "a0", toActivityId: "a1"};

beforeEach(() => {
  mockGetSession.mockReset();
  mockWriteOpBatch.mockReset();
  mockIsBrowserConnected.mockReset();
  mockWriteOpBatch.mockResolvedValue({firstSeq: 1, lastSeq: 1});
  mockIsBrowserConnected.mockReturnValue(true);
});

describe("scheduler_bulk_import — queue-time gates (criterion 3)", () => {
  test("all sections absent → empty_import, nothing written", async () => {
    mockGetSession.mockResolvedValue(session(true));
    const {db} = makeDb({});
    const res = await call(db, {sessionId: SID});
    expect(res.status).toBe("error");
    expect(res.error).toBe("empty_import");
    expect(mockWriteOpBatch).not.toHaveBeenCalled();
  });

  test("deps without scenarioId → refused", async () => {
    mockGetSession.mockResolvedValue(session(true));
    const {db, snapshotGet} = makeDb({});
    const res = await call(db, {sessionId: SID, dependencies: [edge]});
    expect(res.status).toBe("error");
    expect(res.error).toBe("scenario_required_for_dependencies");
    // Refused before the snapshot gate and before any write.
    expect(snapshotGet).not.toHaveBeenCalled();
    expect(mockWriteOpBatch).not.toHaveBeenCalled();
  });

  test("deps + mode OFF → whole-call refusal, nothing written", async () => {
    mockGetSession.mockResolvedValue(session(true));
    const {db} = makeDb({scenarioId: "s1", dependencyMode: false});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      activities: [activity],
      dependencies: [edge],
    });
    expect(res.status).toBe("error");
    expect(res.error).toBe("dependency_mode_off");
    expect(mockWriteOpBatch).not.toHaveBeenCalled();
  });

  test("deps + Read Mode OFF → read_not_permitted", async () => {
    mockGetSession.mockResolvedValue(session(false));
    const {db} = makeDb({scenarioId: "s1", dependencyMode: true});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      dependencies: [edge],
    });
    expect(res.status).toBe("read_not_permitted");
    expect(mockWriteOpBatch).not.toHaveBeenCalled();
  });

  test("deps + mode ON → packed, one composite op written", async () => {
    mockGetSession.mockResolvedValue(session(true));
    const {db} = makeDb({scenarioId: "s1", dependencyMode: true});
    const res = await call(db, {
      sessionId: SID,
      scenarioId: "s1",
      activities: [activity],
      milestones: [milestone],
      dependencies: [edge],
    });
    expect(res.status).toBe("success");
    expect(res.packed).toEqual({
      activities: 1,
      milestones: 1,
      assignments: 0,
      dependencies: 1,
    });
    expect(res.packedTotal).toBe(3);
    expect(mockWriteOpBatch).toHaveBeenCalledTimes(1);
    const ops = mockWriteOpBatch.mock.calls[0][2] as Array<{op: string}>;
    expect(ops).toHaveLength(1);
    expect(ops[0].op).toBe("bulk_import_schedule");
  });

  test("no deps → ungated path (no Read Mode), one op written", async () => {
    // consentRead false proves the no-deps path skips the snapshot gate.
    mockGetSession.mockResolvedValue(session(false));
    const {db, snapshotGet} = makeDb({});
    const res = await call(db, {
      sessionId: SID,
      activities: [activity],
      milestones: [milestone],
    });
    expect(res.status).toBe("success");
    expect(res.packed).toEqual({
      activities: 1,
      milestones: 1,
      assignments: 0,
      dependencies: 0,
    });
    expect(res.packedTotal).toBe(2);
    expect(snapshotGet).not.toHaveBeenCalled();
    expect(mockWriteOpBatch).toHaveBeenCalledTimes(1);
  });
});
