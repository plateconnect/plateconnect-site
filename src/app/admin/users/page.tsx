"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, Timestamp } from "firebase/firestore";
import Sidebar from "@/components/Sidebar";
import GradeBadge from "@/components/GradeBadge";

interface AppUser {
  id: string;
  name: string;
  email?: string;
  account_type: "guardian" | "student" | string;
  grade?: number;
  wardIds?: string[];
  licensePlateNumbers?: string[];
  fcmToken?: string;
  fcmTokenUpdatedAt?: Timestamp;
  onboardingComplete?: boolean;
}

type FcmStatus = "active" | "stale" | "none";

function getFcmStatus(user: AppUser): FcmStatus {
  if (!user.fcmToken) return "none";
  if (!user.fcmTokenUpdatedAt) return "stale";
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return user.fcmTokenUpdatedAt.toMillis() > thirtyDaysAgo ? "active" : "stale";
}

function UserManagementContent() {
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [filter, setFilter] = useState<"all" | "guardian" | "student">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGuardian, setExpandedGuardian] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) {
      router.push("/login");
    }
  }, [user, isAdmin, loading, router]);

  // Fetch all users
  useEffect(() => {
    if (!user || !db) return;

    const unsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
      const usersData: AppUser[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        usersData.push({
          id: doc.id,
          name: data.name || "Unknown",
          email: data.email,
          account_type: data.account_type || "unknown",
          grade: data.grade,
          wardIds: data.wardIds || [],
          licensePlateNumbers: data.licensePlateNumbers || [],
          fcmToken: data.fcmToken,
          fcmTokenUpdatedAt: data.fcmTokenUpdatedAt,
          onboardingComplete: data.onboardingComplete,
        });
      });
      setAllUsers(usersData);
    });

    return () => unsubscribe();
  }, [user]);

  // Handle ?guardian= query param from Vehicle Lookup deep link
  useEffect(() => {
    const guardianParam = searchParams.get("guardian");
    if (guardianParam && allUsers.length > 0) {
      const guardian = allUsers.find((u) => u.id === guardianParam);
      if (guardian) {
        setFilter("guardian");
        setSearchQuery(guardian.name);
        setExpandedGuardian(guardianParam);
      }
    }
  }, [searchParams, allUsers]);

  // Name lookup map for resolving wardIds → student names
  const nameMap = useMemo(() => {
    const map = new Map<string, { name: string; grade: number }>();
    allUsers.forEach((u) => {
      if (u.account_type === "student") {
        map.set(u.id, { name: u.name, grade: u.grade || 0 });
      }
    });
    return map;
  }, [allUsers]);

  const displayUsers = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return allUsers
      .filter((u) => filter === "all" || u.account_type === filter)
      .filter(
        (u) =>
          !q ||
          u.name.toLowerCase().includes(q) ||
          u.email?.toLowerCase().includes(q)
      );
  }, [allUsers, filter, searchQuery]);

  const stats = useMemo(() => {
    const guardians = allUsers.filter((u) => u.account_type === "guardian");
    const students = allUsers.filter((u) => u.account_type === "student");
    const incomplete = allUsers.filter((u) => u.onboardingComplete === false);
    return { total: allUsers.length, guardians: guardians.length, students: students.length, incomplete: incomplete.length };
  }, [allUsers]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />

      <div className="flex-1 p-8">
        <div className="mb-6">
          <h1 className="text-4xl font-bold text-gray-900">User Management</h1>
          <p className="text-gray-600 mt-1">View all guardians and students, their links and notification status</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-3xl font-bold text-gray-800">{stats.total}</div>
            <div className="text-sm text-gray-500 mt-1">Total users</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-3xl font-bold text-blue-600">{stats.guardians}</div>
            <div className="text-sm text-gray-500 mt-1">Guardians</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-3xl font-bold text-green-600">{stats.students}</div>
            <div className="text-sm text-gray-500 mt-1">Students</div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-3xl font-bold text-red-500">{stats.incomplete}</div>
            <div className="text-sm text-gray-500 mt-1">Incomplete onboarding</div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-lg shadow p-4 mb-6 flex items-center gap-4">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {(["all", "guardian", "student"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 text-sm font-medium capitalize transition ${
                  filter === f
                    ? "bg-blue-600 text-white"
                    : "bg-white text-gray-700 hover:bg-gray-50"
                }`}
              >
                {f === "all" ? "All" : f === "guardian" ? "Guardians" : "Students"}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-md">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or email..."
              className="block w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>
          <span className="text-sm text-gray-500 ml-auto">{displayUsers.length} users</span>
        </div>

        {/* User Table */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-100 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Name</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Email</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Type</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Onboarding</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Notifications</th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-700">Details</th>
                </tr>
              </thead>
              <tbody>
                {displayUsers.map((u) => {
                  const fcmStatus = getFcmStatus(u);
                  const isIncomplete = u.onboardingComplete === false;
                  const isGuardian = u.account_type === "guardian";
                  const isExpanded = expandedGuardian === u.id;
                  const wardStudents = isGuardian
                    ? (u.wardIds || []).map((id) => nameMap.get(id))
                    : [];

                  return (
                    <>
                      <tr
                        key={u.id}
                        className={`border-b border-gray-200 hover:bg-gray-50 ${isExpanded ? "bg-blue-50" : ""}`}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{u.name}</span>
                            {isGuardian && (
                              <button
                                onClick={() => setExpandedGuardian(isExpanded ? null : u.id)}
                                className="text-xs text-blue-600 hover:underline"
                                title={isExpanded ? "Collapse" : "Expand ward links"}
                              >
                                {isExpanded ? "▲" : "▼"}
                              </button>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">{u.email || <span className="text-gray-400">—</span>}</td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-2 py-1 rounded-full text-xs font-medium capitalize ${
                              isGuardian
                                ? "bg-blue-100 text-blue-800"
                                : u.account_type === "student"
                                ? "bg-green-100 text-green-800"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {u.account_type}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {isIncomplete ? (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700">
                              Incomplete
                            </span>
                          ) : (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                              Complete
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {fcmStatus === "active" && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                          )}
                          {fcmStatus === "stale" && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Stale</span>
                          )}
                          {fcmStatus === "none" && (
                            <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">None</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {isGuardian ? (
                            <span className="text-gray-500">
                              {(u.wardIds || []).length} student{(u.wardIds || []).length !== 1 ? "s" : ""} linked
                              {(u.licensePlateNumbers || []).length > 0 && (
                                <> · {(u.licensePlateNumbers || []).length} vehicle{(u.licensePlateNumbers || []).length !== 1 ? "s" : ""}</>
                              )}
                            </span>
                          ) : (
                            u.grade ? <GradeBadge grade={u.grade} /> : <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                      {isGuardian && isExpanded && (
                        <tr key={`${u.id}-expand`} className="bg-blue-50 border-b border-blue-100">
                          <td colSpan={6} className="px-8 py-3">
                            <div className="text-sm font-medium text-gray-700 mb-2">Linked students:</div>
                            {wardStudents.length > 0 ? (
                              <div className="flex flex-wrap gap-3">
                                {wardStudents.map((s, i) =>
                                  s ? (
                                    <div key={i} className="flex items-center gap-1 bg-white px-3 py-1 rounded-lg shadow-sm border border-blue-100">
                                      <span className="text-sm text-gray-800">{s.name}</span>
                                      <GradeBadge grade={s.grade} />
                                    </div>
                                  ) : (
                                    <span key={i} className="text-xs text-gray-400 italic">Unknown student</span>
                                  )
                                )}
                              </div>
                            ) : (
                              <span className="text-sm text-gray-400 italic">No students linked</span>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>

          {displayUsers.length === 0 && (
            <div className="p-12 text-center text-gray-500">
              No users match your current filter.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function UserManagementPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-xl text-gray-600">Loading...</div></div>}>
      <UserManagementContent />
    </Suspense>
  );
}
