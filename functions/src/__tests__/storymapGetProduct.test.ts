// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// Story Map's read tool is storymap_get_product (landing v2.12.0, ruling R47:
// renamed from storymap_get_project, no alias) and returns the product under
// the key "product".

jest.mock("../mcp/session", () => ({
  getSession: jest.fn(),
  touchSession: jest.fn(),
  writeOpBatch: jest.fn(),
  isBrowserConnected: jest.fn(),
}));

import * as fs from "fs";
import * as path from "path";
import type {DocumentData} from "firebase-admin/firestore";
import {getSession} from "../mcp/session";
import {registerSharedSessionTools} from "../mcp/tools/shared";
import {registerStorymapTools} from "../mcp/tools/storymap";
import {registerSchedulerTools} from "../mcp/tools/scheduler";
import {registerForecasterTools} from "../mcp/tools/forecaster";

type ToolResult = {content: Array<{type: string; text: string}>};
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

const SID = "11111111-1111-1111-1111-111111111111";
const SNAPSHOT_PRODUCT = {themes: [{id: "t1", name: "Checkout"}]};

// A db whose only document is the session's snapshot/current.
const db = {
  collection: () => ({
    doc: () => ({
      collection: () => ({
        doc: () => ({
          get: async () => ({
            exists: true,
            data: () => ({product: SNAPSHOT_PRODUCT}),
          }),
        }),
      }),
    }),
  }),
};

/**
 * Register the four registrars on a server that records each tool's handler.
 * @return {Map<string, Handler>} Handlers by tool name.
 */
function registerAll(): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const server = {
    tool: (...args: unknown[]): void => {
      handlers.set(args[0] as string, args[args.length - 1] as Handler);
    },
  };
  const s = server as never;
  registerSharedSessionTools(s, db as never);
  registerStorymapTools(s, db as never);
  registerSchedulerTools(s, db as never);
  registerForecasterTools(s, db as never);
  return handlers;
}

/**
 * Every .ts / .tsx file under a directory, skipping __tests__.
 * @param {string} dir Directory.
 * @return {string[]} Paths.
 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "__tests__") out.push(...sourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

beforeEach(() => {
  (getSession as jest.Mock).mockReset();
});

describe("storymap_get_product", () => {
  test("is registered, and storymap_get_project is not", () => {
    const names = [...registerAll().keys()];
    expect(names).toContain("storymap_get_product");
    expect(names).not.toContain("storymap_get_project");
    // Scheduler's and Forecaster's read tools keep their names.
    expect(names).toContain("scheduler_get_project");
    expect(names).toContain("forecaster_get_project");
  });

  test("the old name appears in no source file outside the tests", () => {
    const root = path.join(__dirname, "..");
    const files = sourceFiles(root);
    const read = (f: string) => fs.readFileSync(f, "utf8");
    // Must-find control: the walk reads the files that hold the new name.
    const withNew = files.filter((f) => read(f).includes("storymap_get_product"))
      .map((f) => path.relative(root, f));
    expect(withNew).toEqual(expect.arrayContaining(
      ["mcp/tools/storymap.ts", "mcp/tools/shared.ts"]));
    const withOld = files.filter((f) => read(f).includes("storymap_get_project"))
      .map((f) => path.relative(root, f));
    expect(withOld).toEqual([]);
  });

  test("returns the product under the key \"product\", and no \"project\" key",
    async () => {
      (getSession as jest.Mock).mockResolvedValue(
        {appId: "storymap", consentRead: true} as DocumentData);
      const handler = registerAll().get("storymap_get_product") as Handler;
      const result = await handler({sessionId: SID});
      const body = JSON.parse(result.content[0]?.text ?? "{}");
      expect(body).toStrictEqual({status: "ok", product: SNAPSHOT_PRODUCT});
      expect("project" in body).toBe(false);
    });
});
