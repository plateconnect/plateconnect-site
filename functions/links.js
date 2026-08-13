/**
 * Guardian <-> student links.
 *
 * `wardIds` on the guardian is the single source of truth. `guardianIds` on the
 * student is a mirror maintained by the syncGuardianLinks trigger, which makes
 * the relationship readable from both directions — and lets security rules
 * authorise "a guardian may read their ward's profile" with zero extra reads.
 *
 * Hook up with:
 *   const links = require("./links");
 *   exports.syncGuardianLinks = links.syncGuardianLinks;
 *   exports.linkWardByEmail = links.linkWardByEmail;
 *   exports.unlinkWard = links.unlinkWard;
 */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

/**
 * Ward ids on a user document, ignoring archived users.
 * @param {object} data A users/{uid} document body.
 * @return {!Array<string>} Ward ids.
 */
function wardIdsOf(data) {
  if (!data) return [];
  if (data.status && data.status !== "active") return [];
  return Array.isArray(data.wardIds) ? data.wardIds : [];
}

/**
 * Mirror `wardIds` onto each student as `guardianIds`.
 *
 * Terminates: it only ever writes `guardianIds` on student documents, and
 * students carry no `wardIds`, so the resulting re-trigger is a no-op.
 */
const syncGuardianLinks = onDocumentWritten("users/{uid}", async (event) => {
  const uid = event.params.uid;
  const before = wardIdsOf(event.data?.before?.data());
  const after = wardIdsOf(event.data?.after?.data());

  const added = after.filter((w) => !before.includes(w));
  const removed = before.filter((w) => !after.includes(w));
  if (added.length === 0 && removed.length === 0) return;

  const db = admin.firestore();
  const batch = db.batch();

  for (const wardId of added) {
    batch.set(db.collection("users").doc(wardId), {
      guardianIds: admin.firestore.FieldValue.arrayUnion(uid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  }
  for (const wardId of removed) {
    batch.set(db.collection("users").doc(wardId), {
      guardianIds: admin.firestore.FieldValue.arrayRemove(uid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
  }

  await batch.commit();
  console.log(
      `syncGuardianLinks: ${uid} +${added.length} -${removed.length} ward(s)`,
  );
});

/**
 * Link a student to the calling guardian by exact email.
 *
 * Replaces the client-side query in ward_link.dart. That query needed `list`
 * access to the users collection, and any rule permitting it would also let a
 * client enumerate every student in the school. Doing the lookup server-side
 * means the roster is never exposed — the caller learns only about the exact
 * address they already knew.
 */
const linkWardByEmail = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const guardianId = request.auth.uid;
  const email = String((request.data || {}).email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    throw new HttpsError("invalid-argument", "A valid email is required");
  }

  const db = admin.firestore();

  const guardianSnap = await db.collection("users").doc(guardianId).get();
  if (!guardianSnap.exists) {
    throw new HttpsError("not-found", "Your profile was not found");
  }
  if (guardianSnap.data().account_type !== "guardian") {
    throw new HttpsError(
        "permission-denied", "Only guardians can link a student",
    );
  }

  const matches = await db.collection("users")
      .where("email", "==", email)
      .where("account_type", "==", "student")
      .limit(2)
      .get();

  const active = matches.docs.filter(
      (d) => (d.data().status || "active") === "active",
  );
  if (active.length === 0) {
    throw new HttpsError(
        "not-found", "No student account found with this email",
    );
  }
  if (active.length > 1) {
    // Duplicate student emails should be impossible; fail loudly rather than
    // silently linking whichever sorted first.
    throw new HttpsError(
        "failed-precondition",
        "Multiple student accounts share that email — contact an admin",
    );
  }

  const student = active[0];
  const existing = guardianSnap.data().wardIds || [];
  if (existing.includes(student.id)) {
    throw new HttpsError(
        "already-exists", "This student is already linked",
    );
  }

  await db.collection("users").doc(guardianId).set({
    wardIds: admin.firestore.FieldValue.arrayUnion(student.id),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});
  // guardianIds is mirrored by syncGuardianLinks.

  return {
    wardId: student.id,
    name: student.data().name || "Student",
    grade: student.data().grade ?? null,
  };
});

/** Unlink a ward from the calling guardian. */
const unlinkWard = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  const {wardId} = request.data || {};
  if (!wardId) throw new HttpsError("invalid-argument", "wardId is required");

  await admin.firestore().collection("users").doc(request.auth.uid).set({
    wardIds: admin.firestore.FieldValue.arrayRemove(wardId),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, {merge: true});

  return {wardId, unlinked: true};
});

module.exports = {syncGuardianLinks, linkWardByEmail, unlinkWard};
