#!/usr/bin/env node
// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Runs the Firestore Security Rules suite against the local emulator.
 *
 * WHY A LAUNCHER RATHER THAN A PLAIN npm SCRIPT
 * ---------------------------------------------
 * Two environment problems, and one rule about how to fail.
 *
 * 1. macOS ships a STUB /usr/bin/java that exits 1 with "Unable to locate a
 *    Java Runtime". It is on PATH ahead of everything, so a Homebrew JDK
 *    (keg-only, not linked) loses to it unless its bin directory is
 *    PREPENDED. Appending is not enough — that was the first thing tried
 *    here and it failed exactly this way.
 * 2. CI (ubuntu-latest) has a real java on PATH and no Homebrew at all.
 *
 * A single hardcoded PATH string cannot satisfy both, and a hardcoded
 * /opt/homebrew path in a committed script is wrong for CI regardless.
 *
 * THE RULE: if no working JRE is found, this EXITS NON-ZERO. It never skips.
 * A guard that quietly does nothing when its runtime is missing looks
 * identical to a guard that passed, and this one exists to hold a
 * cross-tenant read closed. Silence is the failure mode being designed out.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Does `java -version` actually succeed from this directory (or from PATH)? */
function javaWorks(binDir) {
  const exe = binDir ? join(binDir, 'java') : 'java';
  if (binDir && !existsSync(exe)) return false;
  const r = spawnSync(exe, ['-version'], { stdio: 'ignore' });
  return r.status === 0;
}

/** macOS's java_home reports a real JDK when one is installed. */
function macJavaHome() {
  const r = spawnSync('/usr/libexec/java_home', [], { encoding: 'utf8' });
  return r.status === 0 ? join(r.stdout.trim(), 'bin') : null;
}

function resolveJavaBinDir() {
  if (javaWorks(null)) return null; // already good — CI lands here
  const candidates = [
    '/opt/homebrew/opt/openjdk/bin', // Homebrew, Apple Silicon
    '/usr/local/opt/openjdk/bin', // Homebrew, Intel
    macJavaHome(),
  ].filter(Boolean);
  return candidates.find((dir) => javaWorks(dir)) ?? undefined;
}

const javaBinDir = resolveJavaBinDir();

if (javaBinDir === undefined) {
  console.error(
    [
      '',
      'Cannot run the Firestore rules suite: no working Java runtime found.',
      '',
      'The Firestore emulator requires a JRE. On macOS, note that /usr/bin/java',
      'is a stub that exits 1 — having it on PATH does not mean Java is installed.',
      '',
      '  macOS:  brew install openjdk',
      '  Linux:  apt-get install -y default-jre',
      '',
      'Failing rather than skipping: these tests hold a cross-tenant read closed,',
      'and a silent skip is indistinguishable from a pass.',
      '',
    ].join('\n'),
  );
  process.exit(1);
}

const env = { ...process.env };
if (javaBinDir) env.PATH = `${javaBinDir}:${env.PATH}`;

const result = spawnSync(
  'firebase',
  [
    'emulators:exec',
    '--only',
    'firestore',
    '--project',
    'spert-suite',
    'vitest run --config vitest.rules.config.ts',
  ],
  { stdio: 'inherit', env, shell: false },
);

if (result.error) {
  console.error(`\nFailed to launch the Firebase CLI: ${result.error.message}`);
  console.error('Is firebase-tools installed? It is a devDependency of this package.');
  process.exit(1);
}

process.exit(result.status ?? 1);
