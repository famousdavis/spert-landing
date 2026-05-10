import {
  denormalizeLastFirst,
  sanitizeDisplayName,
  sanitizeSubject,
  stripCrlf,
} from "../mailHeaders";

describe("sanitizeDisplayName", () => {
  it("passes plain ASCII through unchanged", () => {
    expect(sanitizeDisplayName("William Davis")).toBe("William Davis");
  });

  it("quotes a value containing a comma (Microsoft Last, First case)", () => {
    expect(sanitizeDisplayName("Davis, William")).toBe("\"Davis, William\"");
  });

  it("strips CRLF (header injection defense)", () => {
    const out = sanitizeDisplayName("Alice\r\nBcc: x@y.com");
    expect(out).not.toMatch(/[\r\n]/);
    // Result contains specials (':' and '@'), so it should be quoted.
    expect(out.startsWith("\"")).toBe(true);
  });

  it("escapes \" and backslash inside quoted form", () => {
    expect(sanitizeDisplayName("a\"b\\c,")).toBe("\"a\\\"b\\\\c,\"");
  });

  it("handles the brief's adversarial example", () => {
    const out = sanitizeDisplayName("O'Brien, Sean\r\nBcc: x@y");
    expect(out).not.toMatch(/[\r\n]/);
    // Specials ',', ':', '@' present → quoted
    expect(out.startsWith("\"")).toBe(true);
    expect(out.endsWith("\"")).toBe(true);
  });
});

describe("denormalizeLastFirst", () => {
  it("returns empty string for empty input", () => {
    expect(denormalizeLastFirst("")).toBe("");
  });

  it("passes a single-token name through unchanged", () => {
    expect(denormalizeLastFirst("Cher")).toBe("Cher");
  });

  it("reorders Microsoft AD \"Last, First Middle\" form", () => {
    expect(denormalizeLastFirst("Davis, William W")).toBe("William W Davis");
  });

  it("trims surrounding and inter-part whitespace", () => {
    expect(denormalizeLastFirst("  Davis ,  William W  ")).toBe(
      "William W Davis",
    );
  });

  it("handles a suffix stored as a third comma-separated part", () => {
    // Suffix is preserved between first name and last name; the comma
    // before "Jr." is dropped (pragmatic — not strictly grammatical).
    expect(denormalizeLastFirst("Smith, John, Jr.")).toBe("John Jr. Smith");
  });

  it("returns trimmed source for commas/whitespace only", () => {
    // After filter, parts is empty (length < 2), so the helper falls
    // through to s.trim() — which still contains commas. This is not a
    // realistic input; documented here so the behavior is intentional.
    expect(denormalizeLastFirst(", , ,")).toBe(", , ,");
  });

  it("returns the trimmed source for a trailing-comma single-part name", () => {
    // "Davis," → after split/trim/filter → ["Davis"] → length < 2 →
    // returns s.trim() unchanged.
    expect(denormalizeLastFirst("Davis,")).toBe("Davis,");
  });
});

describe("stripCrlf", () => {
  it("passes plain ASCII through unchanged", () => {
    expect(stripCrlf("Virtual Art Museum")).toBe("Virtual Art Museum");
  });

  it("preserves RFC 5322 specials without quoting (display-safe, not " +
    "header-safe)", () => {
    // Unlike sanitizeDisplayName, stripCrlf does NOT wrap commas in
    // quotes. It is meant for visible body/subject text where the
    // React-Email template's literal &quot;…&quot; is the sole source
    // of any visible quoting.
    expect(stripCrlf("Thomas, Jenny")).toBe("Thomas, Jenny");
    expect(stripCrlf("a\"b\\c,")).toBe("a\"b\\c,");
  });

  it("strips CR and LF (header-injection defense)", () => {
    expect(stripCrlf("Alice\r\nBcc: x@y.com")).toBe("AliceBcc: x@y.com");
    expect(stripCrlf("line1\rline2\nline3")).toBe("line1line2line3");
  });
});

describe("sanitizeSubject", () => {
  it("passes plain ASCII through unchanged", () => {
    expect(sanitizeSubject("Alice invited you to MyModel")).toBe(
      "Alice invited you to MyModel",
    );
  });

  it("strips CRLF", () => {
    expect(sanitizeSubject("Subject\r\nBcc: x@y")).toBe(
      "SubjectBcc: x@y",
    );
  });

  it("preserves specials (no quoting required for subjects)", () => {
    expect(sanitizeSubject("Hello, \"world\" <test@example.com>")).toBe(
      "Hello, \"world\" <test@example.com>",
    );
  });
});
