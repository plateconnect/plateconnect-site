"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  Timestamp,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
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

// ─── Edit / Add Modal ───────────────────────────────────────────────────────

interface UserFormData {
  name: string;
  email: string;
  account_type: "guardian" | "student";
  grade: string;
  wardIds: string;         // comma-separated
  licensePlateNumbers: string; // comma-separated
  onboardingComplete: boolean;
}

const emptyForm = (): UserFormData => ({
  name: "",
  email: "",
  account_type: "guardian",
  grade: "",
  wardIds: "",
  licensePlateNumbers: "",
  onboardingComplete: true,
});

function userToForm(u: AppUser): UserFormData {
  return {
    name: u.name,
    email: u.email ?? "",
    account_type: u.account_type === "student" ? "student" : "guardian",
    grade: u.grade != null ? String(u.grade) : "",
    wardIds: (u.wardIds ?? []).join(", "),
    licensePlateNumbers: (u.licensePlateNumbers ?? []).join(", "),
    onboardingComplete: u.onboardingComplete !== false,
  };
}

function splitCsv(s: string): string[] {
  return s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

interface UserModalProps {
  mode: "add" | "edit";
  initial: UserFormData;
  allStudents: AppUser[];
  onSave: (data: UserFormData) => Promise<void>;
  onClose: () => void;
}

function UserModal({ mode, initial, allStudents, onSave, onClose }: UserModalProps) {
  const [form, setForm] = useState<UserFormData>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field: keyof UserFormData, value: string | boolean) =>
    setForm((f) => ({ ...f, [field]: value }));

  const handleSave = async () => {
    if (!form.name.trim()) { setError("Name is required."); return; }
    setSaving(true);
    setError("");
    try {
      await onSave(form);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            {mode === "add" ? "Add New User" : "Edit User"}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Jane Smith"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="jane@school.edu"
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Account Type */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
              Account Type
            </label>
            <div className="flex gap-2">
              {(["guardian", "student"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => set("account_type", t)}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition capitalize ${
                    form.account_type === t
                      ? t === "guardian"
                        ? "bg-blue-600 border-blue-600 text-white"
                        : "bg-green-600 border-green-600 text-white"
                      : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Student-only: Grade */}
          {form.account_type === "student" && (
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                Grade (1–12)
              </label>
              <input
                type="number"
                min={1}
                max={12}
                value={form.grade}
                onChange={(e) => set("grade", e.target.value)}
                placeholder="e.g. 9"
                className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {/* Guardian-only fields */}
          {form.account_type === "guardian" && (
            <>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  License Plates
                  <span className="ml-1 text-gray-400 normal-case font-normal">(comma-separated)</span>
                </label>
                <input
                  type="text"
                  value={form.licensePlateNumbers}
                  onChange={(e) => set("licensePlateNumbers", e.target.value)}
                  placeholder="ABC-1234, XYZ-5678"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                  Linked Student IDs
                  <span className="ml-1 text-gray-400 normal-case font-normal">(comma-separated Firestore IDs)</span>
                </label>
                <input
                  type="text"
                  value={form.wardIds}
                  onChange={(e) => set("wardIds", e.target.value)}
                  placeholder="studentId1, studentId2"
                  className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
                {/* Quick-pick active students */}
                {allStudents.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-gray-400 mb-1.5">Quick-add a student:</p>
                    <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                      {allStudents.map((s) => {
                        const ids = splitCsv(form.wardIds);
                        const active = ids.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              const current = splitCsv(form.wardIds);
                              const next = active
                                ? current.filter((id) => id !== s.id)
                                : [...current, s.id];
                              set("wardIds", next.join(", "));
                            }}
                            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition ${
                              active
                                ? "bg-blue-600 border-blue-600 text-white"
                                : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"
                            }`}
                          >
                            {s.name} {s.grade ? `(G${s.grade})` : ""}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Onboarding */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-700">Onboarding complete</p>
              <p className="text-xs text-gray-400">Mark the user&apos;s setup as finished</p>
            </div>
            <button
              type="button"
              onClick={() => set("onboardingComplete", !form.onboardingComplete)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                form.onboardingComplete ? "bg-green-500" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  form.onboardingComplete ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {saving && (
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {mode === "add" ? "Create User" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete Confirm Modal ───────────────────────────────────────────────────

function DeleteConfirmModal({
  userName,
  onConfirm,
  onClose,
}: {
  userName: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mx-auto mb-4">
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-gray-900 text-center mb-1">Delete User</h3>
        <p className="text-sm text-gray-500 text-center mb-6">
          Are you sure you want to delete <span className="font-semibold text-gray-700">{userName}</span>? This cannot be undone.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setDeleting(true);
              await onConfirm();
              onClose();
            }}
            disabled={deleting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition"
          >
            {deleting && (
              <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

function UserManagementContent() {
  const { user, isAdmin, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [filter, setFilter] = useState<"all" | "guardian" | "student">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGuardian, setExpandedGuardian] = useState<string | null>(null);
  type SortColumn = "name" | "email" | "account_type" | "onboarding";
  const [sort, setSort] = useState<{ column: SortColumn | null; direction: "asc" | "desc" | null }>({column: null, direction: null});

  const cycleSort = (column: SortColumn) => {
    setSort((current) => {
      if (current.column !== column) {
        return { column, direction: "asc" };
      }
      if (current.direction === "asc") {
        return { column, direction: "desc" };
      }
      return { column: null, direction: null };
    });
  };

  // Modal state
  const [editTarget, setEditTarget] = useState<AppUser | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.push("/login");
  }, [user, isAdmin, loading, router]);

  useEffect(() => {
    if (!user || !db) return;
    const unsubscribe = onSnapshot(collection(db, "users"), (snapshot) => {
      const usersData: AppUser[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        usersData.push({
          id: docSnap.id,
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

  // Handle ?guardian= deep-link
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

  const nameMap = useMemo(() => {
    const map = new Map<string, { name: string; grade: number }>();
    allUsers.forEach((u) => {
      if (u.account_type === "student") map.set(u.id, { name: u.name, grade: u.grade || 0 });
    });
    return map;
  }, [allUsers]);

  const allStudents = useMemo(
    () => allUsers.filter((u) => u.account_type === "student"),
    [allUsers]
  );

  const displayUsers = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = allUsers
      .filter((u) => filter === "all" || u.account_type === filter)
      .filter((u) => !q || u.name.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));

    if (!sort.column || !sort.direction) return filtered;

    const sorted = [...filtered].sort((a, b) => {
      let av = "";
      let bv = "";
      if (sort.column === "name") {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (sort.column === "email") {
        av = (a.email ?? "").toLowerCase();
        bv = (b.email ?? "").toLowerCase();
      } else if (sort.column === "account_type") {
        av = (a.account_type ?? "").toLowerCase();
        bv = (b.account_type ?? "").toLowerCase();
      } else if (sort.column === "onboarding") {
        av = a.onboardingComplete === false ? "incomplete" : "complete";
        bv = b.onboardingComplete === false ? "incomplete" : "complete";
      }
      if (av < bv) return sort.direction === "asc" ? -1 : 1;
      if (av > bv) return sort.direction === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [allUsers, filter, searchQuery, sort]);

  const stats = useMemo(() => {
    const guardians = allUsers.filter((u) => u.account_type === "guardian");
    const students = allUsers.filter((u) => u.account_type === "student");
    const incomplete = allUsers.filter((u) => u.onboardingComplete === false);
    return {
      total: allUsers.length,
      guardians: guardians.length,
      students: students.length,
      incomplete: incomplete.length,
    };
  }, [allUsers]);

  // ── Firebase write helpers ────────────────────────────────────────────────

  const buildPayload = (form: UserFormData) => {
    const base: Record<string, unknown> = {
      name: form.name.trim(),
      email: form.email.trim() || null,
      account_type: form.account_type,
      onboardingComplete: form.onboardingComplete,
    };
    if (form.account_type === "student") {
      base.grade = form.grade ? parseInt(form.grade, 10) : null;
    } else {
      base.licensePlateNumbers = splitCsv(form.licensePlateNumbers);
      base.wardIds = splitCsv(form.wardIds);
    }
    return base;
  };

  const handleSaveEdit = async (form: UserFormData) => {
    if (!editTarget || !db) throw new Error("No target user");
    await updateDoc(doc(db, "users", editTarget.id), buildPayload(form));
  };

  const handleAdd = async (form: UserFormData) => {
    if (!db) throw new Error("Firebase not initialized");
    await addDoc(collection(db, "users"), {
      ...buildPayload(form),
      createdAt: serverTimestamp(),
    });
  };

  const handleDelete = async (u: AppUser) => {
    if (!db) throw new Error("Firebase not initialized");
    await deleteDoc(doc(db, "users", u.id));
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-500">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Sidebar />

      <div className="flex-1 p-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-4xl font-bold text-gray-900">User Management</h1>
            <p className="text-gray-600 mt-1">
              View, add, edit and remove guardians and students
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition shadow-sm"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add User
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          {[
            { label: "Total users", value: stats.total, color: "text-gray-800" },
            { label: "Guardians", value: stats.guardians, color: "text-blue-600" },
            { label: "Students", value: stats.students, color: "text-green-600" },
            { label: "Incomplete onboarding", value: stats.incomplete, color: "text-red-500" },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-5">
              <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-sm text-gray-500 mt-1">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
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
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      Name
                      <button
                        onClick={() => cycleSort("name")}
                        className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] border-gray-300 ${
                          sort.column === "name" && sort.direction
                            ? "bg-green-500 border-green-500 text-white"
                            : "bg-white text-gray-500 hover:bg-gray-100"
                        }`}
                        aria-label="Sort by name"
                      >
                        {sort.column === "name" && sort.direction === "asc" ? "▲" : sort.column === "name" && sort.direction === "desc" ? "▼" : "△"}
                      </button>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      Email
                      <button
                        onClick={() => cycleSort("email")}
                        className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] border-gray-300 ${
                          sort.column === "email" && sort.direction
                            ? "bg-green-500 border-green-500 text-white"
                            : "bg-white text-gray-500 hover:bg-gray-100"
                        }`}
                        aria-label="Sort by email"
                      >
                        {sort.column === "email" && sort.direction === "asc" ? "▲" : sort.column === "email" && sort.direction === "desc" ? "▼" : "△"}
                      </button>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      Type
                      <button
                        onClick={() => cycleSort("account_type")}
                        className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] border-gray-300 ${
                          sort.column === "account_type" && sort.direction
                            ? "bg-green-500 border-green-500 text-white"
                            : "bg-white text-gray-500 hover:bg-gray-100"
                        }`}
                        aria-label="Sort by type"
                      >
                        {sort.column === "account_type" && sort.direction === "asc" ? "▲" : sort.column === "account_type" && sort.direction === "desc" ? "▼" : "△"}
                      </button>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    <div className="flex items-center gap-1">
                      Onboarding
                      <button
                        onClick={() => cycleSort("onboarding")}
                        className={`inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] border-gray-300 ${
                          sort.column === "onboarding" && sort.direction
                            ? "bg-green-500 border-green-500 text-white"
                            : "bg-white text-gray-500 hover:bg-gray-100"
                        }`}
                        aria-label="Sort by onboarding"
                      >
                        {sort.column === "onboarding" && sort.direction === "asc" ? "▲" : sort.column === "onboarding" && sort.direction === "desc" ? "▼" : "△"}
                      </button>
                    </div>
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Details
                  </th>
                  <th className="px-6 py-3 text-right text-sm font-semibold text-gray-600 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayUsers.map((u) => {
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
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                          isExpanded ? "bg-blue-50 hover:bg-blue-50" : ""
                        }`}
                      >
                        {/* Name */}
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{u.name}</span>
                            {isGuardian && (
                              <button
                                onClick={() => setExpandedGuardian(isExpanded ? null : u.id)}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-md text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 hover:border-blue-300 transition"
                                title={isExpanded ? "Collapse" : "Show linked students"}
                              >
                                {isExpanded ? "▲" : "▼"}
                              </button>
                            )}
                          </div>
                        </td>

                        {/* Email */}
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {u.email || <span className="text-gray-300">—</span>}
                        </td>

                        {/* Type */}
                        <td className="px-6 py-4">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
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

                        {/* Onboarding */}
                        <td className="px-6 py-4">
                          {isIncomplete ? (
                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">Incomplete</span>
                          ) : (
                            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">Complete</span>
                          )}
                        </td>

                        {/* Details */}
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {isGuardian ? (
                            <div className="text-gray-500 leading-relaxed text-xs whitespace-pre-line">
                              {(u.wardIds || []).length} student{(u.wardIds || []).length !== 1 ? "s" : ""}
                              {"\n"}
                              {(u.licensePlateNumbers || []).length} vehicle{(u.licensePlateNumbers || []).length !== 1 ? "s" : ""}
                            </div>
                          ) : u.grade ? (
                            <GradeBadge grade={u.grade} />
                          ) : (
                            <span className="text-gray-300">—</span>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Edit */}
                            <button
                              onClick={() => setEditTarget(u)}
                              title="Edit user"
                              className="inline-flex items-center justify-center w-8 h-8 text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>

                            {/* Delete */}
                            <button
                              onClick={() => setDeleteTarget(u)}
                              title="Delete user"
                              className="inline-flex items-center justify-center w-8 h-8 text-gray-400 bg-white border border-gray-200 rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expanded ward row */}
                      {isGuardian && isExpanded && (
                        <tr key={`${u.id}-expand`} className="bg-blue-50 border-b border-blue-100">
                          <td colSpan={6} className="px-8 py-3">
                            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                              Linked Students
                            </div>
                            {wardStudents.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {wardStudents.map((s, i) =>
                                  s ? (
                                    <div
                                      key={i}
                                      className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg shadow-sm border border-blue-100"
                                    >
                                      <span className="text-sm font-medium text-gray-800">{s.name}</span>
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
            <div className="p-12 text-center text-gray-400 text-sm">
              No users match your current filter.
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}

      {showAdd && (
        <UserModal
          mode="add"
          initial={emptyForm()}
          allStudents={allStudents}
          onSave={handleAdd}
          onClose={() => setShowAdd(false)}
        />
      )}

      {editTarget && (
        <UserModal
          mode="edit"
          initial={userToForm(editTarget)}
          allStudents={allStudents}
          onSave={handleSaveEdit}
          onClose={() => setEditTarget(null)}
        />
      )}

      {deleteTarget && (
        <DeleteConfirmModal
          userName={deleteTarget.name}
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

export default function UserManagementPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-gray-500">Loading...</span>
          </div>
        </div>
      }
    >
      <UserManagementContent />
    </Suspense>
  );
}
