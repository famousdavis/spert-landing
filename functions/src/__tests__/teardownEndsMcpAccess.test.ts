// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// End-to-end: an MCP tool call must FAIL once teardownAiSession has run.
//
// This is the server side of SPERT Story Map's B-04 fix: signing out calls
// teardownAiSession, after which the externally paired AI must lose access.
// The suite had no test that ran teardownAiSession and then called a tool —
// forecasterTools "refuses a missing session" and resolveSessionCode test 6
// only simulate an already-absent session. This runs the REAL onCall handler
// against the same in-memory Firestore the REAL Story Map tools read, so it
// proves teardown's deletion is what makes every later read AND write reject.

import {Timestamp} from "firebase-admin/firestore";
import type {DocumentData} from "firebase-admin/firestore";

type ToolResult = {content: Array<{type: string; text: string}>};
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

// `mock`-prefixed so the hoisted jest.mock factory may reference it.
const mockState: {
  session?: DocumentData;
  snapshot?: DocumentData;
  ops: DocumentData[];
} = {ops: []};

// Refs close over mockState, so re-seeding it between tests is enough; the one
// db instance is shared by the tools (passed as a param) and teardownAiSession
// (which reads getFirestore()), so teardown's deletes are visible to the tools.
const snapshotCurrentRef = {
  kind: "snapshot" as const,
  get: async () => ({
    exists: mockState.snapshot !== undefined,
    data: () => mockState.snapshot,
  }),
  update: async () => undefined,
};
const snapshotCol = {
  doc: () => snapshotCurrentRef,
  listDocuments: async () =>
    mockState.snapshot !== undefined ? [snapshotCurrentRef] : [],
};
const opsCol = {
  doc: () => ({kind: "op" as const}),
  listDocuments: async () => mockState.ops.map(() => ({kind: "op" as const})),
};
const sessionRef = {
  kind: "session" as const,
  get: async () => ({
    exists: mockState.session !== undefined,
    data: () => mockState.session,
  }),
  update: async (patch: DocumentData) => {
    if (mockState.session) mockState.session = {...mockState.session, ...patch};
  },
  collection: (name: string) => (name === "ops" ? opsCol : snapshotCol),
};
const sessionCol = {doc: () => sessionRef};

const mockDb = {
  collection: () => sessionCol,
  runTransaction: async (
    fn: (tx: {
      get: (ref: unknown) => Promise<{exists: boolean; data: () => unknown}>;
      update: (ref: unknown, data: DocumentData) => void;
      set: (ref: unknown, data: DocumentData) => void;
    }) => Promise<unknown>,
  ): Promise<unknown> =>
    fn({
      get: async () => ({
        exists: mockState.session !== undefined,
        data: () => mockState.session,
      }),
      update: (_ref, patch) => {
        if (mockState.session) {
          mockState.session = {...mockState.session, ...patch};
        }
      },
      set: (_ref, data) => {
        mockState.ops.push(data);
      },
    }),
  batch: () => {
    const deletions: Array<{kind: string}> = [];
    return {
      delete: (ref: {kind: string}) => {
        deletions.push(ref);
      },
      commit: async () => {
        for (const ref of deletions) {
          if (ref.kind === "session") mockState.session = undefined;
          else if (ref.kind === "snapshot") mockState.snapshot = undefined;
          else if (ref.kind === "op") mockState.ops = [];
        }
      },
    };
  },
};

jest.mock("firebase-admin/firestore", () => {
  const actual = jest.requireActual("firebase-admin/firestore");
  return {
    ...actual,
    FieldValue: {serverTimestamp: jest.fn(() => "<serverTimestamp>")},
    getFirestore: jest.fn(() => mockDb),
  };
});

import {teardownAiSession} from "../mcp/teardown";
import {registerStorymapTools} from "../mcp/tools/storymap";

const teardownHandler = (
  teardownAiSession as unknown as {
    run: (req: unknown) => Promise<{status: string; deletedDocs: number}>;
  }
).run;

const SID = "123e4567-e89b-42d3-a456-426614174000";

const tools = new Map<string, Handler>();
const captureServer = {
  tool: (...args: unknown[]): void => {
    tools.set(args[0] as string, args[args.length - 1] as Handler);
  },
};
// registerStorymapTools(server, db) — the db double stands in for Firestore.
registerStorymapTools(
  captureServer as never,
  mockDb as never,
);

/**
 * Invoke a captured tool handler and parse its JSON envelope body.
 * @param {string} name The tool name.
 * @param {Record<string, unknown>} args The handler arguments.
 * @return {Promise<Record<string, unknown>>} The parsed response body.
 */
async function call(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await (tools.get(name) as Handler)(args);
  return JSON.parse(res.content[0].text);
}

beforeEach(() => {
  // A live, writable, Read-Mode storymap session with a snapshot and one op.
  mockState.session = {
    appId: "storymap",
    consentRead: true,
    consentWrite: true,
    lastSeq: 1,
    browserConnectedAt: Timestamp.now(),
    // expiresAt omitted → getSession treats the session as live.
  };
  mockState.snapshot = {product: {id: "p1", themes: []}};
  mockState.ops = [{seq: 1, op: "create_theme", payload: {}}];
});

describe("an MCP tool call fails after teardownAiSession (B-04 server side)", () => {
  it("serves reads and writes while the session is live (control)", async () => {
    const read = await call("storymap_get_project", {sessionId: SID});
    expect(read.status).toBe("ok");

    const write = await call("storymap_create_theme", {
      sessionId: SID,
      themeId: "t-1",
      name: "Theme One",
    });
    expect(write.status).toBe("success");
  });

  it("rejects every read AND write once teardownAiSession has run", async () => {
    // Precondition: the session resolves before teardown.
    const before = await call("storymap_get_project", {sessionId: SID});
    expect(before.status).toBe("ok");

    // Run the REAL teardown Cloud Function against the shared Firestore.
    const result = await teardownHandler({data: {sessionId: SID}});
    expect(result.status).toBe("ok");
    expect(result.deletedDocs).toBeGreaterThanOrEqual(1);
    // The relay data is gone.
    expect(mockState.session).toBeUndefined();
    expect(mockState.snapshot).toBeUndefined();

    // A read now fails: getSession returns null → sessionNotFound().
    const read = await call("storymap_get_project", {sessionId: SID});
    expect(read.status).toBe("error");
    expect(read.error).toBe("session_not_found");

    // A write now fails too: getSession is null, and writeOpBatch's transaction
    // would also throw session_not_found — the AI client sees the same refusal.
    const write = await call("storymap_create_theme", {
      sessionId: SID,
      themeId: "t-2",
      name: "Theme Two",
    });
    expect(write.status).toBe("error");
    expect(write.error).toBe("session_not_found");
  });
});
