const {onCall, onRequest, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {
  oneSignalApiKey,
  sendOneSignalPush,
} = require("./onesignal");

admin.initializeApp();

/**
 * Build notification body text for pickup alerts.
 * @param {string|null|undefined} licensePlate
 * @param {string|null|undefined} carDescription
 * @return {string}
 */
function buildPickupBody(licensePlate, carDescription) {
  if (licensePlate && carDescription) {
    return `${carDescription} - License: ${licensePlate}`;
  }
  if (licensePlate) {
    return `License Plate: ${licensePlate}`;
  }
  if (carDescription) {
    return carDescription;
  }
  return "Your parent has arrived for pickup";
}

/**
 * Send pickup notification to a student (Firestore notice only).
 * Parents/guardians are the OneSignal subscribers — LPR pushes go to them.
 * Called from the Flutter app when a guardian taps "I'm Here!".
 */
exports.sendPickupNotification = onCall(
    {secrets: [oneSignalApiKey]},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "User must be authenticated");
      }

      const {studentId} = request.data;
      const parentId = request.auth.uid;

      if (!studentId) {
        throw new HttpsError("invalid-argument", "studentId is required");
      }

      try {
        const parentDoc = await admin
            .firestore()
            .collection("users")
            .doc(parentId)
            .get();

        if (!parentDoc.exists) {
          throw new HttpsError("not-found", "Parent not found");
        }

        const wardIds = parentDoc.data().wardIds || [];
        if (!wardIds.includes(studentId)) {
          throw new HttpsError(
              "permission-denied",
              "Not authorized to notify this student",
          );
        }

        const studentDoc = await admin
            .firestore()
            .collection("users")
            .doc(studentId)
            .get();

        if (!studentDoc.exists) {
          throw new HttpsError("not-found", "Student not found");
        }

        const studentData = studentDoc.data();

        return {
          success: true,
          pushSent: false,
          reason: "students_use_firestore_notices",
          student: studentData.name || "Student",
        };
      } catch (error) {
        console.error("Error sending notification:", error);

        if (error instanceof HttpsError) {
          throw error;
        }

        const message = error.message || String(error);
        if (message.includes("not subscribed") ||
            message.includes("All included players are not subscribed")) {
          return {success: false, reason: "no_token"};
        }

        throw new HttpsError("internal", message);
      }
    },
);

/**
 * HTTP endpoint for tests, cameras, and license-plate systems.
 * Creates a Firestore notice and attempts a push notification.
 */
