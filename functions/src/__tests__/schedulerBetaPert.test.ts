// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {z} from "zod";
import {registerSchedulerTools} from "../mcp/tools/scheduler";

// SPERT Scheduler v0.72.0 added a fifth distribution, "betaPert". Every
// scheduler tool that takes a distributionType must accept it, and the check
// has to be POSITIVE and made here: aiOpContract.test.ts drives the fixture's
// enum domains against the exported bulk shapes, so it asks whether each value
// the FIXTURE lists is accepted — and it covers neither of the two singular
// tools, whose shapes are inline in registerSchedulerTools. These tests read
// the shapes the server actually REGISTERS, for all five tools that carry the
// field. Each control proves its tool validates the field at all: a shape
// without it would strip the unknown key and accept anything.

type SchedulerParams = Parameters<typeof registerSchedulerTools>;

/**
 * Register the scheduler tools on a fake server and keep each tool's raw
 * shape. server.tool() is called as (name, description, shape, handler).
 * @return {Map<string, z.ZodRawShape>} Tool name to its registered shape.
 */
function registeredShapes(): Map<string, z.ZodRawShape> {
  const shapes = new Map<string, z.ZodRawShape>();
  const server = {
    tool: (...args: unknown[]): void => {
      shapes.set(args[0] as string, args[2] as z.ZodRawShape);
    },
  };
  // Registration captures db in closures but never calls it.
  registerSchedulerTools(
    server as unknown as SchedulerParams[0],
    {} as SchedulerParams[1],
  );
  return shapes;
}

const SESSION = "0b5e7a32-8f1c-4d2e-9a6b-3c4d5e6f7a8b";
const activity = (distributionType: string) => ({
  id: "a1",
  name: "Beta",
  min: 10,
  mostLikely: 12,
  max: 40,
  distributionType,
});

const CASES: Array<[string, (dt: string) => Record<string, unknown>]> = [
  ["scheduler_create_activity",
    (dt) => ({sessionId: SESSION, ...activity(dt)})],
  ["scheduler_update_activity_estimate",
    (dt) => ({sessionId: SESSION, id: "a1", distributionType: dt})],
  ["scheduler_bulk_create_activities",
    (dt) => ({sessionId: SESSION, activities: [activity(dt)]})],
  ["scheduler_bulk_update_activities",
    (dt) => ({sessionId: SESSION, updates: [{id: "a1", distributionType: dt}]})],
  ["scheduler_bulk_import",
    (dt) => ({sessionId: SESSION, activities: [activity(dt)]})],
];

describe("scheduler tools accept Beta-PERT (SPERT Scheduler v0.72.0)", () => {
  const shapes = registeredShapes();

  test.each(CASES)("%s accepts distributionType \"betaPert\"", (tool, args) => {
    const shape = shapes.get(tool);
    expect(shape).toBeDefined();
    expect(z.object(shape as z.ZodRawShape).safeParse(args("betaPert")).success)
      .toBe(true);
  });

  test.each(CASES)("%s still refuses a value no build knows", (tool, args) => {
    const shape = shapes.get(tool) as z.ZodRawShape;
    expect(z.object(shape).safeParse(args("__not_a_type__")).success).toBe(false);
  });
});
