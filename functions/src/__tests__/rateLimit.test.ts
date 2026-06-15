// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

import {checkIpRateLimit, checkSessionWriteLimit} from "../mcp/rateLimit";

// The counters are module-level Maps, so each test uses unique keys to
// avoid cross-test contamination within a single file run.
describe("rate limiting", () => {
  test("allows 150 IP requests per window, blocks the 151st", () => {
    const ip = "203.0.113.1";
    for (let i = 0; i < 150; i++) {
      expect(checkIpRateLimit(ip)).toBe(true);
    }
    expect(checkIpRateLimit(ip)).toBe(false);
  });

  test("allows 100 session writes per window, blocks the 101st", () => {
    const sid = "session-under-test";
    for (let i = 0; i < 100; i++) {
      expect(checkSessionWriteLimit(sid)).toBe(true);
    }
    expect(checkSessionWriteLimit(sid)).toBe(false);
  });

  test("tracks identities independently", () => {
    const a = "203.0.113.2";
    const b = "203.0.113.3";
    for (let i = 0; i < 150; i++) checkIpRateLimit(a);
    expect(checkIpRateLimit(a)).toBe(false);
    expect(checkIpRateLimit(b)).toBe(true);
  });
});
