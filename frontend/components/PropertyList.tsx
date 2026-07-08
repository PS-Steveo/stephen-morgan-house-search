"use client";

import { useEffect, useState, FormEvent } from "react";
import { api, Property } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";

const EXTRACTION_LABEL: Record<Property["extraction_status"], string> = {
  pending: "Pending",
  complete: "Complete",
  needs_review: "Needs review",
};

export function PropertyList({ onSelect }: { onSelect: (id: string) => void }) {
  const { session } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [creating, setCreating] = useState(false);

  const load = () => {
    if (!session) return;
    setLoading(true);
    api
      .listProperties(session.idToken)
      .then((res) => setProperties(res.properties))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load properties"))
      .finally(() => setLoading(false));
  };

  useEffect(load, [session]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !address.trim()) return;
    setCreating(true);
    try {
      await api.createProperty(session.idToken, address.trim());
      setAddress("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create property");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      {session?.role === "owner" && (
        <form onSubmit={handleCreate} className="flex gap-2">
          <input
            type="text"
            placeholder="New property address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="flex-1 rounded border px-3 py-2"
          />
          <button
            type="submit"
            disabled={creating}
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading...</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {properties.map((p) => (
          <button
            key={p.property_id}
            onClick={() => onSelect(p.property_id)}
            className="rounded border p-4 text-left hover:border-black"
          >
            <div className="flex items-start justify-between">
              <span className="font-medium">{p.address}</span>
              <span className="text-lg font-semibold">
                {p.score !== null ? Math.round(p.score) : "--"}
              </span>
            </div>
            <div className="mt-2 text-sm text-gray-500">
              {p.price ? `$${p.price.toLocaleString()}` : "No price yet"}
              {p.total_sqft ? ` · ${p.total_sqft.toLocaleString()} sqft` : ""}
            </div>
            <div className="mt-1 text-xs text-gray-400">
              {EXTRACTION_LABEL[p.extraction_status]}
              {p.extraction_status === "needs_review" && (
                <span className="ml-1 text-amber-600">-- check extracted fields</span>
              )}
            </div>
          </button>
        ))}
      </div>

      {!loading && properties.length === 0 && (
        <p className="text-sm text-gray-500">No properties yet.</p>
      )}
    </div>
  );
}
