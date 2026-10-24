// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

// AI-8 (2026-10-24 audit): every scheduler tool that carries an estimate
// refuses a non-finite or over-cap value. Zod's number() alone accepts
// Infinity. The cap matches the scheduler client's ESTIMATE_MAX (3650), so
// each pair below differs only by one day across the boundary.

import {z} from "zod";
import {registerSchedulerTools} from "../mcp/tools/scheduler";

type SchedulerParams = Parameters<typeof registerSchedulerTools>;

/**
 * Capture every tool's input shape by registering against a fake server.
 * @return {Map<string, z.ZodRawShape>} Tool name to its registered shape.
 */
function registeredShapes(): Map<string, z.ZodRawShape> {
  const shapes = new Map<string, z.ZodRawShape>();
  const server = {
    tool: (...args: unknown[]): void => {
      shapes.set(args[0] as string, args[2] as z.ZodRawShape);
    },
  };
  registerSchedulerTools(
    server as unknown as SchedulerParams[0],
    {} as SchedulerParams[1],
  );
  return shapes;
}

const SESSION = "0b5e7a32-8f1c-4d2e-9a6b-3c4d5e6f7a8b";
const FIELDS = ["min", "mostLikely", "max"] as const;
type Field = typeof FIELDS[number];

/**
 * A valid activity with one estimate field replaced.
 * @param {Field} field The estimate field under test.
 * @param {number} value The value to place in it.
 * @return {Record<string, unknown>} The activity item.
 */
function activity(field: Field, value: number): Record<string, unknown> {
  return {id: "a1", name: "Task", min: 1, mostLikely: 2, max: 3, [field]: value};
}

const CASES: Array<[string, (f: Field, v: number) => Record<string, unknown>]> = [
  ["scheduler_create_activity",
    (f, v) => ({sessionId: SESSION, ...activity(f, v)})],
  ["scheduler_update_activity_estimate",
    (f, v) => ({sessionId: SESSION, id: "a1", [f]: v})],
  ["scheduler_bulk_create_activities",
    (f, v) => ({sessionId: SESSION, activities: [activity(f, v)]})],
  ["scheduler_bulk_update_activities",
    (f, v) => ({sessionId: SESSION, updates: [{id: "a1", [f]: v}]})],
  ["scheduler_bulk_import",
    (f, v) => ({sessionId: SESSION, activities: [activity(f, v)]})],
];

const MATRIX = CASES.flatMap(([tool, args]) =>
  FIELDS.map((field) => [tool, field, args] as const));

describe("scheduler estimate bounds (AI-8)", () => {
  const shapes = registeredShapes();
  const parses = (tool: string, args: Record<string, unknown>): boolean => {
    const shape = shapes.get(tool);
    if (!shape) throw new Error(`tool not registered: ${tool}`);
    return z.object(shape).safeParse(args).success;
  };

  test.each(MATRIX)("%s %s accepts 3650 (the cap)", (tool, field, args) => {
    expect(parses(tool, args(field, 3650))).toBe(true);
  });

  test.each(MATRIX)("%s %s refuses 3651", (tool, field, args) => {
    expect(parses(tool, args(field, 3651))).toBe(false);
  });

  test.each(MATRIX)("%s %s refuses Infinity", (tool, field, args) => {
    expect(parses(tool, args(field, Infinity))).toBe(false);
    expect(parses(tool, args(field, -Infinity))).toBe(false);
  });
});
