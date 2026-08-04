"use client";

import Sidebar from "@/components/Sidebar";
import { APP_TIME_ZONE, currentZoneAbbreviation } from "@/lib/appTime";

export default function SettingsPage() {
  const offsetLabel = currentZoneAbbreviation();

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

          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm mt-4">
            <h2 className="text-lg font-semibold text-gray-800">Coming soon</h2>
            <p className="text-gray-500 mt-2">Use this page to add toggles for app-level settings, notifications, and admin configuration options.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
