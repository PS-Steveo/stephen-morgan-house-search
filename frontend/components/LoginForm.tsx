"use client";

import { useState, FormEvent } from "react";
import { CognitoUser } from "amazon-cognito-identity-js";
import { signIn, completeNewPassword } from "@/lib/auth";
import { useAuth } from "@/lib/AuthContext";

// Cognito error messages are technical ("User does not exist.") -- translate
// the common ones into something a non-technical user can act on.
function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : "";
  if (/user does not exist|incorrect username or password/i.test(msg))
    return "That username or password doesn't look right. Check for typos and try again.";
  if (/password attempts exceeded/i.test(msg))
    return "Too many tries — wait a few minutes, then try again.";
  if (/network/i.test(msg)) return "Couldn't reach the server. Check your internet connection.";
  return msg || "Something went wrong signing in.";
}

const inputCls =
  "w-full rounded-lg border border-stone-300 px-3 py-2.5 text-sm focus:border-emerald-600 focus:outline-none";

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
      const result = await signIn(username.trim(), password);
      if (result.status === "success") {
        setSession(result.session);
      } else {
        setPendingUser(result.cognitoUser);
      }
    } catch (err) {
      setError(friendlyError(err));
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
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <p className="text-4xl">🏡</p>
          <h1 className="mt-2 text-2xl font-bold text-stone-900">Stephen &amp; Morgan&apos;s House Search</h1>
          <p className="mt-1 text-sm text-stone-500">Sign in to see the houses</p>
        </div>

        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          {pendingUser ? (
            <form onSubmit={handleNewPassword} className="space-y-4">
              <div>
                <h2 className="font-semibold text-stone-900">Choose your password</h2>
                <p className="mt-1 text-sm text-stone-500">
                  This replaces the temporary one from your email. Use at least 10 characters with an
                  uppercase letter, a lowercase letter, and a number.
                </p>
              </div>
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputCls}
                required
                minLength={10}
                autoComplete="new-password"
              />
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {busy ? "Saving..." : "Save password and sign in"}
              </button>
            </form>
          ) : (
            <form onSubmit={handleSignIn} className="space-y-4">
              <label className="block text-sm font-medium text-stone-700">
                Username
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className={`mt-1 ${inputCls}`}
                  required
                  autoComplete="username"
                />
              </label>
              <label className="block text-sm font-medium text-stone-700">
                Password
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`mt-1 ${inputCls}`}
                  required
                  autoComplete="current-password"
                />
              </label>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-emerald-700 px-3 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {busy ? "Signing in..." : "Sign in"}
              </button>
              <p className="text-center text-xs text-stone-400">
                First time? Use the temporary password from your email — you&apos;ll pick your own next.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
