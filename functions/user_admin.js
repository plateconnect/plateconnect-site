/**
 * Admin-side user lifecycle: creation, archiving, purging, staff PIN,
 * granting/revoking admin.
 *
 * Standalone module so it survives rewrites of index.js. Hook up with:
 *   const userAdmin = require("./user_admin");
 *   exports.createUserAccount = userAdmin.createUserAccount;
 *   exports.archiveUser = userAdmin.archiveUser;
 *   exports.restoreUser = userAdmin.restoreUser;
 *   exports.purgeArchivedUsers = userAdmin.purgeArchivedUsers;
 *   exports.verifyStaffPin = userAdmin.verifyStaffPin;
 *   exports.setUserPrivilege = userAdmin.setUserPrivilege;
 */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

const PURGE_AFTER_DAYS = 90;

// Every account_type the system recognises. Kept in one place because the
// value was previously free text: a CSV import in Aug 2026 introduced
// "facilty" as a silent typo alongside "faculty", and nothing rejected it.
const ROLES = [
  "guardian", "student", "teacher", "staff", "faculty", "admin",
];

// Roles that actually sign in. Everything else is a vehicle registration so
// the gate recognises the car, and needs no Auth account.
const LOGIN_ROLES = ["guardian", "student"];

/**
 * Throw unless the caller holds the admin custom claim.
 * @param {object} request Callable request.
 * @return {string} The caller's uid.
 */
function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  if (request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin privileges required");
  }
  return request.auth.uid;
}

/**
 * Create a user, keyed by Auth UID.
 *
 * The admin website previously used addDoc(), which mints a RANDOM document
 * id. Every read is doc(db,'users',currentUser.uid), so those users could
 * never load their own profile — they appeared in the admin list but could not
 * actually use the app. This creates the Auth account first and keys the
 * Firestore document by that UID.
 *
 * Idempotent: if the email already has an Auth account, the existing UID is
 * reused and its profile document is repaired rather than erroring. That is
 * exactly the state left behind by the users-collection deletion.
 */
