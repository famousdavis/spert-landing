// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.

import {z} from "zod";
import {readFileSync} from "fs";
import {join} from "path";
import {
  bulkCreateActivitiesShape,
  bulkCreateDependenciesShape,
  bulkCreateMilestonesShape,
  bulkAssignMilestonesShape,
} from "../mcp/tools/scheduler";

// Contract test (landing half, P0.2 / F3-7). Drives the EXPORTED raw shapes —
// no Zod _def walking — against the shared fixture. The landing half asserts
// everything: item fields, required/optional, enum domains, content bounds, and
// array caps. The fixture is duplicated verbatim across repos; contract:hash
// pins that.

interface FieldSpec {
  required: boolean;
  type: "string" | "number";
  enum?: string[];
  minLen?: number;
  maxLen?: number;
  min?: number;
  max?: number;
  int?: boolean;
  nonnegative?: boolean;
  pattern?: string;
}
interface OpSpec {
  tool: string;
  array: string;
  cap: {min: number; max: number};
  item: {[field: string]: FieldSpec};
}
interface Contract {
  ops: {[op: string]: OpSpec};
  schedulerOps: string[];
  storymapOps: string[];
}

const contract: Contract = JSON.parse(
  readFileSync(join(__dirname, "../mcp/ai-op-contract.json"), "utf8"),
);

const SHAPES: {[op: string]: z.ZodRawShape} = {
  bulk_create_activities: bulkCreateActivitiesShape,
  bulk_create_dependencies: bulkCreateDependenciesShape,
  bulk_create_milestones: bulkCreateMilestonesShape,
  bulk_assign_milestones: bulkAssignMilestonesShape,
};

const SID = "00000000-0000-4000-8000-000000000000";

const sampleFor = (spec: FieldSpec): unknown => {
  if (spec.type === "number") return spec.nonnegative ? 1 : 0;
  if (spec.enum) return spec.enum[0];
  if (spec.pattern) return "2025-01-15";
  return "x";
};
const minimalItem = (
  item: {[f: string]: FieldSpec},
): {[k: string]: unknown} => {
  const out: {[k: string]: unknown} = {};
  for (const field of Object.keys(item)) {
    if (item[field].required) out[field] = sampleFor(item[field]);
  }
  return out;
};
const toolArgs = (
  spec: OpSpec,
  items: unknown[],
): {[k: string]: unknown} =>
  ({sessionId: SID, scenarioId: "s1", [spec.array]: items});

describe.each(Object.entries(contract.ops))(
  "landing contract — %s",
  (op, spec) => {
    const schema = z.object(SHAPES[op]);
    const parse = (items: unknown[]) =>
      schema.safeParse(toolArgs(spec, items)).success;
    const withField = (field: string, value: unknown) =>
      parse([{...minimalItem(spec.item), [field]: value}]);

    test("has an exported raw shape", () => {
      expect(SHAPES[op]).toBeDefined();
    });

    test("accepts a minimal valid tool call", () => {
      expect(parse([minimalItem(spec.item)])).toBe(true);
    });

    test("enforces the array-length cap", () => {
      const item = minimalItem(spec.item);
      expect(parse([])).toBe(false);
      expect(parse(Array(spec.cap.max).fill(item))).toBe(true);
      expect(parse(Array(spec.cap.max + 1).fill(item))).toBe(false);
    });

    test("requires required item fields and rejects wrong types", () => {
      for (const field of Object.keys(spec.item)) {
        const fspec = spec.item[field];
        const wrong = fspec.type === "number" ? "nope" : 123;
        expect(withField(field, wrong)).toBe(false);
        if (fspec.required) {
          const missing = {...minimalItem(spec.item)};
          delete missing[field];
          expect(parse([missing])).toBe(false);
        }
      }
    });

    test("enforces enum domains", () => {
      for (const field of Object.keys(spec.item)) {
        const fspec = spec.item[field];
        if (!fspec.enum) continue;
        for (const value of fspec.enum) {
          expect(withField(field, value)).toBe(true);
        }
        expect(withField(field, "__not_in_enum__")).toBe(false);
      }
    });

    test("enforces declared bounds", () => {
      for (const field of Object.keys(spec.item)) {
        const fspec = spec.item[field];
        if (typeof fspec.maxLen === "number") {
          expect(withField(field, "a".repeat(fspec.maxLen))).toBe(true);
          expect(withField(field, "a".repeat(fspec.maxLen + 1))).toBe(false);
        }
        if (typeof fspec.minLen === "number" && fspec.minLen > 0) {
          expect(withField(field, "")).toBe(false);
        }
        if (fspec.nonnegative) expect(withField(field, -1)).toBe(false);
        if (fspec.int) expect(withField(field, 1.5)).toBe(false);
        if (typeof fspec.min === "number") {
          expect(withField(field, fspec.min)).toBe(true);
          expect(withField(field, fspec.min - 1)).toBe(false);
        }
        if (typeof fspec.max === "number") {
          expect(withField(field, fspec.max)).toBe(true);
          expect(withField(field, fspec.max + 1)).toBe(false);
        }
        if (fspec.pattern) {
          expect(withField(field, "2025-01-15")).toBe(true);
          expect(withField(field, "not-a-date")).toBe(false);
        }
      }
    });
  },
);

describe("landing contract — envelope", () => {
  test("sessionId is required on every bulk tool", () => {
    for (const [op, spec] of Object.entries(contract.ops)) {
      const schema = z.object(SHAPES[op]);
      const args = toolArgs(spec, [minimalItem(spec.item)]);
      delete args.sessionId;
      expect(schema.safeParse(args).success).toBe(false);
    }
  });

  test("scenarioId is required only for bulk_create_dependencies", () => {
    for (const [op, spec] of Object.entries(contract.ops)) {
      const schema = z.object(SHAPES[op]);
      const args = toolArgs(spec, [minimalItem(spec.item)]);
      delete args.scenarioId;
      const expected = op !== "bulk_create_dependencies";
      expect(schema.safeParse(args).success).toBe(expected);
    }
  });
});

// Op-name disjointness + fixture-accuracy assertions live in the registration
// test (mcpToolRegistration.test.ts, P0.6) alongside the collision check.
