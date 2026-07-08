"use client";

import { useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import { PropertyList } from "./PropertyList";
import { PropertyDetail } from "./PropertyDetail";
import { WeightsEditor } from "./WeightsEditor";
import { LocationsEditor } from "./LocationsEditor";
import { MapView } from "./MapView";
import { CompareView } from "./CompareView";

type View = "properties" | "compare" | "map" | "weights" | "locations";

const NAV: Array<{ view: View; label: string; icon: string }> = [
  { view: "properties", label: "Houses", icon: "🏠" },
  { view: "compare", label: "Compare", icon: "⚖️" },
  { view: "map", label: "Map", icon: "🗺️" },
  { view: "weights", label: "Priorities", icon: "🎚️" },
  { view: "locations", label: "My places", icon: "📍" },
];

export function Dashboard() {
  const { session, signOut } = useAuth();
  const [view, setView] = useState<View>("properties");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const openProperty = (id: string) => {
    setView("properties");
    setSelectedId(id);
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏡</span>
            <span className="font-bold text-stone-900">House Search</span>
          </div>
          <div className="flex items-center gap-3 text-sm text-stone-500">
            <span className="hidden sm:inline">
              {session?.email}
              {session?.role === "viewer" && (
                <span className="ml-1.5 rounded-full bg-stone-100 px-2 py-0.5 text-xs">view only</span>
              )}
            </span>
            <button onClick={signOut} className="text-stone-400 underline-offset-2 hover:text-stone-600 hover:underline">
              Sign out
            </button>
          </div>
        </div>
        <nav className="mx-auto flex w-full max-w-5xl gap-1 overflow-x-auto px-4 pb-2 sm:px-6">
          {NAV.map((item) => (
            <button
              key={item.view}
              onClick={() => {
                setView(item.view);
                setSelectedId(null);
              }}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                view === item.view
                  ? "bg-emerald-700 text-white"
                  : "text-stone-600 hover:bg-stone-100"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
        {view === "properties" &&
          (selectedId ? (
            <PropertyDetail id={selectedId} onBack={() => setSelectedId(null)} />
          ) : (
            <PropertyList onSelect={setSelectedId} />
          ))}
        {view === "compare" && <CompareView onSelect={openProperty} />}
        {view === "map" && <MapView onSelect={openProperty} />}
        {view === "weights" && <WeightsEditor />}
        {view === "locations" && <LocationsEditor />}
      </main>
    </div>
  );
}
