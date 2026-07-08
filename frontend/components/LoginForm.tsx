"use client";

import { useState, FormEvent } from "react";
import { CognitoUser } from "amazon-cognito-identity-js";
import { signIn, completeNewPassword } from "@/lib/auth";
import { useAuth } from "@/lib/AuthContext";

export function LoginForm() {
  const { setSession } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pendingUser, setPendingUser] = useState<CognitoUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await signIn(username, password);
      if (result.status === "success") {
        setSession(result.session);
      } else {
        setPendingUser(result.cognitoUser);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const handleNewPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!pendingUser) return;
    setError(null);
    setBusy(true);
    try {
      const session = await completeNewPassword(pendingUser, newPassword);
      setSession(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set new password");
    } finally {
      setBusy(false);
    }
  };

  if (pendingUser) {
    return (
      <form onSubmit={handleNewPassword} className="mx-auto mt-24 w-full max-w-sm space-y-4">
        <h1 className="text-xl font-semibold">Set a new password</h1>
        <p className="text-sm text-gray-500">First sign-in requires a permanent password.</p>
        <input
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          className="w-full rounded border px-3 py-2"
          required
          minLength={10}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {busy ? "Setting..." : "Set password"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={handleSignIn} className="mx-auto mt-24 w-full max-w-sm space-y-4">
      <h1 className="text-xl font-semibold">House Search</h1>
      <input
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        className="w-full rounded border px-3 py-2"
        required
        autoComplete="username"
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        className="w-full rounded border px-3 py-2"
        required
        autoComplete="current-password"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded bg-black px-3 py-2 text-white disabled:opacity-50"
      >
        {busy ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