exports.sendPickupNotificationHttp = onRequest(
    {secrets: [oneSignalApiKey]},
    async (req, res) => {
      const payload = req.body.data || req.body;
      const {studentId, parentName, licensePlate, carDescription, ownerId} =
        payload;

      try {
        let finalStudentId = studentId;
        let finalOwnerId = ownerId;

        if (finalOwnerId && !finalStudentId) {
          const ownerDoc = await admin
              .firestore()
              .collection("users")
              .doc(finalOwnerId)
              .get();
          const wardIds = ownerDoc.data()?.wardIds || [];
          if (wardIds.length > 0) {
            finalStudentId = wardIds[0];
          }
        }

        if (!finalStudentId && licensePlate) {
          const studentQuery = await admin
              .firestore()
              .collection("users")
              .where("licensePlate", "==", licensePlate)
              .limit(1)
              .get();

          if (studentQuery.empty) {
            return res
                .status(404)
                .send({error: "No student mapped to this plate"});
          }
          finalStudentId = studentQuery.docs[0].id;
        }

        if (!finalStudentId) {
          return res.status(400).send({
            error: "studentId, ownerId with wards, or licensePlate required",
          });
        }

        const studentDoc = await admin
            .firestore()
            .collection("users")
            .doc(finalStudentId)
            .get();

        if (!studentDoc.exists) {
          return res.status(404).send({error: "Student not found"});
        }

        const studentData = studentDoc.data();

        if (!finalOwnerId) {
          const guardianQuery = await admin
              .firestore()
              .collection("users")
              .where("wardIds", "array-contains", finalStudentId)
              .limit(1)
              .get();
          if (!guardianQuery.empty) {
            finalOwnerId = guardianQuery.docs[0].id;
          }
        }

        const resolvedParentName = parentName || "Test Parent";
        let noticeId = null;

        if (finalOwnerId) {
          const noticesRef = admin.firestore().collection("notices");
          const existingNotices = await noticesRef
              .where("owner_id", "==", finalOwnerId)
              .where("ward_id", "==", finalStudentId)
              .where("cleared", "==", false)
              .get();

          const batch = admin.firestore().batch();
          for (const doc of existingNotices.docs) {
            batch.update(doc.reference, {cleared: true});
          }

          const noticeRef = noticesRef.doc();
          noticeId = noticeRef.id;
          batch.set(noticeRef, {
            arrival_time: admin.firestore.Timestamp.now(),
            ward_id: finalStudentId,
            ward_name: studentData.name || "Student",
            parent_name: resolvedParentName,
            student_grade: studentData.grade || 0,
            owner_id: finalOwnerId,
            cleared: false,
            ...(licensePlate ? {licensePlate} : {}),
            ...(carDescription ? {car_description: carDescription} : {}),
          });
          await batch.commit();
        }

        if (!finalOwnerId) {
          return res.status(200).send({
            success: true,
            noticeCreated: Boolean(noticeId),
            noticeId,
            pushSent: false,
            reason: "no_guardian",
            student: studentData.name,
          });
        }

        try {
          const response = await sendOneSignalPush({
            externalUserId: finalOwnerId,
            title: "Pickup detected",
            body: buildPickupBody(licensePlate, carDescription),
            data: {
              type: "plate_detected",
              licensePlate: licensePlate || "",
              wardName: studentData.name || "",
              timestamp: Date.now().toString(),
            },
          });

          return res.status(200).send({
            success: true,
            noticeCreated: Boolean(noticeId),
            noticeId,
            pushSent: true,
            messageId: response.id,
            student: studentData.name,
            ownerId: finalOwnerId,
          });
        } catch (pushError) {
          console.error("Push failed:", pushError);
          const reason = pushError.message?.includes("not subscribed") ?
            "no_token" :
            "push_failed";

          return res.status(200).send({
            success: true,
            noticeCreated: Boolean(noticeId),
            noticeId,
            pushSent: false,
            reason,
            student: studentData.name,
            ownerId: finalOwnerId,
          });
        }
      } catch (error) {
        console.error("Error:", error);
        return res.status(500).send({error: error.message});
      }
    },
);

// ─── Standalone modules ─────────────────────────────────────────────────────
// Kept out of this file because it gets rewritten wholesale (the OneSignal
// migration replaced 503 lines of it); one-line re-exports keep the conflict
// surface at a single line each.

const plates = require("./plates");
const userAdmin = require("./user_admin");
const links = require("./links");

// plate -> guardian index, so the detection pipeline does one read per
// detection instead of streaming the whole users collection.
exports.syncPlateIndex = plates.syncPlateIndex;

// User lifecycle. createUserAccount keys documents by Auth UID; the admin
// site's old addDoc() path minted random ids that no login could ever read.
exports.createUserAccount = userAdmin.createUserAccount;
exports.archiveUser = userAdmin.archiveUser;
exports.restoreUser = userAdmin.restoreUser;
exports.purgeArchivedUsers = userAdmin.purgeArchivedUsers;
exports.verifyStaffPin = userAdmin.verifyStaffPin;

// Guardian <-> student links. wardIds is the source of truth; guardianIds is
// mirrored so rules can authorise ward reads without an extra lookup.
exports.syncGuardianLinks = links.syncGuardianLinks;
exports.linkWardByEmail = links.linkWardByEmail;
exports.unlinkWard = links.unlinkWard;
