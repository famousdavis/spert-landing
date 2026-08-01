// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// SPERT Forecaster's three MCP tools are READ-ONLY. These tests pin the two
// things that cannot be checked by reading the file:
//
//   1. forecaster_get_project refuses a session with NO appId (strict: true),
//      unlike both siblings, which tolerate one. The Firestore create rule
//      allows appId via hasOnly rather than requiring it via hasAll, so an
//      appId-less session is some other app's and must not be readable here.
//   2. The distribution list stays equal to the client's DISTRIBUTION_TYPES.
//      The two repos share no package, so it is duplicated rather than
//      imported — the same cross-repo pattern as ai-op-contract.json — and
//      only a test keeps the copies honest.

import type {DocumentData} from "firebase-admin/firestore";
import {
  registerForecasterTools,
  FORECASTER_DISTRIBUTIONS,
} from "../mcp/tools/forecaster";

type ToolResult = {content: Array<{type: string; text: string}>};
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;
type ForecasterParams = Parameters<typeof registerForecasterTools>;

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

const SID = "00000000-0000-4000-8000-000000000000";

/**
 * Build a Firestore double serving a session document and a snapshot
 * document. expiresAt is omitted so getSession reads the session as live.
 * @param {DocumentData | undefined} sessionData The session document.
 * @param {DocumentData | undefined} snapshotData The snapshot/current doc.
 * @return {object} The double, plus a count of op writes.
 */
function fakeDb(
  sessionData: DocumentData | undefined,
  snapshotData?: DocumentData,
): {db: unknown; opWrites: () => number} {
  let opWrites = 0;
  const sessionSnap: FakeSnap = {
    exists: sessionData !== undefined,
    data: () => sessionData,
  };
  const snapshotSnap: FakeSnap = {
    exists: snapshotData !== undefined,
    data: () => snapshotData,
  };
  const snapshotDoc: FakeDocRef = {
    get: async () => snapshotSnap,
    update: async () => undefined,
    collection: () => snapshotCol,
  };
  const snapshotCol: FakeColRef = {doc: () => snapshotDoc};
  const sessionDoc: FakeDocRef = {
    get: async () => sessionSnap,
    update: async () => undefined,
    // The only subcollection this tool reaches for is "snapshot".
    collection: () => snapshotCol,
  };
  const sessionCol: FakeColRef = {doc: () => sessionDoc};
  const db = {
    collection: (): FakeColRef => sessionCol,
    runTransaction: async (
      fn: (tx: {
        get: (ref: unknown) => Promise<FakeSnap>;
        update: (ref: unknown, data: object) => void;
        set: (ref: unknown, data: object) => void;
      }) => Promise<unknown>,
    ): Promise<unknown> =>
      fn({
        get: async () => sessionSnap,
        update: () => undefined,
        set: () => {
          opWrites++;
        },
      }),
  };
  return {db, opWrites: () => opWrites};
}

/**
 * Register the Forecaster tools against a capturing server.
 * @param {DocumentData | undefined} sessionData The session document.
 * @param {DocumentData | undefined} snapshotData The snapshot/current doc.
 * @return {object} Captured handlers plus the op-write counter.
 */
function registerAgainst(
  sessionData: DocumentData | undefined,
  snapshotData?: DocumentData,
): {tools: Map<string, Handler>; opWrites: () => number} {
  const tools = new Map<string, Handler>();
  const server = {
    tool: (...args: unknown[]): void => {
      tools.set(args[0] as string, args[args.length - 1] as Handler);
    },
  };
  const {db, opWrites} = fakeDb(sessionData, snapshotData);
  registerForecasterTools(
    server as unknown as ForecasterParams[0],
    db as ForecasterParams[1],
  );
  return {tools, opWrites};
}

/**
 * Invoke a captured handler and parse its envelope body.
 * @param {Map<string, Handler>} tools Captured handlers.
 * @param {string} name Tool name.
 * @param {Record<string, unknown>} args Handler arguments.
 * @return {Promise<Record<string, unknown>>} The parsed body.
 */
async function call(
  tools: Map<string, Handler>,
  name: string,
  args: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const res = await (tools.get(name) as Handler)(args);
  return JSON.parse(res.content[0].text);
}

describe("registration", () => {
  test("registers exactly the three read-only tools", () => {
    const {tools} = registerAgainst(undefined);
    expect([...tools.keys()].sort()).toEqual([
      "forecaster_explain_method",
      "forecaster_get_glossary",
      "forecaster_get_project",
    ]);
  });
});

describe("forecaster_get_project — appId is strict (D9)", () => {
  test("REFUSES a session with no appId, unlike the siblings", async () => {
    const {tools, opWrites} = registerAgainst({consentRead: true});
    const body = await call(tools, "forecaster_get_project", {sessionId: SID});
    expect(body.status).toBe("wrong_app");
    expect(opWrites()).toBe(0);
  });

  test("refuses another app's session", async () => {
    const {tools} = registerAgainst({appId: "storymap", consentRead: true});
    const body = await call(tools, "forecaster_get_project", {sessionId: SID});
    expect(body.status).toBe("wrong_app");
    expect(body.message).toContain("storymap");
  });

  test("the appId check runs BEFORE the consentRead check", async () => {
    // Otherwise a wrong-app probe against a Read-Mode-off session reports
    // read_not_permitted and hides the real reason.
    const {tools} = registerAgainst({appId: "scheduler", consentRead: false});
    const body = await call(tools, "forecaster_get_project", {sessionId: SID});
    expect(body.status).toBe("wrong_app");
  });

  test("refuses a missing session before anything else", async () => {
    const {tools} = registerAgainst(undefined);
    const body = await call(tools, "forecaster_get_project", {sessionId: SID});
    expect(body.error).toBe("session_not_found");
  });
});

