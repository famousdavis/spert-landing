// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

// Two-stage collision test (Unit 0 §2.2). The MCP SDK throws on a duplicate
// tool name and the server is built fresh per request, so the shared session
// tools must be registered exactly once — by registerSharedSessionTools — and
// never again by any app's register*Tools. Stage A covers shared + storymap;
// Stage B (todo) covers scheduler, converted to a real test in Unit 3.

import {registerSharedSessionTools} from "../mcp/tools/shared";
import {registerStorymapTools} from "../mcp/tools/storymap";

type SharedParams = Parameters<typeof registerSharedSessionTools>;
type StorymapParams = Parameters<typeof registerStorymapTools>;

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

  // Converted to a real test in Unit 3 once registerSchedulerTools exists.
  test.todo(
    "Stage B: shared + storymap + scheduler register without collision",
  );
});
