"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db, functions } from "@/lib/firebase";
import {
  collection,
  onSnapshot,
  Timestamp,
  doc,
  updateDoc,
  writeBatch,
  getDoc,
  setDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
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
  status?: "active" | "archived";
}

// ─── Account types ──────────────────────────────────────────────────────────

// The single source of truth for account_type, mirroring ROLES in
// functions/user_admin.js. This field used to be free text, which is how a CSV
// import introduced "facilty" alongside "faculty" with nothing to catch it.
const ACCOUNT_TYPES = [
  {value: "guardian", label: "Guardian"},
  {value: "student", label: "Student"},
  {value: "faculty", label: "Faculty"},
  {value: "teacher", label: "Teacher"},
  {value: "admin", label: "Admin (staff role)"},
  {value: "staff", label: "Staff"},
] as const;

type AccountType = (typeof ACCOUNT_TYPES)[number]["value"];

// Role badge colours, stored in Firestore (settings/roleColors) rather than
// localStorage so every admin sees the same scheme instead of a per-browser
// one. It is a single document read per page load.
//
// Stored as one hex per role and expanded into a background/text/border set at
// render time. Tailwind classes are compiled ahead of time, so a user-chosen
// colour cannot be expressed as a class name and has to be an inline style.
const DEFAULT_ROLE_COLORS: Record<string, string> = {
  guardian: "#2563eb",
  student: "#16a34a",
  faculty: "#0d9488",
  teacher: "#7c3aed",
  admin: "#db2777",
  staff: "#64748b",
};

const FALLBACK_ROLE_COLOR = "#6b7280";

