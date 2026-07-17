// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0. See LICENSE file in the project root for full license text.

// Canonical hash of an ai-op-contract.json. Vendored IDENTICALLY (byte-for-byte)
// in spert-landing-page and spert-scheduler; `npm run contract:hash` digests
// MUST match across the two repos before any phase ships (decision 13 / P0.2).
// Canonical form: recursively key-sorted JSON, no insignificant whitespace, LF,
// UTF-8. The contract path is passed as argv[2] so this script stays identical
// across repos (only each package.json's script wiring names the local path).

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = sortDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: contract-hash.mjs <path-to-ai-op-contract.json>\n");
  process.exit(2);
}

const data = JSON.parse(readFileSync(path, "utf8"));
const canonical = JSON.stringify(sortDeep(data));
process.stdout.write(createHash("sha256").update(canonical, "utf8").digest("hex") + "\n");
