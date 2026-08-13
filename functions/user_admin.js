/**
 * Admin-side user lifecycle: creation, archiving, purging, staff PIN.
 *
 * Standalone module so it survives rewrites of index.js. Hook up with:
 *   const userAdmin = require("./user_admin");
 *   exports.createUserAccount = userAdmin.createUserAccount;
 *   exports.archiveUser = userAdmin.archiveUser;
 *   exports.restoreUser = userAdmin.restoreUser;
 *   exports.purgeArchivedUsers = userAdmin.purgeArchivedUsers;
 *   exports.verifyStaffPin = userAdmin.verifyStaffPin;
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
};
