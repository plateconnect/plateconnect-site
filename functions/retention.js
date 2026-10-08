/**
 * Automatic deletion of old arrival logs.
 *
 * `arrivals` is append-only (~990 documents a day) and nothing else removes
 * rows from it, so without this it grows forever.
 *
 * Configured from the website's Settings page via `settings/arrivalRetention`
 * ({enabled: boolean, days: integer}). That document is admin-writable only
 * and its shape is enforced in firestore.rules. When it does not exist the
 * defaults below apply, so retention is on out of the box.
 *
 * This function is the only code path that deletes arrivals. It records what
 * each run did in `settings/arrivalRetentionLastRun` (function-written; clients
 * cannot write it) so the Settings page can show it.
 *
 * Wire up in index.js:
 *   exports.pruneOldArrivals = require("./retention").pruneOldArrivals;
 */
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

const DEFAULT_DAYS = 60;
const MIN_DAYS = 7;
const BATCH_SIZE = 400;
const MAX_DELETES_PER_RUN = 100000;
const TIME_BUDGET_MS = 480 * 1000;

const pruneOldArrivals = onSchedule(
    {
      schedule: "every day 03:30",
      timeZone: "America/New_York",
      timeoutSeconds: 540,
    },
    async () => {
      const db = admin.firestore();
      const startedAt = Date.now();

      const configSnap = await db.doc("settings/arrivalRetention").get();
      const config = configSnap.exists ? configSnap.data() : {};

      if (config.enabled === false) {
        console.log("pruneOldArrivals: disabled in settings");
        return;
      }

      const days = config.days === undefined ? DEFAULT_DAYS : config.days;
      if (!Number.isInteger(days) || days < MIN_DAYS) {
        // Refuse rather than guess: a bad value should never widen deletion.
        console.error(`pruneOldArrivals: invalid days (${days}); skipping`);
        return;
      }

      const cutoff = admin.firestore.Timestamp.fromMillis(
          startedAt - days * 24 * 60 * 60 * 1000,
      );

      let deleted = 0;
      let complete = true;
      for (;;) {
        if (deleted >= MAX_DELETES_PER_RUN ||
            Date.now() - startedAt > TIME_BUDGET_MS) {
          complete = false; // the next run carries on
          break;
        }
        const snap = await db.collection("arrivals")
            .where("arrival_time", "<", cutoff)
            .orderBy("arrival_time")
            .limit(BATCH_SIZE)
            .get();
        if (snap.empty) break;

        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
      }

      await db.doc("settings/arrivalRetentionLastRun").set({
        at: admin.firestore.FieldValue.serverTimestamp(),
        days,
        cutoff,
        deleted,
        complete,
      });
      console.log(
          `pruneOldArrivals: deleted ${deleted} older than ${days} days` +
          (complete ? "" : " (stopped early; will continue next run)"),
      );
    },
);

module.exports = {pruneOldArrivals, DEFAULT_DAYS, MIN_DAYS};
