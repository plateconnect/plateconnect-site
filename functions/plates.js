/**
 * Maintains the `plates/{PLATE_NORMALIZED}` lookup index.
 *
 * The detection pipeline (platecap/firebase_send.py) resolves a license plate
 * with ONE document read instead of streaming the entire `users` collection on
 * every detection. This trigger keeps that index in sync with `users` so it can
 * never drift from the source of truth.
 *
 * Standalone module so it survives rewrites of index.js. Hook it up with:
 *   exports.syncPlateIndex = require("./plates").syncPlateIndex;
 */
const {onDocumentWritten} = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

/**
 * Canonical plate form used as the `plates` document ID.
 * MUST stay identical to normalize_plate() in platecap/firebase_send.py.
 *
 * Deliberately conservative: no O/0 or I/1 OCR-confusion folding, which would
 * raise the match rate but risks notifying the wrong family.
 *
 * @param {string} plate Raw plate text.
 * @return {string} Uppercased, alphanumeric-only plate.
 */
function normalizePlate(plate) {
  return String(plate || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Plate entries owned by a user document. Prefers the `vehicles` array of
 * objects; falls back to the legacy parallel arrays, pairing each plate with
 * the description at the SAME index (not always index 0).
 *
 * @param {object} data A users/{uid} document body.
 * @return {!Array<{norm: string, plate: string, description: ?string}>}
 *     Plate entries owned by this user.
 */
function userPlateEntries(data) {
  if (!data) return [];
  // Archived users and students never own an active plate.
  if (data.status && data.status !== "active") return [];
  if (data.account_type === "student") return [];

  const out = [];
  if (Array.isArray(data.vehicles) && data.vehicles.length > 0) {
    for (const v of data.vehicles) {
      if (!v || !v.plate) continue;
      out.push({
        norm: v.plateNormalized || normalizePlate(v.plate),
        plate: v.plate,
        description: v.description || null,
      });
    }
    return out;
  }

  const plates = data.licensePlateNumbers || [];
  const descriptions = data.carDescriptions || [];
  plates.forEach((plate, i) => {
    if (!plate) return;
    out.push({
      norm: normalizePlate(plate),
      plate,
      description: i < descriptions.length ? descriptions[i] : null,
    });
  });
  return out;
}

const syncPlateIndex = onDocumentWritten("users/{uid}", async (event) => {
  const uid = event.params.uid;
  const beforeEntries = userPlateEntries(event.data?.before?.data());
  const afterEntries = userPlateEntries(event.data?.after?.data());

  const beforeByNorm = new Map(beforeEntries.map((e) => [e.norm, e]));
  const afterByNorm = new Map(afterEntries.map((e) => [e.norm, e]));

  const db = admin.firestore();
  const batch = db.batch();
  let ops = 0;

  // Removed plates: only delete when this user still owns the index entry, so
  // a plate that legitimately moved to another guardian is not clobbered.
  for (const norm of beforeByNorm.keys()) {
    if (afterByNorm.has(norm)) continue;
    const ref = db.collection("plates").doc(norm);
    const snap = await ref.get();
    if (snap.exists && snap.data().guardianId === uid) {
      batch.delete(ref);
      ops++;
    }
  }

  // Added or changed plates.
  for (const [norm, entry] of afterByNorm) {
    const prev = beforeByNorm.get(norm);
    if (prev && prev.description === entry.description) continue;
    batch.set(db.collection("plates").doc(norm), {
      plate: entry.plate,
      plateNormalized: norm,
      guardianId: uid,
      description: entry.description,
      active: true,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, {merge: true});
    ops++;
  }

  if (ops > 0) {
    await batch.commit();
    console.log(`syncPlateIndex: ${ops} plate op(s) for user ${uid}`);
  }
});

module.exports = {syncPlateIndex, normalizePlate, userPlateEntries};
