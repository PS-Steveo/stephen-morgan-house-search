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
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your places"));
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
      setError(err instanceof Error ? err.message : "Couldn't add that place");
    }
  };

  const handleDelete = async (id: string) => {
    if (!session) return;
    await api.deleteLocation(session.idToken, id);
    load();
  };

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-stone-900">Places you go often</h1>
        <p className="mt-1 text-sm text-stone-500">
          Work, family, the gym, the golf course — these are used to judge each house&apos;s commute.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <ul className="space-y-2">
        {locations.map((loc) => (
          <li
            key={loc.location_id}
            className="flex items-center justify-between rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"
          >
            <div>
              <div className="font-semibold text-stone-900">📍 {loc.label}</div>
              <div className="text-sm text-stone-500">{loc.address}</div>
            </div>
            {isOwner && (
              <button
                onClick={() => handleDelete(loc.location_id)}
                className="text-sm text-stone-400 hover:text-red-600"
              >
                Remove
              </button>
            )}
          </li>
        ))}
        {locations.length === 0 && (
          <li className="rounded-2xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
            No places saved yet{isOwner ? " — add your first one below." : "."}
          </li>
        )}
      </ul>

      {isOwner && (
        <form onSubmit={handleAdd} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-medium text-stone-700">Add a place</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              placeholder="Name (e.g. Work)"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none sm:w-40"
            />
            <input
              type="text"
              placeholder="Address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Add
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
