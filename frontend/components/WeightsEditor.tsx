"use client";

import { useEffect, useState } from "react";
import { api, WeightsConfig } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";

export function WeightsEditor() {
  const { session } = useAuth();
  const [config, setConfig] = useState<WeightsConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const isOwner = session?.role === "owner";

  useEffect(() => {
    if (!session) return;
    api
      .getWeights(session.idToken)
      .then(setConfig)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load weights"));
  }, [session]);

  if (!config) return <p className="text-sm text-gray-500">{error ?? "Loading..."}</p>;

  const totalWeight = Object.values(config.weights).reduce((a, b) => a + b, 0);

  const setWeight = (factor: string, value: number) => {
    setConfig({ ...config, weights: { ...config.weights, [factor]: value } });
  };

  const boundsKeyFor = (factor: string) =>
    config.bounds[factor] ? factor : `${factor}_minutes` in config.bounds ? `${factor}_minutes` : factor;

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Scoring weights</h1>
        <p className="text-sm text-gray-500">
          Total: {totalWeight}
          {totalWeight !== 100 && " (doesn't need to sum to 100, but that's the convention)"}
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="space-y-4">
        {Object.entries(config.weights).map(([factor, weight]) => {
          const boundsKey = boundsKeyFor(factor);
          const bounds = config.bounds[boundsKey];
          return (
            <div key={factor} className="rounded border p-3">
              <div className="flex items-center justify-between">
                <label className="font-medium capitalize">{factor.replace(/_/g, " ")}</label>
                <span className="text-sm text-gray-500">{weight}</span>
              </div>
              <input
                type="range"
                min={0}
                max={50}
                value={weight}
                disabled={!isOwner}
                onChange={(e) => setWeight(factor, Number(e.target.value))}
                className="w-full"
              />
              {bounds && (
                <div className="mt-2 flex gap-3 text-sm">
                  <label className="flex-1">
                    Best (100 pts)
                    <input
                      type="number"
                      value={bounds.best}
                      disabled={!isOwner}
                      onChange={(e) => setBound(boundsKey, "best", Number(e.target.value))}
                      className="mt-1 w-full rounded border px-2 py-1 disabled:bg-gray-50"
                    />
                  </label>
                  <label className="flex-1">
                    Worst (0 pts)
                    <input
                      type="number"
                      value={bounds.worst}
                      disabled={!isOwner}
                      onChange={(e) => setBound(boundsKey, "worst", Number(e.target.value))}
                      className="mt-1 w-full rounded border px-2 py-1 disabled:bg-gray-50"
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isOwner && (
        <button onClick={save} disabled={saving} className="rounded bg-black px-4 py-2 text-white disabled:opacity-50">
          {saving ? "Saving..." : "Save weights"}
        </button>
      )}
    </div>
  );
}
