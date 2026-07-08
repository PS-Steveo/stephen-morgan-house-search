"use client";

import { useEffect, useState } from "react";
import { api, WeightsConfig } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { factorLabel } from "./Score";

// Everything on this page is phrased for a non-technical reader: weights
// are "how much this matters" (shown as a share of the total), and bounds
// are "ideal" vs "deal-breaker" values rather than best/worst normalization
// endpoints.

const FACTOR_HELP: Record<string, { question: string; ideal: string; worst: string }> = {
  price: { question: "How much does the price matter?", ideal: "Dream price", worst: "Too expensive" },
  commute: { question: "How much does the commute matter?", ideal: "Ideal commute", worst: "Too far" },
  safety: { question: "How much does neighborhood safety matter?", ideal: "", worst: "" },
  hoa: { question: "How much do HOA fees matter?", ideal: "Ideal fee", worst: "Too high" },
  price_per_sqft: { question: "How much does price per sq ft matter?", ideal: "Great value", worst: "Overpriced" },
  year_built: { question: "How much does the home's age matter?", ideal: "New enough", worst: "Too old" },
  total_sqft: { question: "How much does size matter?", ideal: "Plenty of room", worst: "Too small" },
};

export function WeightsEditor() {
  const { session } = useAuth();
  const [config, setConfig] = useState<WeightsConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isOwner = session?.role === "owner";

  useEffect(() => {
    if (!session) return;
    api
      .getWeights(session.idToken)
      .then(setConfig)
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your settings"));
  }, [session]);

  if (!config) return <p className="text-sm text-stone-400">{error ?? "Loading..."}</p>;

  const totalWeight = Object.values(config.weights).reduce((a, b) => a + b, 0);

  const setWeight = (factor: string, value: number) => {
    setConfig({ ...config, weights: { ...config.weights, [factor]: value } });
  };

  const boundsKeyFor = (factor: string) =>
    config.bounds[factor] ? factor : config.bounds[`${factor}_minutes`] ? `${factor}_minutes` : factor;

  const setBound = (boundsKey: string, which: "best" | "worst", value: number) => {
    setConfig({
      ...config,
      bounds: {
        ...config.bounds,
        [boundsKey]: { ...(config.bounds[boundsKey] ?? { best: 0, worst: 0 }), [which]: value },
      },
    });
  };

  const save = async () => {
    if (!session) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.putWeights(session.idToken, { weights: config.weights, bounds: config.bounds });
      setConfig(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-5">
      <div>
        <h1 className="text-xl font-bold text-stone-900">What matters most to you?</h1>
        <p className="mt-1 text-sm text-stone-500">
          Slide each item to say how much it counts. Every house&apos;s score updates right away —
          nothing is lost if you change your mind later.
        </p>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="space-y-4">
        {Object.entries(config.weights).map(([factor, weight]) => {
          const boundsKey = boundsKeyFor(factor);
          const bounds = config.bounds[boundsKey];
          const help = FACTOR_HELP[factor];
          const share = totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0;
          return (
            <div key={factor} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-stone-900">{factorLabel(factor)}</p>
                  <p className="text-xs text-stone-400">{help?.question}</p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-sm font-bold text-emerald-800">
                  {share}% of score
                </span>
              </div>
              <div className="mt-3 flex items-center gap-3 text-xs text-stone-400">
                <span>Doesn&apos;t matter</span>
                <input
                  type="range"
                  min={0}
                  max={50}
                  value={weight}
                  disabled={!isOwner}
                  onChange={(e) => setWeight(factor, Number(e.target.value))}
                  className="flex-1 accent-emerald-700"
                />
                <span>Matters a lot</span>
              </div>
              {bounds && (
                <div className="mt-3 flex gap-3 border-t border-stone-100 pt-3 text-sm">
                  <label className="flex-1 text-stone-600">
                    {help?.ideal || "Ideal"} <span className="text-stone-400">(scores 100)</span>
                    <input
                      type="number"
                      value={bounds.best}
                      disabled={!isOwner}
                      onChange={(e) => setBound(boundsKey, "best", Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-stone-300 px-2.5 py-1.5 focus:border-emerald-600 focus:outline-none disabled:bg-stone-50"
                    />
                  </label>
                  <label className="flex-1 text-stone-600">
                    {help?.worst || "Deal-breaker"} <span className="text-stone-400">(scores 0)</span>
                    <input
                      type="number"
                      value={bounds.worst}
                      disabled={!isOwner}
                      onChange={(e) => setBound(boundsKey, "worst", Number(e.target.value))}
                      className="mt-1 w-full rounded-lg border border-stone-300 px-2.5 py-1.5 focus:border-emerald-600 focus:outline-none disabled:bg-stone-50"
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isOwner && (
        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save my priorities"}
          </button>
          {saved && <span className="text-sm font-medium text-green-700">✓ Saved — scores updated</span>}
        </div>
      )}
    </div>
  );
}
