import { defineConfig } from 'vitest/config';

// The root package had no test runner until v2.5.8. What it needs one for is
// repo-hygiene guards, not application tests: this repository is the canonical
// home for artifacts the other eight SPERT® Suite apps depend on — the LICENSE
// every repo copies, the legal PDFs their footers link to, and the AI op
// contract the MCP server and SPERT Scheduler are both written against.
//
// `functions/` has its own Jest suite and is untouched by this config. Two
// runners in one repository is deliberate: they are separate packages with
// separate manifests, dependencies and builds, and they never interact. The
// rest of the suite standardised on Vitest, so the root follows that; the
// Cloud Functions suite predates it and stays on Jest.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
