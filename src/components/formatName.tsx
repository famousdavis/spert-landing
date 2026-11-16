// Copyright (C) 2026 William W. Davis, MSPM, PMP. All rights reserved.
// Licensed under the GNU General Public License v3.0.
// See LICENSE file in the project root for full license text.

/**
 * Renders a product name with its ® or ™ small and raised, never at heading
 * size (the house rule: text-xs / 0.6em). Used by the homepage tiles and the
 * Help Center pages.
 */

const MARK_STYLE = "text-xs font-normal text-zinc-400 dark:text-zinc-500 align-super";

export function formatName(name: string) {
  // Split on ® and ™ while keeping the delimiter
  const tokens = name.split(/(®|™)/);
  if (tokens.length === 1) return <>{name}</>;
  return (
    <>
      {tokens.map((token, i) =>
        token === '®' || token === '™' ? (
          <span key={i} className={MARK_STYLE}>{token}</span>
        ) : (
          <span key={i}>{token}</span>
        )
      )}
    </>
  );
}
