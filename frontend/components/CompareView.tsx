"use client";

import { useEffect, useState } from "react";
import { api, Property } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { scoreTone } from "./Score";
import { VOTE_META } from "./VoteTiles";

// Side-by-side table. Each row highlights the best house for that row in
// green, so "which one wins on price?" is answerable without reading numbers.

interface Row {
  label: string;
  value: (p: Property) => number | null | undefined;
  format: (v: number) => string;
  higherIsBetter: boolean;
}

const ROWS: Row[] = [
  { label: "Asking price", value: (p) => p.price, format: (v) => `$${v.toLocaleString()}`, higherIsBetter: false },
  { label: "Price per sq ft", value: (p) => p.price_per_sqft ?? (p.price && p.total_sqft ? p.price / p.total_sqft : null), format: (v) => `$${Math.round(v)}`, higherIsBetter: false },
  { label: "Size (sq ft)", value: (p) => p.total_sqft, format: (v) => v.toLocaleString(), higherIsBetter: true },
  { label: "Bedrooms", value: (p) => p.beds, format: (v) => String(v), higherIsBetter: true },
  { label: "Bathrooms", value: (p) => p.baths, format: (v) => String(v), higherIsBetter: true },
  { label: "Year built", value: (p) => p.year_built, format: (v) => String(v), higherIsBetter: true },
  { label: "HOA / month", value: (p) => p.hoa, format: (v) => `$${v}`, higherIsBetter: false },
  { label: "Commute (min)", value: (p) => p.commute_minutes, format: (v) => `${v} min`, higherIsBetter: false },
  { label: "Safety score", value: (p) => p.safety_score, format: (v) => String(Math.round(v)), higherIsBetter: true },
];

export function CompareView({ onSelect }: { onSelect: (id: string) => void }) {
  const { session } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    api
      .listProperties(session.idToken)
      .then((res) => setProperties(res.properties)) // API already sorts best score first
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your houses"))
      .finally(() => setLoading(false));
  }, [session]);

  if (loading) return <p className="text-sm text-stone-400">Loading comparison...</p>;
  if (error) return <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (properties.length < 2) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center">
        <p className="text-3xl">⚖️</p>
        <p className="mt-2 font-medium text-stone-700">Add at least two houses to compare them</p>
        <p className="mt-1 text-sm text-stone-500">Once you have a few, this page puts them side by side.</p>
      </div>
    );
  }

  const bestIn = (row: Row): Set<string> => {
    let best: number | null = null;
    for (const p of properties) {
      const v = row.value(p);
      if (v == null) continue;
      const n = Number(v);
      if (best === null || (row.higherIsBetter ? n > best : n < best)) best = n;
    }
    if (best === null) return new Set();
    return new Set(
      properties.filter((p) => Number(row.value(p)) === best && row.value(p) != null).map((p) => p.property_id)
    );
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-stone-500">
        The <span className="rounded bg-green-100 px-1.5 py-0.5 font-medium text-green-800">green</span> cell in each
        row is the best house for that item. Tap an address to open it.
      </p>
      <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white shadow-sm">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-stone-200">
              <th className="sticky left-0 bg-white p-3 text-left font-medium text-stone-400">House</th>
              {properties.map((p) => (
                <th key={p.property_id} className="p-3 text-left align-top">
                  <button
                    onClick={() => onSelect(p.property_id)}
                    className="max-w-40 truncate text-left font-semibold text-emerald-800 underline-offset-2 hover:underline"
                    title={p.address}
                  >
                    {p.address.split(",")[0]}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-stone-100 bg-stone-50/50">
              <td className="sticky left-0 bg-white p-3 font-medium text-stone-600">Overall score</td>
              {properties.map((p) => {
                const tone = scoreTone(p.score);
                return (
                  <td key={p.property_id} className="p-3">
                    <span className={`inline-block rounded-full px-2.5 py-1 font-bold ${tone.bg} ${tone.text}`}>
                      {p.score !== null ? Math.round(p.score) : "--"}
                    </span>
                    <span className={`ml-1.5 text-xs ${tone.text}`}>{tone.label}</span>
                  </td>
                );
              })}
            </tr>
            {ROWS.map((row) => {
              const best = bestIn(row);
              return (
                <tr key={row.label} className="border-b border-stone-100">
                  <td className="sticky left-0 bg-white p-3 font-medium text-stone-600">{row.label}</td>
                  {properties.map((p) => {
                    const v = row.value(p);
                    const isBest = best.has(p.property_id) && best.size < properties.length;
                    return (
                      <td key={p.property_id} className="p-3">
                        {v != null ? (
                          <span
                            className={
                              isBest
                                ? "rounded bg-green-100 px-1.5 py-0.5 font-semibold text-green-800"
                                : "text-stone-700"
                            }
                          >
                            {row.format(Number(v))}
                          </span>
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <td className="sticky left-0 bg-white p-3 font-medium text-stone-600">Votes</td>
              {properties.map((p) => (
                <td key={p.property_id} className="p-3">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(p.votes ?? {}).length === 0 && <span className="text-stone-300">—</span>}
                    {Object.entries(p.votes ?? {}).map(([email, vote]) => (
                      <span key={email} title={`${email}: ${VOTE_META[vote].label}`} className="text-base">
                        {VOTE_META[vote].icon}
                      </span>
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
