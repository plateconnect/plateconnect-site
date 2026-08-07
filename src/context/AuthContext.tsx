"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { User, onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

interface AuthContextType {
  user: User | null;
  isAdmin: boolean;
  isStaff: boolean;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isAdmin: false,
  isStaff: false,
  loading: true,
});

/**
 * Resolve admin/staff from the Auth CUSTOM CLAIM rather than users/{uid}.admin.
 *
 * The Firestore field was the single point of failure behind the Aug 2026
 * lockout: deleting the users collection revoked every admin, and repairing it
 * required already being an admin. Claims live in Auth, survive any Firestore
 * loss, are readable by security rules without a document read, and cannot be
 * forged by a client.
 *
 * The Firestore field is retained only as a transitional fallback for accounts
 * whose claim has not been granted yet. Security rules prevent a user from
 * writing `admin` to their own document, so the fallback cannot be abused.
 * Remove it once every admin has a claim.
 */
async function resolvePrivileges(
  currentUser: User,
): Promise<{ isAdmin: boolean; isStaff: boolean }> {
  let token = await currentUser.getIdTokenResult();

  // A claim granted after this token was minted won't appear until refresh.
  // Only pay for a forced refresh when the claim is missing.
  if (token.claims.admin !== true && token.claims.staff !== true) {
    token = await currentUser.getIdTokenResult(true);
  }

  if (token.claims.admin === true) {
    return { isAdmin: true, isStaff: true };
  }
  if (token.claims.staff === true) {
    return { isAdmin: false, isStaff: true };
  }

  // Transitional fallback.
  if (db) {
    try {
      const snap = await getDoc(doc(db, "users", currentUser.uid));
      if (snap.exists() && snap.data()?.admin === true) {
        console.warn(
          `[auth] ${currentUser.uid} is admin via the legacy Firestore field ` +
            `but has no custom claim. Grant one with set_claims.py.`,
        );
        return { isAdmin: true, isStaff: true };
      }
    } catch {
      // Rules may deny the read; fall through to no privileges.
    }
  }

  return { isAdmin: false, isStaff: false };
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isStaff, setIsStaff] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setLoading(true);

      if (!currentUser) {
        if (!cancelled) {
          setIsAdmin(false);
          setIsStaff(false);
          setUser(null);
          setLoading(false);
        }
        return;
      }

      let privileges = { isAdmin: false, isStaff: false };
      try {
        privileges = await resolvePrivileges(currentUser);
      } catch (err) {
        console.error("[auth] could not resolve privileges", err);
      }

      // Guard against a second auth event landing while this one was awaiting.
      if (cancelled) return;

      setIsAdmin(privileges.isAdmin);
      setIsStaff(privileges.isStaff);
      setUser(currentUser);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, isAdmin, isStaff, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
