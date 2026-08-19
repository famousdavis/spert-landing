// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { defineConfig } from 'vitest/config';

// Firestore Security Rules tests. SEPARATE from vitest.config.ts on purpose:
// these require the Firestore emulator to be running, so they must never join
// the `npm test` guard suite that CI and the ship gate run unconditionally.
// They are invoked only via `npm run test:rules`, which wraps them in
// `firebase emulators:exec`.
//
// The suite is slower than the guards (emulator round-trips, not pure
// functions), hence the raised timeout.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['rules-tests/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // The emulator is a single shared server; parallel files racing to seed
    // and clear the same collections is a false-failure generator.
    fileParallelism: false,
  },
});
