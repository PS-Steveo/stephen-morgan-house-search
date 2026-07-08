"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { PropertyList } from "./PropertyList";
import { PropertyDetail } from "./PropertyDetail";
import { WeightsEditor } from "./WeightsEditor";
import { LocationsEditor } from "./LocationsEditor";
import { MapView } from "./MapView";

type View = "properties" | "map" | "weights" | "locations";

export function Dashboard() {
  const { session, signOut } = useAuth();
  const [view, setView] = useState<View>("properties");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const navItem = (v: View, label: string) => (
    <button
      onClick={() => {
        setView(v);
        setSelectedId(null);
      }}
      className={`rounded px-3 py-1 text-sm ${view === v ? "bg-black text-white" : "text-gray-600 hover:bg-gray-100"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <nav className="flex gap-2">
          {navItem("properties", "Properties")}
          {navItem("map", "Map")}
          {navItem("weights", "Weights")}
          {navItem("locations", "Locations")}
        </nav>
        <div className="flex items-center gap-3 text-sm text-gray-500">
          <span>
            {session?.email} ({session?.role})
          </span>
          <button onClick={signOut} className="hover:underline">
            Sign out
          </button>
        </div>
      </header>

      {view === "properties" &&
        (selectedId ? (
          <PropertyDetail id={selectedId} onBack={() => setSelectedId(null)} />
        ) : (
          <PropertyList onSelect={setSelectedId} />
        ))}
      {view === "map" && (
        <MapView
          onSelect={(id) => {
            setView("properties");
            setSelectedId(id);
          }}
        />
      )}
      {view === "weights" && <WeightsEditor />}
      {view === "locations" && <LocationsEditor />}
    </div>
  );
}
