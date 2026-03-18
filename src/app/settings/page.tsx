"use client";

import Sidebar from "@/components/Sidebar";

export default function SettingsPage() {
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
            <h2 className="text-lg font-semibold text-gray-800">Coming soon</h2>
            <p className="text-gray-500 mt-2">Use this page to add toggles for app-level settings, notifications, and admin configuration options.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
