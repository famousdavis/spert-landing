// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import { FIELD_BUCKETS, type Bucket } from '../../rules-tests/allowlist-contracts';

/**
 * The bucketing map's CONTENT, not its shape.
 *
 * WHY A RUNTIME GUARD WHEN THE MAP IS ALREADY TYPED
 * -------------------------------------------------
 * `satisfies Record<keyof AllowlistContract, Bucket>` forces every field to
 * carry a label and forces each label to be well formed. It cannot force a
 * label to be TRUE. A map that assigns all nineteen fields
 * `{ kind: 'joined', joiner: 'x' }` type-checks perfectly, and every
 * type-level condition on that map - the missing-key error, the excess-key
 * error, the union's shape, even the `satisfies`-vs-annotation pin - passes on
 * it. That map would be worthless and nothing would say so.
 *
 * So this file asserts the two things a type cannot:
 *
 *   1. The CROSS-REPO SET is exactly the seven fields that are genuinely about
 *      another repository. Mislabel one of them `joined` and the pin fails,
 *      naming it. This is what a uniform map fails on.
 *   2. Every `joined` bucket's `joiner` NAMES A REAL SYMBOL IN A REAL FILE
 *      here. A joiner is a claim that something reds when the cell is wrong;
 *      an unresolvable joiner is that claim with nothing behind it, which is
 *      the exact defect the register was built to stop making about the app
 *      repositories.
 *
 * WHAT IT STILL CANNOT DO, SAID PLAINLY. Resolving a joiner proves the symbol
 * EXISTS, not that it actually falsifies the cell. That is a judgement a
 * reader makes, and this guard narrows the space it has to be made over rather
 * than removing it.
 */

/**
 * The cross-repo fields, from the register's own field census.
 *
 * PINNED AS A SET, NOT A COUNT. "Seven cross-repo fields" is satisfied by the
 * wrong seven; membership is not.
 */
const CROSS_REPO_FIELDS = [
  'appMax',
  'appMin',
  'clearable',
  'source',
  'minSource',
  'sourceVersion',
  'sourceCommit',
] as const;

const REPO_ROOT = process.cwd();

/** Split a `file:symbol` joiner, rejecting anything that is not that shape. */
function splitJoiner(joiner: string): { file: string; symbol: string } {
  const at = joiner.lastIndexOf(':');
  if (at <= 0) throw new Error(`joiner is not file:symbol - ${joiner}`);
  return { file: joiner.slice(0, at), symbol: joiner.slice(at + 1) };
}

const entries = Object.entries(FIELD_BUCKETS) as [string, Bucket][];

describe('register field buckets', () => {
  it('labels every field of the register exactly once', () => {
    // A floor on the population, so a field added to the interface without a
    // bucket cannot pass here by being invisible. `tsc` is the primary guard
    // (TS1360 names the missing key); this is the runtime echo of it.
    expect(entries.length, 'bucketed fields').toBe(19);
    expect(new Set(entries.map(([f]) => f)).size, 'distinct field names').toBe(19);
  });

  it('marks exactly the cross-repo fields as cross-repo', () => {
    const marked = entries
      .filter(([, b]) => b.kind === 'unjoined' && b.crossRepo)
      .map(([f]) => f)
      .sort();
    // THE KNOWN-BAD THIS EXISTS FOR: a map labelling all nineteen fields
    // identically. Uniformly `joined` gives [] here; uniformly cross-repo
    // gives all nineteen. Either way this reds and names the difference.
    expect(marked, 'fields bucketed crossRepo').toEqual([...CROSS_REPO_FIELDS].sort());
  });

  it('resolves every joiner to a real symbol in a real file', () => {
    const unresolved: string[] = [];

    for (const [field, bucket] of entries) {
      if (bucket.kind !== 'joined') continue;
      const { file, symbol } = splitJoiner(bucket.joiner);
      const abs = resolve(REPO_ROOT, file);
      if (!existsSync(abs)) {
        unresolved.push(`${field}: no such file - ${file}`);
        continue;
      }
      if (!readFileSync(abs, 'utf8').includes(symbol)) {
        unresolved.push(`${field}: ${file} does not contain ${symbol}`);
      }
    }

    // Rows, not a count - a number cannot say which joiner went missing.
    expect(unresolved, 'joiners naming something that is not there').toEqual([]);
  });

  it('gives every unjoined field a non-empty re-read trigger', () => {
    // The whole value of the unjoined bucket is that it says WHEN to look
    // again. An empty trigger is the bucket admitting nothing checks the cell
    // and then declining to say what would.
    const empty = entries
      .filter(([, b]) => b.kind === 'unjoined' && b.trigger.trim() === '')
      .map(([f]) => f);
    expect(empty, 'unjoined fields with no trigger').toEqual([]);
  });
});
