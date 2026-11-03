"use client";

import { useEffect, useState } from "react";
import { signOut, updatePassword } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { useAuth } from "@/context/AuthContext";

/**
 * Makes someone who signed in with a temporary password choose their own.
 *
 * The setTemporaryPassword callable (functions/user_admin.js) sets
 * users/{uid}.mustChangePassword. While it is set, this covers every page
 * with a "choose a new password" form; changing the password clears it.
 */
export default function PasswordChangeGate() {
  const { user, loading } = useAuth();
  const [required, setRequired] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (loading || !user || !db) {
      setRequired(false);
      return;
    }
    let cancelled = false;
    getDoc(doc(db, "users", user.uid))
      .then((snap) => {
        if (!cancelled) setRequired(snap.exists() && snap.data()?.mustChangePassword === true);
      })
      .catch(() => {
        // Unreadable profile: nothing to enforce.
      });
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  if (!required || !user) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    if (!auth?.currentUser || !db) return;
    setBusy(true);
    try {
      await updatePassword(auth.currentUser, password);
      await updateDoc(doc(db, "users", user.uid), { mustChangePassword: false });
      setRequired(false);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "auth/requires-recent-login") {
        setError("For security, sign out and sign in again with the temporary password, then choose a new one.");
      } else if (code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements") {
        setError("That password is too weak. Try a longer one.");
      } else {
        setError(err instanceof Error ? err.message : "Could not change the password.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6 space-y-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Choose your password</h2>
          <p className="text-sm text-gray-500 mt-1">
            You signed in with a temporary password. Pick your own to keep
            using the portal.
          </p>
        </div>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          autoComplete="new-password"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm new password"
          autoComplete="new-password"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
        )}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => auth && signOut(auth)}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Sign out
          </button>
          <button
            type="submit"
            disabled={busy}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 transition"
          >
            {busy ? "Saving…" : "Save password"}
          </button>
        </div>
      </form>
    </div>
  );
}
