"use client";

import { useEffect, useState, FormEvent } from "react";
import { api, Location } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";

export function LocationsEditor() {
  const { session } = useAuth();
  const [locations, setLocations] = useState<Location[]>([]);
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const isOwner = session?.role === "owner";

  const load = () => {
    if (!session) return;
    api
      .listLocations(session.idToken)
      .then((res) => setLocations(res.locations))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load locations"));
  };

  useEffect(load, [session]);

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !label.trim() || !address.trim()) return;
    try {
      await api.createLocation(session.idToken, label.trim(), address.trim());
      setLabel("");
      setAddress("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add location");
    }
  };

  const handleDelete = async (id: string) => {
    if (!session) return;
    await api.deleteLocation(session.idToken, id);
    load();
  };

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-xl font-semibold">Saved locations</h1>
      <p className="text-sm text-gray-500">
        Commute/errand anchors (work, Morgan&apos;s work, golf course, etc.) used for distance scoring.
      </p>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <ul className="space-y-2">
        {locations.map((loc) => (
          <li key={loc.location_id} className="flex items-center justify-between rounded border p-3">
            <div>
              <div className="font-medium">{loc.label}</div>
              <div className="text-sm text-gray-500">{loc.address}</div>
            </div>
            {isOwner && (
              <button onClick={() => handleDelete(loc.location_id)} className="text-sm text-red-600">
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && (
        <form onSubmit={handleAdd} className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Label (e.g. Work)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="flex-1 rounded border px-3 py-2"
          />
          <input
            type="text"
            placeholder="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="flex-1 rounded border px-3 py-2"
          />
          <button type="submit" className="rounded bg-black px-4 py-2 text-white">
            Add
          </button>
        </form>
      )}
    </div>
  );
}
