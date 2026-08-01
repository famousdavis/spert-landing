// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {createHash} from "crypto";
import {readFileSync} from "fs";
import {join} from "path";

/**
 * `src/mcp/ai-op-contract.json` must stay byte-identical, in canonical form, to
 * its copy in SPERT Scheduler (`src/app/api/ai-op-contract.json`). The two
 * halves of Connect AI — this MCP server and the Scheduler client — are written
 * against the same document. A silent divergence means this server advertises a
 * tool shape the client rejects, or the client sends one this server refuses.
 *
 * That requirement was documented and tooled but enforced NOWHERE, on either
 * side. `npm run contract:hash` PRINTS the digest and exits 0 whatever it finds,
 * so it only ever helped when someone ran it in both repositories and compared
 * by eye. `aiOpContract.test.ts` drives the exported Zod shapes against the
 * fixture — a different property, which stays green through any content change
 * that remains schema-valid.
 *
 * SPERT Scheduler pinned its half in v0.59.4
 * (`src/integration/ai-op-contract-hash.test.ts`). This is the other half. With
 * both pinned to the same constant, a one-sided edit fails in the repository
 * where it was made, immediately, instead of surfacing later as a rejected tool
 * call in production.
 *
 * Verified equal across both repositories on 2026-07-30.
 *
 * IF THIS FAILS, the contract changed. That is allowed — but it is a cross-repo
 * change:
 *   1. make the same change in spert-scheduler's copy,
 *   2. confirm `npm run contract:hash` matches in BOTH repos,
 *   3. update the constant here AND in spert-scheduler,
 *   4. ship this server side FIRST, so the client is never told about a tool
 *      the server cannot yet handle.
 * Do not update the constant on its own to make this pass.
 *
 * Canonical form (mirrors scripts/contract-hash.mjs, which is itself vendored
 * byte-identically in both repos): recursively key-sorted JSON, no insignificant
 * whitespace, UTF-8.
 */
const CANONICAL_CONTRACT_SHA256 =
  "25dabe86334f7599f4bf7daef2fdae1c2e51e7d70a714851b9b50096cd7e33f1";

type Json = string | number | boolean | null | Json[] | {[key: string]: Json};

function sortDeep(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce<{[key: string]: Json}>((acc, key) => {
        acc[key] = sortDeep((value as {[key: string]: Json})[key] as Json);
        return acc;
      }, {});
  }
  return value;
}

describe("ai-op-contract.json cross-repo hash", () => {
  it("matches the canonical digest shared with spert-scheduler", () => {
    const contractPath = join(__dirname, "..", "mcp", "ai-op-contract.json");
    const data = JSON.parse(readFileSync(contractPath, "utf-8")) as Json;
    const canonical = JSON.stringify(sortDeep(data));
    const actual = createHash("sha256").update(canonical, "utf8").digest("hex");

    expect(actual).toBe(CANONICAL_CONTRACT_SHA256);
  });
});