describe("forecaster_get_project — Read Mode and the snapshot", () => {
  test("refuses when Read Mode is off", async () => {
    const {tools} = registerAgainst({appId: "forecaster", consentRead: false});
    const body = await call(tools, "forecaster_get_project", {sessionId: SID});
    expect(body.status).toBe("read_not_permitted");
  });

  test("returns no_snapshot rather than a bare null project", async () => {
    const {tools} = registerAgainst({appId: "forecaster", consentRead: true});
    const body = await call(tools, "forecaster_get_project", {sessionId: SID});
    expect(body.status).toBe("no_snapshot");
    expect(body.project).toBeUndefined();
    expect(String(body.message)).toContain("Read Mode");
  });

  test("an empty snapshot is also no_snapshot, never ok+null", async () => {
    // status: "ok" with project: null would read to an AI as "the project is
    // empty" rather than "there is nothing here yet".
    const {tools} = registerAgainst(
      {appId: "forecaster", consentRead: true},
      {project: null},
    );
    const body = await call(tools, "forecaster_get_project", {sessionId: SID});
    expect(body.status).toBe("no_snapshot");
  });

  test("returns the snapshot body on the happy path", async () => {
    const {tools, opWrites} = registerAgainst(
      {appId: "forecaster", consentRead: true},
      {project: {app: "forecaster", projectConfig: {name: "Test"}}},
    );
    const body = await call(tools, "forecaster_get_project", {sessionId: SID});
    expect(body.status).toBe("ok");
    expect(body.project).toEqual({
      app: "forecaster",
      projectConfig: {name: "Test"},
    });
    // Read-only means read-only: not one op write on any path.
    expect(opWrites()).toBe(0);
  });
});

describe("the two ungated explainers", () => {
  test("forecaster_explain_method needs no session", async () => {
    const {tools} = registerAgainst(undefined);
    const body = await call(tools, "forecaster_explain_method", {
      topic: "overview",
    });
    expect(body.status).toBe("ok");
    expect(String(body.explanation)).toContain("Monte Carlo");
  });

  test("the overview explicitly disclaims three-point PERT (RK9)", async () => {
    // The recurring failure mode is an AI describing SPERT as the weighted
    // (O + 4M + P) / 6 average. The explainer has to say so outright.
    const {tools} = registerAgainst(undefined);
    const body = await call(tools, "forecaster_explain_method", {
      topic: "overview",
    });
    expect(String(body.explanation)).toContain("(O + 4M + P) / 6");
    expect(String(body.explanation)).toContain("NOT three-point PERT");
  });

  test("every topic in the enum resolves to real text", async () => {
    const {tools} = registerAgainst(undefined);
    const topics = [
      "overview", "distributions", "modes", "percentiles", "milestones",
      "scope-growth", "productivity", "deadline-probability",
    ];
    for (const topic of topics) {
      const body = await call(tools, "forecaster_explain_method", {topic});
      expect([topic, body.status]).toEqual([topic, "ok"]);
      expect(String(body.explanation).length).toBeGreaterThan(80);
    }
  });

  test("glossary returns everything, one term, or not_found", async () => {
    const {tools} = registerAgainst(undefined);

    const all = await call(tools, "forecaster_get_glossary");
    expect(Object.keys(all.glossary as object).length).toBeGreaterThan(10);

    const one = await call(tools, "forecaster_get_glossary", {
      term: "  Velocity ",
    });
    expect(one.status).toBe("ok");
    expect(one.term).toBe("velocity");

    const miss = await call(tools, "forecaster_get_glossary", {
      term: "burndown",
    });
    expect(miss.status).toBe("not_found");
    expect(Array.isArray(miss.availableTerms)).toBe(true);
  });
});

describe("RK14 — the duplicated distribution list must not drift", () => {
  test("equals the client's DISTRIBUTION_TYPES, in order", () => {
    // Mirrors src/shared/types/burn-up.ts in spert-forecaster. The two repos
    // share no package, so this assertion is the only thing holding them
    // together. If the client's list changes, change this one and this test.
    expect([...FORECASTER_DISTRIBUTIONS]).toEqual([
      "lognormal",
      "truncatedNormal",
      "gamma",
      "bootstrap",
      "triangular",
      "uniform",
    ]);
  });

  test("the distributions topic names every one of them", async () => {
    const {tools} = registerAgainst(undefined);
    const body = await call(tools, "forecaster_explain_method", {
      topic: "distributions",
    });
    for (const d of FORECASTER_DISTRIBUTIONS) {
      expect(String(body.explanation)).toContain(d);
    }
    expect(body.distributions).toEqual([...FORECASTER_DISTRIBUTIONS]);
  });
});

describe("no tool description leaks internal terminology", () => {
  test("tools/list text carries no internal-terminology wording", () => {
    // tools/list is served UNAUTHENTICATED to any caller, so every
    // description string is public. These tools describe forecasting only.
    const descriptions: string[] = [];
    const server = {
      tool: (...args: unknown[]): void => {
        descriptions.push(args[1] as string);
      },
    };
    const {db} = fakeDb(undefined);
    registerForecasterTools(
      server as unknown as ForecasterParams[0],
      db as ForecasterParams[1],
    );
    const joined = descriptions.join(" ").toLowerCase();
    for (const banned of [
      "originref", "storageref", "changelog", "exportedby", "exportedbyid",
      "fingerprint", "provenance", "workspace id", "workspace token",
      "academic", "integrity", "cheat", "plagiar", "student", "university",
    ]) {
      expect([banned, joined.includes(banned)]).toEqual([banned, false]);
    }
  });
});
