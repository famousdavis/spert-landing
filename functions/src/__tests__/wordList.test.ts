// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

import {WORD_LIST} from "../mcp/wordList";

describe("WORD_LIST (pairing-code source)", () => {
  test("has at least 2000 entries", () => {
    expect(WORD_LIST.length).toBeGreaterThanOrEqual(2000);
  });

  // resolve_session_code matches /^[A-Za-z]+-\d{4}$/, so a non-alpha word
  // would mint a code that can never be resolved.
  test("every entry is alphabetic", () => {
    WORD_LIST.forEach((word) => {
      expect(word).toMatch(/^[A-Za-z]+$/);
    });
  });
});