function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return `rgba(107, 114, 128, ${alpha})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function roleBadgeStyle(color: string): React.CSSProperties {
  return {
    backgroundColor: hexToRgba(color, 0.12),
    color,
    border: `1px solid ${hexToRgba(color, 0.25)}`,
  };
}

const isKnownAccountType = (v: string): v is AccountType =>
  ACCOUNT_TYPES.some((t) => t.value === v);

// Only guardians and students sign in; every other role is a vehicle
// registration so the gate recognises the car.
const LOGIN_ROLES: string[] = ["guardian", "student"];

// ─── Edit / Add Modal ───────────────────────────────────────────────────────

interface UserFormData {
  name: string;
  email: string;
  account_type: string;
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
    // Preserve whatever is stored, even an unrecognised value such as the
    // "facilty" typo, so opening and saving a record cannot silently rewrite
    // someone's role to "guardian".
    account_type: u.account_type || "guardian",
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

// ─── CSV Import helpers ──────────────────────────────────────────────────────

// Parse CSV text into headers + rows. Handles UTF-8 BOM, quoted fields with
// "" escapes, and CRLF/LF line endings.
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const clean = text.replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      record.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      record.push(field); field = "";
      records.push(record); record = [];
    } else {
      field += c;
    }
  }
  // flush trailing field/record (unless file ended on a newline with no data)
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  // Drop fully-empty rows (e.g. trailing blank lines)
  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ""));
  if (nonEmpty.length === 0) return { headers: [], rows: [] };

  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase());
  return { headers, rows: nonEmpty.slice(1) };
}

// Split a semicolon-separated plates cell → trimmed, uppercased, de-duped.
function splitPlates(cell: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cell.split(";")) {
    const p = raw.trim().toUpperCase();
    if (p && !seen.has(p)) { seen.add(p); out.push(p); }
  }
  return out;
}

// Map possible header spellings → canonical field.
const IMPORT_HEADER_ALIASES: Record<string, string> = {
  email: "email",
  "e-mail": "email",
  name: "name",
  "full name": "name",
  account_type: "account_type",
  "account type": "account_type",
  type: "account_type",
  role: "account_type",
  license_plates: "license_plates",
  "license plates": "license_plates",
  "license plate": "license_plates",
  plates: "license_plates",
  plate: "license_plates",
  grade: "grade",
};

interface ImportRow {
  email: string;
  name: string;
  account_type: string;
  plates: string[];
  grade: string;
}

type ImportTag = "new" | "existing" | "invalid" | "duplicate";

interface PartitionedRow {
  rowNumber: number; // 1-based data row (excludes header)
  data: ImportRow;
  tag: ImportTag;
  existingUser?: AppUser;
  reason?: string;
}

function buildHeaderIndex(headers: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  headers.forEach((h, i) => {
    const canon = IMPORT_HEADER_ALIASES[h];
    if (canon && !(canon in idx)) idx[canon] = i;
  });
  return idx;
}

function normalizeImportRow(headerIdx: Record<string, number>, cols: string[]): ImportRow {
  const get = (key: string) => {
    const i = headerIdx[key];
    return i == null ? "" : (cols[i] ?? "").trim();
  };
  return {
    email: get("email"),
    name: get("name"),
    account_type: get("account_type").toLowerCase(),
    plates: splitPlates(get("license_plates")),
    grade: get("grade"),
  };
}

// Partition parsed rows into new / existing / invalid / duplicate.
function partitionRows(
  headers: string[],
  rows: string[][],
  existingUsers: AppUser[]
): { partitioned: PartitionedRow[]; missingHeaders: string[] } {
  const headerIdx = buildHeaderIndex(headers);
  const missingHeaders = ["email", "license_plates"].filter((h) => !(h in headerIdx));
  if (missingHeaders.length > 0) return { partitioned: [], missingHeaders };

  const byEmail = new Map<string, AppUser>();
  existingUsers.forEach((u) => {
    if (u.email) byEmail.set(u.email.trim().toLowerCase(), u);
  });

  const seenInFile = new Set<string>();
  const partitioned: PartitionedRow[] = rows.map((cols, i) => {
    const data = normalizeImportRow(headerIdx, cols);
    const rowNumber = i + 1;
    const emailKey = data.email.toLowerCase();

    if (!data.email || !data.email.includes("@")) {
      return { rowNumber, data, tag: "invalid", reason: "Missing or invalid email" };
    }
    if (data.plates.length === 0) {
      return { rowNumber, data, tag: "invalid", reason: "No license plate" };
    }
    if (seenInFile.has(emailKey)) {
      return { rowNumber, data, tag: "duplicate", reason: "Duplicate email in file" };
    }
    seenInFile.add(emailKey);

    const existingUser = byEmail.get(emailKey);
    if (existingUser) {
      return { rowNumber, data, tag: "existing", existingUser };
    }
    return { rowNumber, data, tag: "new" };
  });

  return { partitioned, missingHeaders: [] };
}

// New-user payloads are now built server-side by the createUserAccount
// callable, which owns the Auth account and keys the document by its UID.
// Building them here is what produced orphaned, random-id documents.

// Merge payload for updating an existing user: replace plates; other fields
// only when non-blank; never touch wardIds/onboardingComplete/fcmToken.
function updateUserPayload(data: ImportRow, existing: AppUser): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    licensePlateNumbers: data.plates, // replace
  };
  if (data.name) payload.name = data.name;
  if (data.account_type) payload.account_type = data.account_type;
  const resolvedType = data.account_type || existing.account_type;
  if (resolvedType === "student" && data.grade) {
    const g = parseInt(data.grade, 10);
    if (!Number.isNaN(g)) payload.grade = g;
  }
  return payload;
}

const CSV_TEMPLATE =
  "email,name,account_type,license_plates,grade\n" +
  "jane@school.edu,Jane Smith,guardian,ABC123;XYZ789,\n" +
  "drew@school.edu,Drew Lee,student,DL4821,11\n" +
  "sam@school.edu,,teacher,TCH900,\n";

function downloadCsvTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "user-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
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
            <select
              value={form.account_type}
              onChange={(e) => set("account_type", e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
              {/* Keep an unrecognised stored value selectable so editing a
                  record never silently changes someone's role. */}
              {!isKnownAccountType(form.account_type) && (
                <option value={form.account_type}>
                  {form.account_type} (unrecognised)
                </option>
              )}
            </select>
            {!isKnownAccountType(form.account_type) && (
              <p className="mt-1.5 text-xs text-amber-600">
                &ldquo;{form.account_type}&rdquo; isn&apos;t a known account
                type &mdash; likely a typo. Pick one above to correct it.
              </p>
            )}
            {!LOGIN_ROLES.includes(form.account_type) && (
              <p className="mt-1.5 text-xs text-gray-400">
                Vehicle record only &mdash; no sign-in account is created.
              </p>
            )}
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

          {/* Plates for every role except students. Faculty and staff rows
              exist precisely so the gate recognises their car, so hiding this
              behind "guardian" made those records un-editable here. */}
          {form.account_type !== "student" && (
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
          )}

          {/* Guardian-only: links to the students they pick up. */}
          {form.account_type === "guardian" && (
            <>
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
        <h3 className="text-lg font-bold text-gray-900 text-center mb-1">Archive User</h3>
        <p className="text-sm text-gray-500 text-center mb-6">
          Archive <span className="font-semibold text-gray-700">{userName}</span>? They will stop matching at the gate and can no longer sign in, but nothing is deleted &mdash; you can restore them at any time. Archived accounts are purged automatically after 90 days.
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
            Archive
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── CSV Import Modal ───────────────────────────────────────────────────────

interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
}

function ImportModal({
  existingUsers,
  onImport,
  onClose,
}: {
  existingUsers: AppUser[];
  onImport: (rows: PartitionedRow[]) => Promise<ImportResult>;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"upload" | "preview" | "result">("upload");
  const [fileName, setFileName] = useState("");
  const [partitioned, setPartitioned] = useState<PartitionedRow[]>([]);
  const [confirmedExisting, setConfirmedExisting] = useState<Set<number>>(new Set());
  const [parseError, setParseError] = useState("");
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragging, setDragging] = useState(false);

  const newRows = useMemo(() => partitioned.filter((r) => r.tag === "new"), [partitioned]);
  const existingRows = useMemo(() => partitioned.filter((r) => r.tag === "existing"), [partitioned]);
  const skippedRows = useMemo(
    () => partitioned.filter((r) => r.tag === "invalid" || r.tag === "duplicate"),
    [partitioned]
  );

  const allExistingConfirmed = existingRows.length > 0 && confirmedExisting.size === existingRows.length;
  const importCount = newRows.length + confirmedExisting.size;

  const handleFile = (file: File) => {
    setParseError("");
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const { headers, rows } = parseCsv(text);
      if (rows.length === 0) {
        setParseError("The file has no data rows.");
        return;
      }
      const { partitioned: parts, missingHeaders } = partitionRows(headers, rows, existingUsers);
      if (missingHeaders.length > 0) {
        setParseError(`Missing required column(s): ${missingHeaders.join(", ")}.`);
        return;
      }
      setPartitioned(parts);
      setConfirmedExisting(new Set());
      setPhase("preview");
    };
    reader.onerror = () => setParseError("Could not read the file.");
    reader.readAsText(file);
  };

  const toggleExisting = (rowNumber: number) => {
    setConfirmedExisting((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  };

  const toggleAllExisting = () => {
    setConfirmedExisting(
      allExistingConfirmed ? new Set() : new Set(existingRows.map((r) => r.rowNumber))
    );
  };

  const runImport = async () => {
    setImporting(true);
    const toWrite = [
      ...newRows,
      ...existingRows.filter((r) => confirmedExisting.has(r.rowNumber)),
    ];
    try {
      const res = await onImport(toWrite);
      setResult({ ...res, skipped: res.skipped + skippedRows.length });
      setPhase("result");
    } catch (e: unknown) {
      setParseError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">Import Users from CSV</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 py-5 max-h-[70vh] overflow-y-auto">
          {/* ── Upload phase ── */}
          {phase === "upload" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) handleFile(f);
                }}
                className={`border-2 border-dashed rounded-xl px-6 py-10 text-center transition ${
                  dragging ? "border-blue-400 bg-blue-50" : "border-gray-300 bg-gray-50"
                }`}
              >
                <svg className="w-10 h-10 mx-auto text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                <p className="text-sm text-gray-600 mb-3">Drag a .csv file here, or</p>
                <label className="inline-block px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition cursor-pointer">
                  Choose file
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                    }}
                  />
                </label>
              </div>

              <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-4 py-3 leading-relaxed">
                <p className="font-semibold text-gray-600 mb-1">Format</p>
                <p>
                  Required columns: <code className="text-gray-700">email</code> and{" "}
                  <code className="text-gray-700">license_plates</code> (multiple plates separated by
                  <code className="text-gray-700"> ;</code>).
                </p>
                <p>
                  Optional: <code className="text-gray-700">name</code>,{" "}
                  <code className="text-gray-700">account_type</code> (blank → guardian),{" "}
                  <code className="text-gray-700">grade</code> (students).
                </p>
                <button
                  onClick={downloadCsvTemplate}
                  className="mt-2 text-blue-600 hover:text-blue-700 font-medium"
                >
                  Download template
                </button>
              </div>

              {parseError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{parseError}</p>
              )}
            </div>
          )}

          {/* ── Preview phase ── */}
          {phase === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-sm">
                <span className="text-gray-500 truncate">{fileName}</span>
                <button
                  onClick={() => { setPhase("upload"); setParseError(""); }}
                  className="ml-auto text-blue-600 hover:text-blue-700 text-xs font-medium shrink-0"
                >
                  Choose different file
                </button>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-green-50 border border-green-100 rounded-lg px-3 py-2.5">
                  <div className="text-2xl font-bold text-green-700">{newRows.length}</div>
                  <div className="text-xs text-green-600">New</div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                  <div className="text-2xl font-bold text-amber-700">{confirmedExisting.size}/{existingRows.length}</div>
                  <div className="text-xs text-amber-600">To update</div>
                </div>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2.5">
                  <div className="text-2xl font-bold text-gray-500">{skippedRows.length}</div>
                  <div className="text-xs text-gray-500">Skipped</div>
                </div>
              </div>

              {/* Existing users need confirmation */}
              {existingRows.length > 0 && (
                <div className="border border-amber-200 rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between bg-amber-50 px-4 py-2.5">
                    <p className="text-xs font-semibold text-amber-800">
                      {existingRows.length} existing user{existingRows.length !== 1 ? "s" : ""} matched by email — confirm to update
                    </p>
                    <button
                      onClick={toggleAllExisting}
                      className="text-xs font-medium text-amber-800 hover:text-amber-900 underline"
                    >
                      {allExistingConfirmed ? "Unconfirm all" : "Confirm all existing"}
                    </button>
                  </div>
                  <div className="divide-y divide-gray-100 max-h-44 overflow-y-auto">
                    {existingRows.map((r) => (
                      <label key={r.rowNumber} className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={confirmedExisting.has(r.rowNumber)}
                          onChange={() => toggleExisting(r.rowNumber)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-gray-800 truncate">
                            {r.existingUser?.name || r.data.name || r.data.email}
                          </div>
                          <div className="text-xs text-gray-400 truncate">
                            {r.data.email} · plates → {r.data.plates.join(", ")}
                          </div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* New users preview */}
              {newRows.length > 0 && (
                <details className="border border-green-100 rounded-lg overflow-hidden" open>
                  <summary className="bg-green-50 px-4 py-2.5 text-xs font-semibold text-green-800 cursor-pointer">
                    {newRows.length} new user{newRows.length !== 1 ? "s" : ""} to create
                  </summary>
                  <div className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
                    {newRows.map((r) => (
                      <div key={r.rowNumber} className="px-4 py-2 text-xs">
                        <span className="font-medium text-gray-800">{r.data.name || r.data.email.split("@")[0]}</span>
                        <span className="text-gray-400"> · {r.data.email} · {r.data.account_type || "guardian"} · {r.data.plates.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {/* Skipped rows */}
              {skippedRows.length > 0 && (
                <details className="border border-gray-200 rounded-lg overflow-hidden">
                  <summary className="bg-gray-50 px-4 py-2.5 text-xs font-semibold text-gray-600 cursor-pointer">
                    {skippedRows.length} row{skippedRows.length !== 1 ? "s" : ""} skipped
                  </summary>
                  <div className="divide-y divide-gray-100 max-h-40 overflow-y-auto">
                    {skippedRows.map((r) => (
                      <div key={r.rowNumber} className="px-4 py-2 text-xs">
                        <span className="text-gray-500">Row {r.rowNumber + 1}: </span>
                        <span className="text-red-500">{r.reason}</span>
                        {r.data.email && <span className="text-gray-400"> ({r.data.email})</span>}
                      </div>
                    ))}
                  </div>
                </details>
              )}

              {parseError && (
                <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{parseError}</p>
              )}
            </div>
          )}

          {/* ── Result phase ── */}
          {phase === "result" && result && (
            <div className="text-center py-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mx-auto mb-4">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900 mb-1">Import complete</h3>
              <p className="text-sm text-gray-500">
                {result.created} created · {result.updated} updated · {result.skipped} skipped
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50">
          {phase === "preview" && (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition">
                Cancel
              </button>
              <button
                onClick={runImport}
                disabled={importing || importCount === 0}
                className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition"
              >
                {importing && (
                  <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                )}
                Import {importCount} user{importCount !== 1 ? "s" : ""}
              </button>
            </>
          )}
          {phase === "result" && (
            <button
              onClick={onClose}
              className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Done
            </button>
          )}
          {phase === "upload" && (
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 transition">
              Cancel
            </button>
          )}
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
  // Any account_type, not just guardian/student — the roster is mostly
  // faculty vehicle records now.
  const [filter, setFilter] = useState<string>("all");

  const [roleColors, setRoleColors] = useState<Record<string, string>>(DEFAULT_ROLE_COLORS);
  const [showColorPanel, setShowColorPanel] = useState(false);
  const [colorSaveState, setColorSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
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
  const [showImport, setShowImport] = useState(false);

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
          // Legacy documents predate soft delete and have no status field.
          status: data.status === "archived" ? "archived" : "active",
        });
      });
      setAllUsers(usersData);
    });
    return () => unsubscribe();
  }, [user]);

  // Role colours: one document read, merged over the defaults so a role added
  // later still renders even if it was never saved.
  useEffect(() => {
    if (!user || !db) return;
    let cancelled = false;
    getDoc(doc(db, "settings", "roleColors"))
      .then((snap) => {
        if (cancelled || !snap.exists()) return;
        setRoleColors({ ...DEFAULT_ROLE_COLORS, ...(snap.data() as Record<string, string>) });
      })
      .catch(() => {
        // Fall back to the defaults; a missing document is not an error.
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const saveRoleColors = async (next: Record<string, string>) => {
    setRoleColors(next);
    if (!db) return;
    setColorSaveState("saving");
    try {
      await setDoc(doc(db, "settings", "roleColors"), next, { merge: true });
      setColorSaveState("saved");
      setTimeout(() => setColorSaveState("idle"), 2000);
    } catch (err) {
      console.error("[users] could not save role colours", err);
      setColorSaveState("error");
    }
  };

  const colorForRole = (role: string) =>
    roleColors[role] || DEFAULT_ROLE_COLORS[role] || FALLBACK_ROLE_COLOR;

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
      // Any non-student role can own vehicles.
      base.licensePlateNumbers = splitCsv(form.licensePlateNumbers);
      // Only guardians pick students up, so only they carry wardIds. Writing
      // an empty array onto faculty rows would make the plate-index trigger
      // and the security rules reason about links that do not exist.
      if (form.account_type === "guardian") {
        base.wardIds = splitCsv(form.wardIds);
      }
    }
    return base;
  };

  const handleSaveEdit = async (form: UserFormData) => {
    if (!editTarget || !db) throw new Error("No target user");
    await updateDoc(doc(db, "users", editTarget.id), buildPayload(form));
  };

  // Creating a user goes through a callable, never addDoc().
  //
  // addDoc() mints a RANDOM document id, but every read in the app and website
  // is doc(db,'users',<auth uid>). Users created here therefore showed up in
  // this list yet could never load their own profile after signing in. The
  // callable creates the Auth account first and keys the document by that UID.
  const handleAdd = async (form: UserFormData) => {
    if (!functions) throw new Error("Firebase not initialized");
    const payload = buildPayload(form) as Record<string, unknown>;
    const result = await httpsCallable<
      Record<string, unknown>,
      { uid: string; created: boolean; resetLink: string | null }
    >(
      functions,
      "createUserAccount",
    )({
      email: payload.email,
      name: payload.name,
      accountType: form.account_type,
      grade: form.account_type === "student" && form.grade
        ? parseInt(form.grade, 10)
        : undefined,
      wardIds: form.account_type === "guardian"
        ? splitCsv(form.wardIds)
        : undefined,
      vehicles: form.account_type === "guardian"
        ? splitCsv(form.licensePlateNumbers).map((plate) => ({
            plate,
            plateNormalized: plate.toUpperCase().replace(/[^A-Z0-9]/g, ""),
            description: null,
          }))
        : undefined,
    });

    // No password is ever set or shared — the account is claimed via this
    // link. TODO: surface this in the modal instead of the console.
    if (result.data.resetLink) {
      console.info(
        `[users] password setup link for ${String(payload.email)}:\n` +
          result.data.resetLink,
      );
    }
  };

  // Archive, never delete. A hard delete is what destroyed the users
  // collection; archiving is reversible and the plate index drops an archived
  // guardian automatically, so they stop matching at the gate right away.
  const handleDelete = async (u: AppUser) => {
    if (!functions) throw new Error("Firebase not initialized");
    await httpsCallable(functions, "archiveUser")({ uid: u.id });
  };

  const handleRestore = async (u: AppUser) => {
    if (!functions) throw new Error("Firebase not initialized");
    await httpsCallable(functions, "restoreUser")({ uid: u.id });
  };

  const handleImport = async (rows: PartitionedRow[]): Promise<ImportResult> => {
    if (!db || !functions) throw new Error("Firebase not initialized");
    const database = db;
    const fns = functions;
    let created = 0;
    let updated = 0;
    let skipped = 0;

    // New users need an Auth account, so they go one-at-a-time through the
    // callable rather than a client batch. Updates to existing users are still
    // batched, chunked at 400 ops per commit.
    const newRows = rows.filter((r) => r.tag === "new");
    const existingRows = rows.filter((r) => r.tag === "existing");

    for (const row of newRows) {
      try {
        await httpsCallable(fns, "createUserAccount")({
          email: row.data.email,
          name: row.data.name || undefined,
          accountType: row.data.account_type || "guardian",
          grade: row.data.account_type === "student" && row.data.grade
            ? parseInt(row.data.grade, 10)
            : undefined,
          vehicles: row.data.plates.map((plate) => ({
            plate,
            plateNormalized: plate.toUpperCase().replace(/[^A-Z0-9]/g, ""),
            description: null,
          })),
        });
        created++;
      } catch (err) {
        console.error(`import: row ${row.rowNumber} (${row.data.email})`, err);
        skipped++;
      }
    }

    for (let i = 0; i < existingRows.length; i += 400) {
      const chunk = existingRows.slice(i, i + 400);
      const batch = writeBatch(database);
      for (const row of chunk) {
        if (!row.existingUser) continue;
        const ref = doc(database, "users", row.existingUser.id);
        batch.update(ref, updateUserPayload(row.data, row.existingUser));
        updated++;
      }
      await batch.commit();
    }

    return { created, updated, skipped };
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
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-5 py-2.5 bg-white border border-gray-200 text-gray-700 text-sm font-semibold rounded-xl hover:bg-gray-50 transition shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Import CSV
            </button>
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

          {/* Account-type filter. Built from the types actually present, so a
              stray value such as the "facilty" typo is visible rather than
              hidden behind a hard-coded list. */}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All types</option>
            {Array.from(new Set(allUsers.map((u) => u.account_type)))
              .filter(Boolean)
              .sort()
              .map((t) => (
                <option key={t} value={t}>
                  {t}
                  {isKnownAccountType(t) ? "" : "  ⚠ typo?"}
                </option>
              ))}
          </select>

          <button
            type="button"
            onClick={() => setShowColorPanel((v) => !v)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white text-gray-600 hover:bg-gray-50 transition inline-flex items-center gap-2"
            aria-expanded={showColorPanel}
          >
            <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828L11 19.172M7 17h.01" />
            </svg>
            Role colors
          </button>

          <span className="text-sm text-gray-500 ml-auto">{displayUsers.length} users</span>
        </div>

        {/* Role colour editor. Shown on demand so it does not compete with the
            table for attention. */}
        {showColorPanel && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Role colors</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Saved for everyone, not just this browser. Changes apply immediately.
                </p>
              </div>
              <div className="flex items-center gap-3">
                {colorSaveState === "saving" && <span className="text-xs text-gray-400">Saving…</span>}
                {colorSaveState === "saved" && <span className="text-xs text-green-600">Saved</span>}
                {colorSaveState === "error" && (
                  <span className="text-xs text-red-600">Could not save — admin access required</span>
                )}
                <button
                  type="button"
                  onClick={() => saveRoleColors({ ...DEFAULT_ROLE_COLORS })}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium text-gray-600 border border-gray-200 hover:bg-gray-50 transition"
                >
                  Reset to defaults
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              {/* Every configured role, plus any value actually present in the
                  data — so a stray type like the "facilty" typo is colourable
                  rather than stuck on the fallback grey. */}
              {Array.from(
                new Set([
                  ...ACCOUNT_TYPES.map((t) => t.value as string),
                  ...allUsers.map((u) => u.account_type).filter(Boolean),
                ]),
              )
                .sort()
                .map((role) => (
                  <div
                    key={role}
                    className="flex items-center gap-2 border border-gray-200 rounded-lg px-2.5 py-2"
                  >
                    <input
                      type="color"
                      aria-label={`Color for ${role}`}
                      value={colorForRole(role)}
                      onChange={(e) => saveRoleColors({ ...roleColors, [role]: e.target.value })}
                      className="w-7 h-7 rounded cursor-pointer border border-gray-200 bg-white p-0.5"
                    />
                    <span
                      className="px-2.5 py-1 rounded-full text-xs font-semibold capitalize"
                      style={roleBadgeStyle(colorForRole(role))}
                    >
                      {role}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

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
                            className="px-2.5 py-1 rounded-full text-xs font-semibold capitalize"
                            style={roleBadgeStyle(colorForRole(u.account_type))}
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

                            {/* Archive / Restore — never a hard delete. */}
                            {u.status === "archived" ? (
                              <button
                                onClick={() => handleRestore(u)}
                                title="Restore user"
                                className="inline-flex items-center justify-center w-8 h-8 text-gray-400 bg-white border border-gray-200 rounded-lg hover:bg-green-50 hover:text-green-600 hover:border-green-200 transition"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                              </button>
                            ) : (
                              <button
                                onClick={() => setDeleteTarget(u)}
                                title="Archive user"
                                className="inline-flex items-center justify-center w-8 h-8 text-gray-400 bg-white border border-gray-200 rounded-lg hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                                </svg>
                              </button>
                            )}
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

      {showImport && (
        <ImportModal
          existingUsers={allUsers}
          onImport={handleImport}
          onClose={() => setShowImport(false)}
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
