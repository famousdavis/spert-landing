// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

'use client';

import { useState } from 'react';

/**
 * Copies a fixed string to the clipboard. The string is also on the page as
 * text, so a browser that refuses clipboard access leaves the reader nothing
 * worse than selecting it by hand; the button then says so.
 */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      setState('failed');
    }
    window.setTimeout(() => setState('idle'), 2500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-md border border-zinc-300 px-3 py-1 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-500 hover:text-zinc-900 dark:border-zinc-600 dark:text-zinc-300 dark:hover:border-zinc-400 dark:hover:text-zinc-100"
    >
      {state === 'idle' ? label : state === 'copied' ? 'Copied' : 'Select it by hand'}
      {/* Announces the result to a screen reader, which does not re-read a button whose text changes. */}
      <span className="sr-only" aria-live="polite">
        {state === 'copied' ? 'Copied to the clipboard' : state === 'failed' ? 'Could not copy. Select the address by hand.' : ''}
      </span>
    </button>
  );
}
