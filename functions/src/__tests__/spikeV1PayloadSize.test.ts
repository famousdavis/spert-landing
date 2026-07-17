// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

// Spike V1 (P0.3 — blocks Phase 1 release). Validates the 800 KB byte-guard
// margin. It measures the serialized op-doc size for a MAX-payload
// bulk_create_activities call (100 items, every string field at its schema cap)
// and confirms it sits under both the 800 KB proxy guard and Firestore's 1 MiB
// document limit. Finding: array caps (100) × per-item field caps keep any
// schema-valid activities payload near ~440 KB — comfortably under both
// ceilings — so the guard's real role is catching a pathological (server-bug)
// payload, and 1A's 25-50 item guidance is an AI-output-budget concern, not a
// storage one. The size formula here mirrors checkPayloadSize()'s JSON proxy.

const GUARD_BYTES = 800_000;
const FIRESTORE_LIMIT = 1_048_576; // 1 MiB

const repeat = (n: number): string => "a".repeat(n);

const maxActivityItem = (): object => ({
  id: repeat(64),
  name: repeat(200),
  min: 999999,
  mostLikely: 999999,
  max: 999999,
  confidenceLevel: "extremelyLowConfidence",
  distributionType: "logNormal",
  description: repeat(2000),
  note: repeat(2000),
});

const opDocBytes = (op: string, payload: object): number =>
  Buffer.byteLength(JSON.stringify({op, payload}));

describe("Spike V1 — bulk payload byte budget", () => {
  test("100 max-payload activities fit under the guard and Firestore limit",
    () => {
      const activities = Array.from({length: 100}, () => maxActivityItem());
      const payload = {scenarioId: repeat(64), activities};
      const bytes = opDocBytes("bulk_create_activities", payload);
      expect(bytes).toBeLessThan(GUARD_BYTES);
      expect(bytes).toBeLessThan(FIRESTORE_LIMIT);
      // A full-cap heavy batch is still a large emit (~440 KB), which is why
      // 1A caps the practical guidance at 25-50 items for heavy content.
      expect(bytes).toBeGreaterThan(300_000);
    });

  test("the guard's JSON proxy trips before 1 MiB for an oversized payload",
    () => {
      // Only reachable via a server bug (schema caps keep valid payloads
      // < ~440 KB): a JSON proxy over 800 KB is caught well before 1 MiB.
      const payload = {blob: repeat(850_000)};
      const bytes = opDocBytes("bulk_create_activities", payload);
      expect(bytes).toBeGreaterThan(GUARD_BYTES);
      expect(bytes).toBeLessThan(FIRESTORE_LIMIT);
    });
});
