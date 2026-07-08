"use client";

// Shared score visuals so tiles, detail view, and compare table all read
// the same way. Thresholds are coarse on purpose -- the audience includes
// non-technical users who want "is this good?" at a glance, not decimals.

export function scoreTone(score: number | null) {
  if (score === null)
    return { text: "text-stone-500", bg: "bg-stone-100", bar: "bg-stone-300", label: "Not scored yet" };
  if (score >= 75)
    return { text: "text-green-800", bg: "bg-green-100", bar: "bg-green-600", label: "Great match" };
  if (score >= 55)
    return { text: "text-lime-800", bg: "bg-lime-100", bar: "bg-lime-600", label: "Good match" };
  if (score >= 35)
    return { text: "text-amber-800", bg: "bg-amber-100", bar: "bg-amber-500", label: "So-so" };
  return { text: "text-red-800", bg: "bg-red-100", bar: "bg-red-500", label: "Weak match" };
}

export function ScoreBadge({ score, size = "md" }: { score: number | null; size?: "md" | "lg" }) {
  const tone = scoreTone(score);
  const dims = size === "lg" ? "h-16 w-16 text-2xl" : "h-12 w-12 text-lg";
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`${dims} ${tone.bg} ${tone.text} flex items-center justify-center rounded-full font-bold`}>
        {score !== null ? Math.round(score) : "--"}
      </div>
      <span className={`text-[11px] font-medium ${tone.text}`}>{tone.label}</span>
    </div>
  );
}

// Plain-language names for scoring factors, shared by the score breakdown
// and the weights page.
export const FACTOR_LABELS: Record<string, string> = {
  price: "Purchase price",
  commute: "Commute time",
  safety: "Neighborhood safety",
  hoa: "HOA fees",
  price_per_sqft: "Price per sq ft",
  year_built: "Year built",
  total_sqft: "Home size",
};

export function factorLabel(factor: string) {
  return FACTOR_LABELS[factor] ?? factor.replace(/_/g, " ");
}

export function ScoreBreakdown({
  subscores,
  weights,
}: {
  subscores: Record<string, number>;
  weights?: Record<string, number>;
}) {
  const entries = Object.entries(subscores);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      {entries
        .sort(([a], [b]) => (weights ? (weights[b] ?? 0) - (weights[a] ?? 0) : a.localeCompare(b)))
        .map(([factor, value]) => {
          const tone = scoreTone(value);
          return (
            <div key={factor} className="flex items-center gap-3">
              <span className="w-40 shrink-0 text-sm text-stone-600">{factorLabel(factor)}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-stone-200">
                <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(value, 3)}%` }} />
              </div>
              <span className="w-9 shrink-0 text-right text-sm font-medium text-stone-700">
                {Math.round(value)}
              </span>
            </div>
          );
        })}
    </div>
  );
}
