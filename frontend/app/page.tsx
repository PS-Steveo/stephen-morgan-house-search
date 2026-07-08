"use client";

import { AuthProvider, useAuth } from "@/lib/AuthContext";
import { LoginForm } from "@/components/LoginForm";
import { Dashboard } from "@/components/Dashboard";

function Root() {
  const { session, loading } = useAuth();
  if (loading) return <p className="mt-24 text-center text-sm text-gray-500">Loading...</p>;
  return session ? <Dashboard /> : <LoginForm />;
}

export default function Home() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}
