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
  bulkUpdateActivitiesShape,
  bulkImportScheduleShape,
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
// Two op shapes: single-array ops carry `array`/`cap`/`item`; the composite
// `bulk_import_schedule` carries `sections` (each an optional array with its
// own `cap`/`item`). Partition and drive each shape independently (P2).
interface SingleArrayOpSpec {
  tool: string;
  array: string;
  cap: {min: number; max: number};
  item: {[field: string]: FieldSpec};
}
interface SectionSpec {
  cap: {max: number};
  item: {[field: string]: FieldSpec};
}
interface MultiSectionOpSpec {
  tool: string;
  sections: {[section: string]: SectionSpec};
}
type OpSpec = SingleArrayOpSpec | MultiSectionOpSpec;
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
  bulk_update_activities: bulkUpdateActivitiesShape,
  bulk_import_schedule: bulkImportScheduleShape,
};

const isSingleArray = (s: OpSpec): s is SingleArrayOpSpec => "array" in s;
const singleArrayOps = Object.entries(contract.ops).filter(([, s]) =>
  isSingleArray(s),
) as [string, SingleArrayOpSpec][];
const sectionOps = Object.entries(contract.ops).filter(
  ([, s]) => !isSingleArray(s),
) as [string, MultiSectionOpSpec][];

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
  spec: SingleArrayOpSpec,
  items: unknown[],
): {[k: string]: unknown} =>
  ({sessionId: SID, scenarioId: "s1", [spec.array]: items});

// A minimal valid tool call for ANY op shape — one item in the (first) section.
const minimalArgs = (spec: OpSpec): {[k: string]: unknown} => {
  if (isSingleArray(spec)) return toolArgs(spec, [minimalItem(spec.item)]);
  const [section, sspec] = Object.entries(spec.sections)[0];
  return {
    sessionId: SID,
    scenarioId: "s1",
    [section]: [minimalItem(sspec.item)],
  };
};

describe.each(singleArrayOps)(
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

// The composite `bulk_import_schedule` — each optional section validated the
// same way (fields/required/wrong-type, enums, bounds), plus the "empty is
// structurally OK" rule (empty_import is a handler check, not a schema one).
describe.each(sectionOps)(
  "landing contract (composite) — %s",
  (op, spec) => {
    const schema = z.object(SHAPES[op]);

    test("absent sections parse; empty_import is handler-side", () => {
      expect(schema.safeParse({sessionId: SID}).success).toBe(true);
    });

    describe.each(Object.entries(spec.sections))(
      "section %s",
      (section, sspec) => {
        const build = (items: unknown[]) =>
          ({sessionId: SID, scenarioId: "s1", [section]: items});
        const parse = (items: unknown[]) =>
          schema.safeParse(build(items)).success;
        const withField = (field: string, value: unknown) =>
          parse([{...minimalItem(sspec.item), [field]: value}]);

        test("accepts a minimal valid section", () => {
          expect(parse([minimalItem(sspec.item)])).toBe(true);
        });

        test("allows an explicitly-empty section array (no .min)", () => {
          expect(parse([])).toBe(true);
        });

        test("enforces the section cap", () => {
          const item = minimalItem(sspec.item);
          expect(parse(Array(sspec.cap.max).fill(item))).toBe(true);
          expect(parse(Array(sspec.cap.max + 1).fill(item))).toBe(false);
        });

        test("requires required fields and rejects wrong types", () => {
          for (const field of Object.keys(sspec.item)) {
            const fspec = sspec.item[field];
            const wrong = fspec.type === "number" ? "nope" : 123;
            expect(withField(field, wrong)).toBe(false);
            if (fspec.required) {
              const missing = {...minimalItem(sspec.item)};
              delete missing[field];
              expect(parse([missing])).toBe(false);
            }
          }
        });

        test("enforces enum domains", () => {
          for (const field of Object.keys(sspec.item)) {
            const fspec = sspec.item[field];
            if (!fspec.enum) continue;
            for (const value of fspec.enum) {
              expect(withField(field, value)).toBe(true);
            }
            expect(withField(field, "__not_in_enum__")).toBe(false);
          }
        });

        test("enforces declared bounds", () => {
          for (const field of Object.keys(sspec.item)) {
            const fspec = sspec.item[field];
            if (typeof fspec.maxLen === "number") {
              const atMax = "a".repeat(fspec.maxLen);
              expect(withField(field, atMax)).toBe(true);
              expect(withField(field, atMax + "!")).toBe(false);
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
  },
);

describe("landing contract — envelope", () => {
  test("sessionId is required on every bulk tool", () => {
    for (const [op, spec] of Object.entries(contract.ops)) {
      const schema = z.object(SHAPES[op]);
      const args = minimalArgs(spec);
      delete args.sessionId;
      expect(schema.safeParse(args).success).toBe(false);
    }
  });

  test("scenarioId is required only for bulk_create_dependencies", () => {
    for (const [op, spec] of Object.entries(contract.ops)) {
      const schema = z.object(SHAPES[op]);
      const args = minimalArgs(spec);
      delete args.scenarioId;
      // Only the dependency-CREATE tool hard-requires scenarioId in its schema;
      // bulk_import makes it conditional in the handler (not structurally).
      const expected = op !== "bulk_create_dependencies";
      expect(schema.safeParse(args).success).toBe(expected);
    }
  });
});

// Op-name disjointness + fixture-accuracy assertions live in the registration
// test (mcpToolRegistration.test.ts, P0.6) alongside the collision check.
