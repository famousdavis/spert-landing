// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// Two-stage collision test (Unit 0 §2.2). The MCP SDK throws on a duplicate
// tool name and the server is built fresh per request, so the shared session
// tools must be registered exactly once — by registerSharedSessionTools — and
// never again by any app's register*Tools. Stage A covers shared + storymap;
// Stage B (todo) covers scheduler, converted to a real test in Unit 3.

import {readFileSync} from "fs";
import {join} from "path";
import type {DocumentData} from "firebase-admin/firestore";
import {registerSharedSessionTools} from "../mcp/tools/shared";
import {registerStorymapTools} from "../mcp/tools/storymap";
import {registerSchedulerTools} from "../mcp/tools/scheduler";
import {registerForecasterTools} from "../mcp/tools/forecaster";

// Shared AI op-name registry (duplicated verbatim across repos; see
// ai-op-contract.json). Both op-name lists live in the fixture so a future
// contributor adding an op (see the pointer note in storymap.ts) updates one
// place, and this test guards the cross-product uniqueness invariant.
const contract: {
  ops: {[op: string]: {tool: string}};
  schedulerOps: string[];
  storymapOps: string[];
} = JSON.parse(
  readFileSync(join(__dirname, "../mcp/ai-op-contract.json"), "utf8"),
);

type SharedParams = Parameters<typeof registerSharedSessionTools>;
type StorymapParams = Parameters<typeof registerStorymapTools>;
type SchedulerParams = Parameters<typeof registerSchedulerTools>;
type ForecasterParams = Parameters<typeof registerForecasterTools>;

interface CollidingServer {
  names: Set<string>;
  server: {tool: (...args: unknown[]) => void};
}

/**
 * A fake McpServer whose tool() throws on a duplicate name, mirroring the
 * real SDK. Records every registered tool name in a Set.
 * @return {CollidingServer} The server plus its name registry.
 */
function collidingServer(): CollidingServer {
  const names = new Set<string>();
  const server = {
    tool: (...args: unknown[]): void => {
      const name = args[0] as string;
      if (names.has(name)) {
        throw new Error(`duplicate tool name: ${name}`);
      }
      names.add(name);
    },
  };
  return {names, server};
}

// Registration captures db in closures but never calls it during register.
const db = {} as unknown;

// ── Handler-invocation shim (§3.5 [4]) ───────────────────────────────────────
// The collision tests above only need tool NAMES. The appId-guard tests below
// must actually RUN each handler, which means the db double has to behave like
// Firestore: getSession() reads through it, and writeOpBatch() opens a
// transaction and appends to an "ops" subcollection. A `{}` double makes every
// handler throw a TypeError that its own catch swallows into
// {status: "error", error: "internal"} — which is never "wrong_app", so the
// assertion would fail for a reason unrelated to guard placement.

type ToolResult = {content: Array<{type: string; text: string}>};
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

interface FakeSnap {
  exists: boolean;
  data: () => DocumentData | undefined;
}

interface FakeColRef {
  doc: (id?: string) => FakeDocRef;
}

interface FakeDocRef {
  get: () => Promise<FakeSnap>;
  update: (data?: object) => Promise<void>;
  collection: (name: string) => FakeColRef;
}

interface CapturingServer {
  tools: Map<string, Handler>;
  server: {tool: (...args: unknown[]) => void};
}

/**
 * A fake McpServer that records each tool's handler by name. server.tool() is
 * called as (name, description, shape, handler), so the handler is the last
 * argument.
 * @return {CapturingServer} The server plus its name→handler map.
 */
function capturingServer(): CapturingServer {
  const tools = new Map<string, Handler>();
  const server = {
    tool: (...args: unknown[]): void => {
      tools.set(args[0] as string, args[args.length - 1] as Handler);
    },
  };
  return {tools, server};
}

/**
 * Build a Firestore double serving one session document, counting every
 * op-log write. expiresAt is deliberately ABSENT: getSession reads
 * data.expiresAt?.toDate?.(), which short-circuits to undefined when the key
 * is missing, so the session reads as live.
 * @param {DocumentData | undefined} sessionData Session doc, or undefined
 *   for a session that does not exist.
 * @return {object} The double, plus an opWrites() counter.
 */
