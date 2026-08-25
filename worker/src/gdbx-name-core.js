/**
 * gdbx-name-core.js — shared name-difficulty bracket (worker-side import).
 * Mirrors sdk/gdbx-name.js getNameDifficulty: short names cost more.
 */
export function getNameDifficulty(name) {
  const len = String(name || "").length;
  if (len <= 4) return 4;
  if (len <= 8) return 3;
  return 2;
}
