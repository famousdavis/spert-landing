// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// What the shared session tools tell an AI (landing v2.12.0, ruling R47):
// get_session_info names the open app's read tool and says "product" for a
// Story Map session and "project" for Scheduler and Forecaster. A null or
// unknown appId gets neutral words that name all three read tools.

jest.mock("../mcp/session", () => ({
  getSession: jest.fn(),
  touchSession: jest.fn(),
  writeOpBatch: jest.fn(),
  isBrowserConnected: jest.fn(() => true),
}));

import type {DocumentData} from "firebase-admin/firestore";
import {getSession} from "../mcp/session";
import {registerSharedSessionTools} from "../mcp/tools/shared";

type ToolResult = {content: Array<{type: string; text: string}>};
type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

const SID = "11111111-1111-1111-1111-111111111111";
const READ_TOOLS =
  "storymap_get_product, scheduler_get_project or forecaster_get_project";
const READ_MODE = " to discover its entity ids (Read Mode required — if " +
  "off, ask the user to enable it in the Connect AI panel), then use the " +
  "app's fine-grained create/update tools.";

const handlers = new Map<string, Handler>();
const descriptions = new Map<string, string>();
registerSharedSessionTools({
  tool: (...args: unknown[]): void => {
    handlers.set(args[0] as string, args[args.length - 1] as Handler);
    descriptions.set(args[0] as string,
      (args[1] as string).replace(/\s+/g, " "));
  },
} as never, {} as never);

/**
 * get_session_info's message for a session.
 * @param {unknown} appId The session's appId.
 * @param {string | null} openProductId What is open, or null.
 * @return {Promise<string>} The reply's message.
 */
async function message(
  appId: unknown, openProductId: string | null,
): Promise<string> {
  (getSession as jest.Mock).mockResolvedValue(
    {appId, openProductId} as DocumentData);
  const result = await (handlers.get("get_session_info") as Handler)(
    {sessionId: SID});
  return JSON.parse(result.content[0]?.text ?? "{}").message;
}

describe("get_session_info names the open app's read tool", () => {
  test.each([
    ["storymap", "A product is open in storymap. Use that app's tools to " +
      "build or edit. To add to or edit the existing product, first call " +
      "storymap_get_product" + READ_MODE],
    ["scheduler", "A project is open in scheduler. Use that app's tools to " +
      "build or edit. To add to or edit the existing project, first call " +
      "scheduler_get_project" + READ_MODE],
    ["forecaster", "A project is open in forecaster. Use that app's tools " +
      "to build or edit. To add to or edit the existing project, first call " +
      "forecaster_get_project" + READ_MODE],
  ])("%s, open", async (appId, expected) => {
    expect(await message(appId, "p1")).toBe(expected);
  });

  test.each([
    ["storymap", "No product is open. Ask the user to open one in their " +
      "SPERT Suite app."],
    ["scheduler", "No project is open. Ask the user to open one in their " +
      "SPERT Suite app."],
    ["forecaster", "No project is open. Ask the user to open one in their " +
      "SPERT Suite app."],
  ])("%s, nothing open", async (appId, expected) => {
    expect(await message(appId, null)).toBe(expected);
  });

  test("a Story Map session never reads \"project\"", async () => {
    for (const open of ["p1", null]) {
      expect(await message("storymap", open)).not.toMatch(/project/i);
    }
  });

  test.each([
    [null, ""],
    ["spertahp", " in spertahp"],
    ["__proto__", " in __proto__"],
    ["toString", " in toString"],
  ])("appId %p gets neutral words and all three read tools",
    async (appId, inApp) => {
      expect(await message(appId, "p1")).toBe(
        `Something is open${inApp}. Use that app's tools to build or edit. ` +
        "To add to or edit what is open, first call the app's read tool (" +
        READ_TOOLS + ")" + READ_MODE);
      expect(await message(appId, null)).toBe("Nothing is open. Ask the " +
        "user to open a product or project in their SPERT Suite app.");
    });
});

describe("the shared tools' static text", () => {
  test("get_session_info's description names all three read tools", () => {
    const text = descriptions.get("get_session_info") ?? "";
    expect(text).toContain("learn what is currently open: a product in " +
      "SPERT Story Map, a project in SPERT Scheduler or SPERT Forecaster.");
    expect(text).toContain("first call that app's read tool (" +
      READ_TOOLS + ")");
    expect(text).not.toContain("get_project tool");
  });
});
