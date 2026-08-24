/**
 * gdbx-config.js — GDBx Unified Global Config (MANDATORY, DO NOT CHANGE LINKS)
 *
 * This is the single source of truth for all GDBx interconnect endpoints.
 * Changing these links will confuse developers and break secure version distribution.
 *
 * DEFAULT_GLOBAL = Global mesh hubs (mandatory, always connected)
 *   - wss://gdbx.pages.dev/ws       — Pages global hub (primary)
 *   - wss://gdbx.xup.workers.dev/ws — Worker global hub (primary)
 *
 * DEFAULT_LOCAL = Local bridge (offline-first)
 *   - ws://absup:8787/ws            — Local daemon (ABsUP)
 *
 * VERSION_KEY = Global version distribution key (superadmin-signed)
 *   - sys/gdbx/version              — all nodes subscribe, secure updates
 *
 * OTHER HOSTS (per-user):
 *   - wss://gdbx.<account>.workers.dev/ws — per-account Workers deployment
 *   - https://<custom-host>/...           — other hosting (Vercel, Fly, etc.)
 *   These are ADDED as extra transports, but globals are ALWAYS connected
 *   alongside them to ensure secure version distribution.
 */

export const DEFAULT_GLOBAL = Object.freeze([
  "wss://gdbx.pages.dev/ws",
  "wss://gdbx.xup.workers.dev/ws",
]);

export const DEFAULT_LOCAL = "ws://absup:8787/ws";

export const VERSION_KEY = "sys/gdbx/version";

// MANDATORY — DO NOT CHANGE — these links are frozen to keep all GDBx nodes connected
export const MANDATORY_GLOBAL = Object.freeze([...DEFAULT_GLOBAL]);

export function getGlobalAddrs() {
  return [...DEFAULT_GLOBAL];
}

export function buildAddrs(customAddrs = []) {
  const custom = Array.isArray(customAddrs) ? customAddrs : [customAddrs].filter(Boolean);
  const all = [...MANDATORY_GLOBAL, ...custom, DEFAULT_LOCAL];
  return [...new Set(all)];
}

// Version of this SDK (for VERSION_KEY manifest)
export const GDBX_VERSION = "6.3.0";

Object.freeze(DEFAULT_GLOBAL);
Object.freeze(MANDATORY_GLOBAL);

export default {
  DEFAULT_GLOBAL,
  DEFAULT_LOCAL,
  VERSION_KEY,
  MANDATORY_GLOBAL,
  getGlobalAddrs,
  buildAddrs,
  GDBX_VERSION,
};
