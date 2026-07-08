"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, getCurrentSession, signOut as cognitoSignOut } from "./auth";

interface AuthContextValue {
  session: Session | null;
  loading: boolean;
  setSession: (session: Session | null) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCurrentSession()
      .then(setSession)
      .finally(() => setLoading(false));
  }, []);

  const signOut = () => {
    cognitoSignOut();
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, loading, setSession, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