function fakeDb(sessionData: DocumentData | undefined): {
  db: unknown;
  opWrites: () => number;
} {
  let opWrites = 0;
  const snap: FakeSnap = {
    exists: sessionData !== undefined,
    data: () => sessionData,
  };
  const docRef: FakeDocRef = {
    get: async () => snap,
    update: async () => undefined,
    collection: () => colRef,
  };
  const colRef: FakeColRef = {doc: () => docRef};
  const db = {
    collection: (): FakeColRef => colRef,
    // writeOpBatch appends via tx.set INSIDE the transaction, so without a
    // runTransaction that actually executes fn, the zero-op-write assertion
    // would pass whether or not the guard is placed correctly.
    runTransaction: async (
      fn: (tx: {
        get: (ref: unknown) => Promise<FakeSnap>;
        update: (ref: unknown, data: object) => void;
        set: (ref: unknown, data: object) => void;
      }) => Promise<unknown>,
    ): Promise<unknown> =>
      fn({
        get: async () => snap,
        update: () => undefined,
        set: () => {
          opWrites++;
        },
      }),
  };
  return {db, opWrites: () => opWrites};
}

// Distinct ids so the in-memory per-session write limiter cannot leak between
// tests. Only the control tests reach it; the guard returns first.
const SID_A = "00000000-0000-4000-8000-000000000001";
const SID_B = "00000000-0000-4000-8000-000000000002";
const SID_C = "00000000-0000-4000-8000-000000000003";
const SID_D = "00000000-0000-4000-8000-000000000004";

// Minimal per-tool arguments. Everything defaults to {sessionId}; these seven
// Scheduler tools need more because their handlers dereference an argument
// BEFORE the callee is entered — six evaluate payload.<array>.length in the
// argument list, and reorder passes orderedActivityIds through
// checkPayloadSize, which runs ahead of loadSessionOrError.
//
// The three Story Map tools with an early "nothing to update" success return
// (storymap_update_backbone, storymap_update_rib, storymap_move_rib)
// deliberately get NO updatable fields: with fields supplied they would reach
// that early return, and the check would pass without exercising the guard's
// placement at all.
const EXTRA_ARGS: Record<string, Record<string, unknown>> = {
  scheduler_bulk_create_activities: {activities: []},
  scheduler_bulk_create_dependencies: {dependencies: [], scenarioId: "s1"},
  scheduler_bulk_create_milestones: {milestones: []},
  scheduler_bulk_assign_milestones: {assignments: []},
  scheduler_bulk_update_activities: {updates: []},
  scheduler_bulk_append_notes: {notes: []},
  scheduler_reorder_activities: {scenarioId: "s1", orderedActivityIds: []},
};

/**
 * Register both apps' tools against a capturing server and a session double.
 * @param {DocumentData | undefined} sessionData The session document.
 * @return {object} The captured handlers, plus the op-write counter.
 */
function registerBothApps(sessionData: DocumentData | undefined): {
  tools: Map<string, Handler>;
  opWrites: () => number;
} {
  const {tools, server} = capturingServer();
  const {db: fake, opWrites} = fakeDb(sessionData);
  registerStorymapTools(
    server as unknown as StorymapParams[0],
    fake as StorymapParams[1],
  );
  registerSchedulerTools(
    server as unknown as SchedulerParams[0],
    fake as SchedulerParams[1],
  );
  return {tools, opWrites};
}

/**
 * Invoke a captured handler and parse its JSON envelope body.
 * @param {Map<string, Handler>} tools Captured handlers.
 * @param {string} name Tool name.
 * @param {string} sessionId Session id to pass.
 * @return {Promise<Record<string, unknown>>} The parsed body.
 */
async function callTool(
  tools: Map<string, Handler>,
  name: string,
  sessionId: string,
): Promise<Record<string, unknown>> {
  const handler = tools.get(name) as Handler;
  const res = await handler({sessionId, ...(EXTRA_ARGS[name] ?? {})});
  return JSON.parse(res.content[0].text);
}

