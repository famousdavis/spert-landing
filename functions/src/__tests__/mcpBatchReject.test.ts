// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// AI-1 (2026-10-24 audit): mcpSpertSuite refuses JSON-RPC batch arrays. The
// IP rate limiter counts one HTTP request, so a batch of hundreds of
// resolve_session_code calls was hundreds of pairing-code guesses per tick.
//
// Differential: identical requests that differ only in whether the body is an
// array. getFirestore is the handler's first step after the batch check, so a
// sentinel thrown from it proves the non-batch request got past that check.

const SENTINEL = "reached MCP server setup";

jest.mock("firebase-functions/v2/https", () => ({
  onRequest: (_opts: unknown, handler: unknown) => handler,
}));
jest.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: jest.fn(),
}));
jest.mock("firebase-admin/firestore", () => ({
  getFirestore: jest.fn(() => {
    throw new Error(SENTINEL);
  }),
}));
jest.mock("../mcp/rateLimit", () => ({
  checkIpRateLimit: jest.fn(() => true),
}));

import {getFirestore} from "firebase-admin/firestore";
import {mcpSpertSuite} from "../mcp/index";

type Res = {
  status: jest.Mock;
  json: jest.Mock;
  set: jest.Mock;
};

/**
 * A minimal Express-shaped response that records status and body.
 * @return {Res} The fake response.
 */
function makeRes(): Res {
  const res = {} as Res;
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.set = jest.fn(() => res);
  return res;
}

/**
 * Invoke the handler with a POST carrying the given body.
 * @param {unknown} body The parsed JSON body.
 * @return {Promise<Res>} The fake response after the handler ran.
 */
async function post(body: unknown): Promise<Res> {
  const res = makeRes();
  const req = {
    method: "POST",
    headers: {"x-forwarded-for": "203.0.113.7"},
    socket: {remoteAddress: "203.0.113.7"},
    body,
  };
  await (mcpSpertSuite as unknown as
    (q: unknown, s: unknown) => Promise<void>)(req, res);
  return res;
}

const CALL = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {name: "resolve_session_code", arguments: {code: "CRANE-0384216791"}},
};

beforeEach(() => {
  (getFirestore as jest.Mock).mockClear();
});

describe("mcpSpertSuite batch rejection (AI-1)", () => {
  it("rejects a JSON-RPC batch with 400 before any server setup", async () => {
    const res = await post([CALL, {...CALL, id: 2}]);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Batch requests are not supported",
    });
    expect(getFirestore).not.toHaveBeenCalled();
  });

  it("control: a single JSON-RPC call gets past the batch check", async () => {
    await expect(post(CALL)).rejects.toThrow(SENTINEL);
    expect(getFirestore).toHaveBeenCalledTimes(1);
  });
});