const createUserAccount = onCall(async (request) => {
  requireAdmin(request);

  const {
    email, name, accountType, grade, vehicles, wardIds, sendReset, createLogin,
  } = request.data || {};

  if (!email || !String(email).includes("@")) {
    throw new HttpsError("invalid-argument", "A valid email is required");
  }
  const role = accountType || "guardian";
  if (!ROLES.includes(role)) {
    throw new HttpsError(
        "invalid-argument",
        `Unknown account_type "${role}". Allowed: ${ROLES.join(", ")}`,
    );
  }

  const displayName = name || String(email).split("@")[0];

  // Only guardians and students sign in. Faculty/staff rows are usually just
  // vehicle registrations so the gate recognises their car — minting ~100
  // unusable Auth accounts for them would be pure noise. Callers can override
  // either way with createLogin.
  const wantsLogin = typeof createLogin === "boolean" ?
    createLogin :
    LOGIN_ROLES.includes(role);

  const db = admin.firestore();

  if (!wantsLogin) {
    // Reuse an existing row for this email so re-importing a CSV updates
    // rather than duplicating.
    const dup = await db.collection("users")
        .where("email", "==", email).limit(1).get();
    const ref = dup.empty ? db.collection("users").doc() : dup.docs[0].ref;
    const body = {
      email,
      name: displayName,
      account_type: role,
      status: "active",
      onboardingComplete: false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (Array.isArray(vehicles)) body.vehicles = vehicles;
    if (dup.empty) {
      body.createdAt = admin.firestore.FieldValue.serverTimestamp();
    }
    await ref.set(body, {merge: true});
    return {uid: ref.id, created: dup.empty, loginCreated: false,
      resetLink: null};
  }

  let user;
  let created = false;
  try {
    user = await admin.auth().getUserByEmail(email);
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
    user = await admin.auth().createUser({
      email,
      displayName,
      // No password: the account is claimed through a reset link, so no
      // shared secret is ever transmitted or stored.
      password: require("crypto").randomBytes(32).toString("hex"),
    });
    created = true;
  }

  const profile = {
    email,
    name: displayName,
    account_type: role,
    status: "active",
    onboardingComplete: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (role === "student" && Number.isInteger(grade)) {
    profile.grade = grade;
  }
  if (Array.isArray(vehicles)) profile.vehicles = vehicles;
  if (Array.isArray(wardIds)) profile.wardIds = wardIds;

  const ref = admin.firestore().collection("users").doc(user.uid);
  const existing = await ref.get();
  if (!existing.exists) {
    profile.createdAt = admin.firestore.FieldValue.serverTimestamp();
  }
  await ref.set(profile, {merge: true});

  let resetLink = null;
  if (sendReset !== false) {
    resetLink = await admin.auth().generatePasswordResetLink(email);
  }

  return {
    uid: user.uid,
    created,
    repairedProfile: !created && !existing.exists,
    resetLink,
  };
});

/**
 * Archive a user (soft delete).
 *
 * Nothing is destroyed, so "removing old users" is always reversible — the
 * chore that caused the Aug 2026 data loss. The syncPlateIndex trigger drops
 * an archived guardian's plates automatically, so they stop matching at the
 * gate immediately.
 */
const archiveUser = onCall(async (request) => {
  const callerUid = requireAdmin(request);
  const {uid} = request.data || {};
  if (!uid) throw new HttpsError("invalid-argument", "uid is required");
  if (uid === callerUid) {
    throw new HttpsError("failed-precondition", "You cannot archive yourself");
  }

  const ref = admin.firestore().collection("users").doc(uid);
  if (!(await ref.get()).exists) {
    throw new HttpsError("not-found", `No user document for ${uid}`);
  }

  await ref.set({
    status: "archived",
    archivedAt: admin.firestore.FieldValue.serverTimestamp(),
    archivedBy: callerUid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  // Block sign-in without destroying the account.
  try {
    await admin.auth().updateUser(uid, {disabled: true});
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }

  return {uid, status: "archived"};
});

/**
 * Count Auth users currently holding the admin claim.
 *
 * Reads Auth directly rather than the users/{uid}.admin mirror. The mirror
 * is written by this same function and by set_claims.py, but a safety check
 * that decides whether an action is allowed should not trust a copy that
 * something else could in principle have gotten out of sync — it should
 * check the thing that actually grants access.
 * @param {{excludeUid?: string}} opts uid to leave out of the count, so a
 *   revoke can ask "how many admins remain besides the one being revoked".
 * @return {Promise<number>}
 */
async function countAdmins({excludeUid} = {}) {
  let count = 0;
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    for (const u of page.users) {
      if (u.uid === excludeUid) continue;
      if (u.customClaims && u.customClaims.admin === true) count++;
    }
    pageToken = page.pageToken;
  } while (pageToken);
  return count;
}

/**
 * Grant or revoke the admin claim for a user. The in-website equivalent of
 * `set_claims.py --grant admin` / `--revoke admin`.
 *
 * set_claims.py leaves three things to the operator's judgment that this
 * callable enforces instead, since it will be used by less technical staff
 * through a UI rather than someone comfortable reading a CLI warning:
 *   - a caller can never change their own admin status. Not just to stop
 *     someone locking themselves out — requireAdmin() already means the
 *     caller is an admin, so self-service escalation isn't a risk here, but
 *     self-revocation by mistake is, and there is no legitimate reason for
 *     an admin to need to touch their own row through this path.
 *   - revoking the last remaining admin is refused outright. set_claims.py
 *     only warns after the fact; this is the button whoever eventually
 *     causes the Aug-2026-style lockout will click, so it should not let
 *     that happen silently.
 *   - every change is written to adminAuditLog: who changed whom, from what
 *     to what, and when. There was previously no record of who granted
 *     admin to anyone.
 *
 * On revoke, existing sessions are force-refreshed via revokeRefreshTokens
 * so access ends immediately rather than up to ~1 hour later when the
 * person's ID token would naturally expire.
 */
const setUserPrivilege = onCall(async (request) => {
  const callerUid = requireAdmin(request);
  const {uid, admin: grantAdmin} = request.data || {};

  if (!uid) throw new HttpsError("invalid-argument", "uid is required");
  if (typeof grantAdmin !== "boolean") {
    throw new HttpsError(
        "invalid-argument",
        "admin must be true (grant) or false (revoke)",
    );
  }
  if (uid === callerUid) {
    throw new HttpsError(
        "failed-precondition",
        "You cannot change your own admin status",
    );
  }

  let targetUser;
  try {
    targetUser = await admin.auth().getUser(uid);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      throw new HttpsError(
          "not-found",
          `No login account for uid ${uid}. Admin access requires one — ` +
          "this user may only be a vehicle registration.",
      );
    }
    throw e;
  }

  const wasAdmin = Boolean(
      targetUser.customClaims && targetUser.customClaims.admin === true,
  );
  if (wasAdmin === grantAdmin) {
    return {uid, admin: grantAdmin, changed: false};
  }

  if (!grantAdmin) {
    const remaining = await countAdmins({excludeUid: uid});
    if (remaining === 0) {
      throw new HttpsError(
          "failed-precondition",
          "Refusing to remove the last admin — grant admin to someone " +
          "else first, or the portal becomes unreachable.",
      );
    }
  }

  const claims = Object.assign({}, targetUser.customClaims || {});
  if (grantAdmin) {
    claims.admin = true;
  } else {
    delete claims.admin;
  }
  await admin.auth().setCustomUserClaims(uid, claims);

  // Mirror for the admin-list UI — the same field set_claims.py maintains.
  // Not the gate; security rules and AuthContext read the claim, not this.
  await admin.firestore().collection("users").doc(uid).set({
    admin: grantAdmin,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  if (!grantAdmin) {
    await admin.auth().revokeRefreshTokens(uid);
  }

  await admin.firestore().collection("adminAuditLog").add({
    action: grantAdmin ? "grant_admin" : "revoke_admin",
    targetUid: uid,
    targetEmail: targetUser.email || null,
    actorUid: callerUid,
    actorEmail: (request.auth.token && request.auth.token.email) || null,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {uid, admin: grantAdmin, changed: true};
});

/** Restore an archived user. */
const restoreUser = onCall(async (request) => {
  requireAdmin(request);
  const {uid} = request.data || {};
  if (!uid) throw new HttpsError("invalid-argument", "uid is required");

  await admin.firestore().collection("users").doc(uid).set({
    status: "active",
    archivedAt: admin.firestore.FieldValue.delete(),
    archivedBy: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  try {
    await admin.auth().updateUser(uid, {disabled: false});
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }

  return {uid, status: "active"};
});

/**
 * Permanently remove users archived longer than PURGE_AFTER_DAYS.
 * Runs weekly. This is the ONLY path that hard-deletes a user.
 */
const purgeArchivedUsers = onSchedule("every sunday 04:17", async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(
      Date.now() - PURGE_AFTER_DAYS * 24 * 60 * 60 * 1000,
  );

  const stale = await admin.firestore()
      .collection("users")
      .where("status", "==", "archived")
      .where("archivedAt", "<", cutoff)
      .get();

  if (stale.empty) {
    console.log("purgeArchivedUsers: nothing to purge");
    return;
  }

  const batch = admin.firestore().batch();
  for (const doc of stale.docs) {
    batch.delete(doc.reference);
    try {
      await admin.auth().deleteUser(doc.id);
    } catch (e) {
      if (e.code !== "auth/user-not-found") {
        console.error(`purge: could not delete auth user ${doc.id}`, e);
      }
    }
  }
  await batch.commit();
  console.log(`purgeArchivedUsers: purged ${stale.size} user(s)`);
});

/**
 * Validate the shared staff PIN server-side and mint a short-lived token
 * carrying the `staff` claim.
 *
 * Previously account_chooser.dart read `pins/rootPin` directly and compared
 * client-side, which meant anyone who could read the collection learned the
 * PIN. Security rules now deny that read; the PIN never leaves the server.
 *
 * ⚠️ A shared 4-digit PIN is weak regardless of where it is compared, and it
 * guards minors' pickup data. Real staff accounts with a `staff` claim
 * (set_claims.py --grant staff) are the proper fix; this preserves the
 * existing flow in the meantime. Enable App Check to limit brute force.
 */
const verifyStaffPin = onCall(async (request) => {
  const {pin} = request.data || {};
  if (!pin) throw new HttpsError("invalid-argument", "pin is required");

  const snap = await admin.firestore().collection("pins").doc("rootPin").get();
  if (!snap.exists) {
    throw new HttpsError("not-found", "No staff PIN configured");
  }

  if (String(snap.data().pin) !== String(pin)) {
    // Deliberately vague, and no indication of how close the guess was.
    throw new HttpsError("permission-denied", "Incorrect PIN");
  }

  // Shared identity, matching the shared nature of the PIN. Real per-teacher
  // accounts should replace this.
  const token = await admin.auth().createCustomToken("staff-pin", {
    staff: true,
  });
  return {token};
});

module.exports = {
  createUserAccount,
  archiveUser,
  restoreUser,
  purgeArchivedUsers,
  verifyStaffPin,
  setUserPrivilege,
};