describe("MCP tool registration collision", () => {
  test("Stage A: shared + storymap register without a duplicate", () => {
    const {names, server} = collidingServer();
    expect(() => {
      registerSharedSessionTools(
        server as unknown as SharedParams[0],
        db as SharedParams[1],
      );
      registerStorymapTools(
        server as unknown as StorymapParams[0],
        db as StorymapParams[1],
      );
    }).not.toThrow();
    expect(names.has("resolve_session_code")).toBe(true);
    expect(names.has("get_session_info")).toBe(true);
    expect(names.has("storymap_append_rib_note")).toBe(true);
    expect(names.has("storymap_bulk_append_rib_notes")).toBe(true);
  });

  test("registerStorymapTools does not re-register the shared tools", () => {
    const {names, server} = collidingServer();
    registerStorymapTools(
      server as unknown as StorymapParams[0],
      db as StorymapParams[1],
    );
    expect(names.has("resolve_session_code")).toBe(false);
    expect(names.has("get_session_info")).toBe(false);
  });

  test(
    "Stage B: shared + storymap + scheduler register without collision",
    () => {
      const {names, server} = collidingServer();
      expect(() => {
        registerSharedSessionTools(
          server as unknown as SharedParams[0],
          db as SharedParams[1],
        );
        registerStorymapTools(
          server as unknown as StorymapParams[0],
          db as StorymapParams[1],
        );
        registerSchedulerTools(
          server as unknown as SchedulerParams[0],
          db as SchedulerParams[1],
        );
      }).not.toThrow();
      expect(names.has("scheduler_get_project")).toBe(true);
      expect(names.has("scheduler_create_activity")).toBe(true);
      expect(names.has("scheduler_set_activity_description")).toBe(true);
      expect(names.has("scheduler_bulk_create_activities")).toBe(true);
      expect(names.has("scheduler_bulk_create_dependencies")).toBe(true);
      expect(names.has("scheduler_bulk_create_milestones")).toBe(true);
      expect(names.has("scheduler_bulk_assign_milestones")).toBe(true);
      expect(names.has("scheduler_bulk_update_activities")).toBe(true);
      expect(names.has("scheduler_bulk_import")).toBe(true);
      expect(names.has("scheduler_reorder_activities")).toBe(true);
      expect(names.has("scheduler_bulk_append_notes")).toBe(true);
      expect(names.has("resolve_session_code")).toBe(true);
    });
});

describe("manifest census", () => {
  test("the server advertises exactly 51 tools", () => {
    // 21 Story Map + 25 Scheduler + 3 Forecaster + 2 shared. A cached MCP
    // client keys off this count and serverInfo.version, so a silent change
    // here is a change to what every paired AI believes is available.
    const {tools, server} = capturingServer();
    registerSharedSessionTools(
      server as unknown as SharedParams[0],
      db as SharedParams[1],
    );
    registerStorymapTools(
      server as unknown as StorymapParams[0],
      db as StorymapParams[1],
    );
    registerSchedulerTools(
      server as unknown as SchedulerParams[0],
      db as SchedulerParams[1],
    );
    registerForecasterTools(
      server as unknown as ForecasterParams[0],
      db as ForecasterParams[1],
    );

    const names = [...tools.keys()];
    expect(names).toHaveLength(51);
    expect(names.filter((n) => n.startsWith("storymap_"))).toHaveLength(21);
    expect(names.filter((n) => n.startsWith("scheduler_"))).toHaveLength(25);
    expect(names.filter((n) => n.startsWith("forecaster_"))).toHaveLength(3);

    // Forecaster is read-only by construction: no write tool, and no entry in
    // the shared op-name registry.
    const forecaster = names.filter((n) => n.startsWith("forecaster_"));
    expect(forecaster.sort()).toEqual([
      "forecaster_explain_method",
      "forecaster_get_glossary",
      "forecaster_get_project",
    ]);
  });

  test("Forecaster contributes no ops to the shared registry", () => {
    const allOps = [...contract.schedulerOps, ...contract.storymapOps];
    expect(allOps.filter((o) => o.includes("forecast"))).toEqual([]);
  });
});

