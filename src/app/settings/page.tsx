"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  collection,
  doc,
  getCountFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import Sidebar from "@/components/Sidebar";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { APP_TIME_ZONE, currentZoneAbbreviation, formatDateShort, formatTimeShort } from "@/lib/appTime";

// Keep in step with functions/retention.js and the arrivalRetention rule in
// firestore.rules (which is what actually enforces the bounds).
const DEFAULT_RETENTION_DAYS = 60;
const MIN_RETENTION_DAYS = 7;
const MAX_RETENTION_DAYS = 3650;

interface LastRun {
  at?: Timestamp;
  deleted: number;
  days: number;
  complete: boolean;
}

/**
 * Automatic deletion of old arrival logs. The website cannot delete arrivals
 * (rules forbid client deletes); it only stores the policy in
 * settings/arrivalRetention. The scheduled pruneOldArrivals function applies it
 * every night. With no saved policy the function uses the defaults shown here.
 */
function ArrivalRetentionCard({ uid }: { uid: string | undefined }) {
  const [saved, setSaved] = useState<{ enabled: boolean; days: number } | null | undefined>(undefined);
  const [lastRun, setLastRun] = useState<LastRun | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [daysText, setDaysText] = useState(String(DEFAULT_RETENTION_DAYS));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!db) return;
    const unsubPolicy = onSnapshot(
      doc(db, "settings", "arrivalRetention"),
      (snap) => {
        const d = snap.data();
        const policy = d
          ? { enabled: d.enabled !== false, days: Number(d.days) || DEFAULT_RETENTION_DAYS }
          : null;
        setSaved(policy);
        setEnabled(policy ? policy.enabled : true);
        setDaysText(String(policy ? policy.days : DEFAULT_RETENTION_DAYS));
      },
      () => setSaved(null),
    );
    const unsubRun = onSnapshot(
      doc(db, "settings", "arrivalRetentionLastRun"),
      (snap) => setLastRun((snap.data() as LastRun | undefined) ?? null),
      () => setLastRun(null),
    );
    return () => {
      unsubPolicy();
      unsubRun();
    };
  }, []);

  const days = Number(daysText);
  const daysValid =
    daysText.trim() !== "" &&
    Number.isInteger(days) &&
    days >= MIN_RETENTION_DAYS &&
    days <= MAX_RETENTION_DAYS;

  const effective = saved ?? { enabled: true, days: DEFAULT_RETENTION_DAYS };
  const dirty = saved === undefined ? false : enabled !== effective.enabled || (daysValid && days !== effective.days);

  const save = async () => {
    if (!db || !daysValid) return;
    setBusy(true);
    setMessage(null);
    try {
      if (enabled) {
        // Say how much would go before committing — this is not reversible.
        const cutoff = new Date(Date.now() - days * 86_400_000);
        const snap = await getCountFromServer(
          query(collection(db, "arrivals"), where("arrival_time", "<", Timestamp.fromDate(cutoff))),
        );
        const n = snap.data().count;
        if (
          n > 0 &&
          !window.confirm(
            `${n.toLocaleString()} arrival records are older than ${days} days and will be permanently ` +
              `deleted by the next nightly run (about 3:30 AM ${APP_TIME_ZONE}). This cannot be undone.\n\nSave?`,
          )
        ) {
          setBusy(false);
          return;
        }
      }
      await setDoc(
        doc(db, "settings", "arrivalRetention"),
        { enabled, days, updatedAt: serverTimestamp(), updatedBy: uid ?? null },
        { merge: true },
      );
      setMessage({ ok: true, text: "Saved." });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mt-4">
      <h2 className="text-lg font-semibold text-gray-800">Automatic deletion of old arrival logs</h2>
      <p className="text-gray-500 mt-2 max-w-2xl">
        Arrival logs older than this are permanently deleted once a night, which keeps the database
        small and the dashboard fast. Deleted records cannot be recovered.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3">
        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm font-medium text-gray-900">Delete old arrival logs automatically</span>
        </label>

        <label className={`inline-flex items-center gap-2 text-sm ${enabled ? "text-gray-700" : "text-gray-400"}`}>
          Keep the last
          <input
            type="number"
            inputMode="numeric"
            min={MIN_RETENTION_DAYS}
            max={MAX_RETENTION_DAYS}
            step={1}
            value={daysText}
            disabled={!enabled}
            onChange={(e) => setDaysText(e.target.value)}
            className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
          days
        </label>

        <button
          type="button"
          onClick={save}
          disabled={busy || !dirty || (enabled && !daysValid)}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? "Saving\u2026" : "Save"}
        </button>
      </div>

      {enabled && !daysValid && (
        <p className="mt-2 text-xs text-red-600">
          Enter a whole number of days from {MIN_RETENTION_DAYS} to {MAX_RETENTION_DAYS}.
        </p>
      )}
      {message && (
        <p className={`mt-2 text-xs ${message.ok ? "text-green-600" : "text-red-600"}`}>{message.text}</p>
      )}

      <div className="mt-4 border-t border-gray-100 pt-4 text-xs text-gray-500 space-y-1">
        <p>
          Currently:{" "}
          <span className="font-medium text-gray-700">
            {saved === undefined
              ? "loading\u2026"
              : effective.enabled
                ? `keeping ${effective.days} days${saved === null ? " (default \u2014 not saved yet)" : ""}`
                : "automatic deletion is off"}
          </span>
        </p>
        {lastRun?.at && (
          <p>
            Last run: {formatDateShort(lastRun.at.toDate())} {formatTimeShort(lastRun.at.toDate())} &middot; deleted{" "}
            {lastRun.deleted.toLocaleString()} record{lastRun.deleted === 1 ? "" : "s"} older than {lastRun.days} days
            {lastRun.complete ? "" : " (stopped early; continues next night)"}
          </p>
        )}
        <p className="text-gray-400">
          Applied by the <code className="font-mono">pruneOldArrivals</code> Cloud Function, which must be
          deployed (<code className="font-mono">firebase deploy --only functions,firestore:rules</code>) for this
          to take effect.
        </p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const offsetLabel = currentZoneAbbreviation();
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.push("/login");
  }, [user, isAdmin, loading, router]);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />
      <div className="flex-1 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6">
            <h1 className="text-4xl font-bold text-gray-900">Settings</h1>
            <p className="text-gray-600 mt-1">Manage application settings and preferences.</p>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            <div className="flex items-start justify-between gap-6">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Time zone</h2>
                <p className="text-gray-500 mt-2 max-w-xl">
                  All dates, times and day boundaries across the dashboard are resolved in this
                  zone rather than each viewer&apos;s browser, so every admin sees the same days
                  regardless of where they are.
                </p>
              </div>
              <span className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-gray-100 px-3 py-2 font-mono text-sm font-semibold text-gray-700">
                {APP_TIME_ZONE}
                {offsetLabel && <span className="text-gray-400">({offsetLabel})</span>}
              </span>
            </div>
            <p className="mt-4 border-t border-gray-100 pt-4 text-xs text-gray-400">
              Set in code via the <code className="font-mono text-gray-500">APP_TIME_ZONE</code>{" "}
              constant. Making this editable here requires storing it in Firestore and adding a
              security rule allowing admins to write it.
            </p>
          </div>

          <ArrivalRetentionCard uid={user?.uid} />

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mt-4">
            <h2 className="text-lg font-semibold text-gray-800">Coming soon</h2>
            <p className="text-gray-500 mt-2">Use this page to add toggles for app-level settings, notifications, and admin configuration options.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
