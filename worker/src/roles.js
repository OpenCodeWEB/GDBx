/**
 * roles.js — GDBx zero-trust RBAC (GenosDB-inspired).
 *
 * Hierarchy: guest(0) → user(1) → manager(2) → admin(3) → superadmin(4)
 *
 * - A new DID registers as guest: read-only, cannot write.
 * - Roles are upgraded ONLY by a superadmin-signed `identity.promote` action.
 * - superadmin set comes from the ROOT_PUBKEYS worker var (comma-separated
 *   GDBx/SEA public keys).
 * - Node-level ACL: each addr keeps a `collaborators` list (owner + collabs
 *   may write shared keys).
 */

export const ROLES = Object.freeze({
  guest: 0,
  user: 1,
  manager: 2,
  admin: 3,
  superadmin: 4,
});

export const ROLE_NAMES = Object.freeze({
  0: "guest",
  1: "user",
  2: "manager",
  3: "admin",
  4: "superadmin",
});

/** Human name for a role level. */
export function roleName(level) {
  return ROLE_NAMES[level] || "unknown";
}

/** Guests are write-blocked; everyone above guest may write (ACL still applies). */
export function canWrite(level) {
  return Number(level) >= ROLES.user;
}

/**
 * Is this pubkey in the superadmin set?
 * @param {string} pub   GDBx/SEA pubkey (x.y)
 * @param {string|undefined} rootPubkeys  comma-separated ROOT_PUBKEYS env
 */
export function isSuperadminPub(pub, rootPubkeys) {
  if (!pub || !rootPubkeys) return false;
  const set = String(rootPubkeys).split(",").map((s) => s.trim()).filter(Boolean);
  return set.includes(pub);
}

/**
 * Validate a promotion target role string.
 * @param {string} role  "user" | "manager" | "admin" | "superadmin"
 * @returns {number|null} role level or null when invalid
 */
export function parsePromoteRole(role) {
  if (role === "user") return ROLES.user;
  if (role === "manager") return ROLES.manager;
  if (role === "admin") return ROLES.admin;
  if (role === "superadmin") return ROLES.superadmin;
  return null;
}

export default { ROLES, ROLE_NAMES, roleName, canWrite, isSuperadminPub, parsePromoteRole };