describe("appId guard (§3.4) — behaviour, not just presence", () => {
  test("all 46 app-prefixed tools refuse a foreign session", async () => {
    const {tools, opWrites} = registerBothApps({
      appId: "some-other-app",
      // consentRead: false is deliberate. With true, a guard misplaced AFTER
      // the consentRead check in storymap_get_project / scheduler_get_project
      // would still return wrong_app, and this test could not detect the one
      // placement error §3.4 warns about. With false, a correctly-placed
      // guard returns wrong_app and a misplaced one returns
      // read_not_permitted — so the assertion discriminates.
      consentRead: false,
      consentWrite: true,
      lastSeq: 0,
    });

    const names = [...tools.keys()];
    expect(names).toHaveLength(46);

    for (const name of names) {
      const body = await callTool(tools, name, SID_A);
      // Pair the name into the assertion so a failure names the tool.
      expect([name, body.status]).toEqual([name, "wrong_app"]);
    }
    expect(opWrites()).toBe(0);
  });

  test("a matching appId is NOT refused (guard is not vacuous)", async () => {
    const {tools, opWrites} = registerBothApps({
      appId: "storymap",
      consentRead: true,
      consentWrite: true,
      lastSeq: 0,
    });
    const body = await callTool(tools, "storymap_create_theme", SID_B);
    expect(body.status).toBe("success");
    expect(opWrites()).toBe(1);
  });

  test("a session with NO appId is accepted (strict: false)", async () => {
    // D8: both siblings pass strict: false, because browser builds predating
    // the appId rollout write no appId. An inverted third argument would
    // refuse every already-paired session — a count-only grep cannot see it.
    const {tools} = registerBothApps({
      consentRead: true,
      consentWrite: true,
      lastSeq: 0,
    });
    const sm = await callTool(tools, "storymap_create_theme", SID_C);
    expect(sm.status).toBe("success");
    const sch = await callTool(tools, "scheduler_create_milestone", SID_C);
    expect(sch.status).toBe("success");
  });
});

describe("consentWrite guard (§3.2) + refusal contract (§3.3)", () => {
  test("a read-only session is refused permanently, no op write", async () => {
    const {tools, opWrites} = registerBothApps({
      appId: "storymap",
      consentRead: true,
      consentWrite: false,
      lastSeq: 0,
    });
    const body = await callTool(tools, "storymap_create_theme", SID_D);
    expect(body.status).toBe("write_not_permitted");
    // The message must not invite a retry: the condition is permanent, and
    // the fixed "Op write failed; retry." string this release removed is
    // exactly what would make an AI loop.
    expect(body.message).toContain("Do not retry");
    expect(opWrites()).toBe(0);
  });

  test("Scheduler surfaces the same refusal", async () => {
    const {tools, opWrites} = registerBothApps({
      appId: "scheduler",
      consentRead: true,
      consentWrite: false,
      lastSeq: 0,
    });
    const body = await callTool(tools, "scheduler_create_milestone", SID_D);
    expect(body.status).toBe("write_not_permitted");
    expect(opWrites()).toBe(0);
  });

  test("the generic fallback interpolates the underlying message", async () => {
    // writeOpBatch also throws a PERMANENT "Op batch too large: N (max 400)".
    // Before this release, 19 Story Map sites discarded it behind a fixed
    // "Op write failed; retry." — presenting a permanent refusal as
    // transient. Assert the interpolation survives.
    const {tools} = registerBothApps({
      appId: "storymap",
      consentRead: true,
      consentWrite: true,
      lastSeq: 0,
    });
    const handler = tools.get("storymap_bulk_create_releases") as Handler;
    const res = await handler({
      sessionId: SID_D,
      releases: Array.from({length: 401}, (_, i) => ({
        releaseId: `r${i}`,
        name: `R${i}`,
      })),
    });
    const body = JSON.parse(res.content[0].text);
    // Either the tool caps the batch itself, or writeOpBatch throws and the
    // catch block reports it verbatim. Both are acceptable; a bare
    // "Op write failed; retry." is not.
    if (body.status === "error" && body.error === "internal") {
      expect(body.message).toMatch(/^Op write failed: /);
      expect(body.message).not.toBe("Op write failed; retry.");
    }
  });
});

describe("AI op-name registry (contract fixture)", () => {
  test("scheduler and storymap op names are disjoint", () => {
    const intersection = contract.schedulerOps.filter((o) =>
      contract.storymapOps.includes(o),
    );
    expect(intersection).toEqual([]);
  });

  test("every fixture bulk op maps to a registered scheduler tool", () => {
    const {names, server} = collidingServer();
    registerSchedulerTools(
      server as unknown as SchedulerParams[0],
      db as SchedulerParams[1],
    );
    for (const op of Object.keys(contract.ops)) {
      expect(contract.schedulerOps).toContain(op);
      expect(names.has(contract.ops[op].tool)).toBe(true);
    }
  });
});
