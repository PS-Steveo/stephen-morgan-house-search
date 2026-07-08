"use client";

import { useEffect, useState, FormEvent } from "react";
import { api, Property, Vote, WeightsConfig } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { VoteBadges, VoteButtons } from "./VoteTiles";
import { ScoreBadge, ScoreBreakdown } from "./Score";

const DOCUMENT_TYPES = [
  { value: "photo", label: "Photo of the house" },
  { value: "mls", label: "Listing sheet (MLS)" },
  { value: "gis", label: "GIS / county report" },
  { value: "detailed", label: "Detailed property report" },
  { value: "permit", label: "Permit record" },
];

const EDITABLE_FIELDS: Array<{ key: keyof Property; label: string; prefix?: string; hint?: string }> = [
  { key: "price", label: "Asking price", prefix: "$" },
  { key: "beds", label: "Bedrooms" },
  { key: "baths", label: "Bathrooms" },
  { key: "total_sqft", label: "Size (sq ft)" },
  { key: "hoa", label: "HOA fee / month", prefix: "$" },
  { key: "year_built", label: "Year built" },
  { key: "commute_minutes", label: "Commute (minutes)" },
  { key: "safety_score", label: "Safety score", hint: "0–100, higher is safer" },
];

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="font-semibold text-stone-900">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function PropertyDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { session } = useAuth();
  const [property, setProperty] = useState<Property | null>(null);
  const [weights, setWeights] = useState<WeightsConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [docType, setDocType] = useState("photo");
  const [uploading, setUploading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const isOwner = session?.role === "owner";

  const load = () => {
    if (!session) return;
    api
      .getProperty(session.idToken, id)
      .then((p) => {
        setProperty(p);
        setNotes(p.notes ?? "");
        const values: Record<string, string> = {};
        for (const f of EDITABLE_FIELDS) {
          const v = p[f.key];
          if (v !== undefined && v !== null) values[f.key as string] = String(v);
        }
        setFieldValues(values);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load this house"));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [session, id]);

  useEffect(() => {
    if (!session) return;
    api.getWeights(session.idToken).then(setWeights).catch(() => {});
  }, [session]);

  useEffect(() => {
    if (!session || !property) return;
    property.photo_keys.forEach((key) => {
      if (photoUrls[key]) return;
      api
        .getDownloadUrl(session.idToken, id, key)
        .then((res) => setPhotoUrls((prev) => ({ ...prev, [key]: res.download_url })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property, session]);

  const saveFields = async (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    const updates: Partial<Property> = { notes };
    for (const f of EDITABLE_FIELDS) {
      const raw = fieldValues[f.key as string];
      if (raw === undefined || raw === "") continue;
      (updates as Record<string, unknown>)[f.key as string] = Number(raw);
    }
    try {
      const updated = await api.updateProperty(session.idToken, id, updates);
      setProperty(updated);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save changes");
    }
  };

  const handleVote = async (vote: Vote) => {
    if (!session) return;
    const res = await api.castVote(session.idToken, id, vote);
    setProperty((prev) => (prev ? { ...prev, votes: res.votes } : prev));
  };

  const handleArchive = async () => {
    if (!session) return;
    if (!confirm("Move this house to the archive? You can still find it under “See archived houses.”")) return;
    await api.archiveProperty(session.idToken, id);
    onBack();
  };

  const handleUpload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!session || !property) return;
    const fileInput = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const contentType = file.type || "application/octet-stream";
      const { upload_url, key } = await api.getUploadUrl(session.idToken, id, docType, file.name, contentType);
      await api.uploadFile(upload_url, file);
      if (docType === "photo") {
        const updated = await api.updateProperty(session.idToken, id, {
          photo_keys: [...property.photo_keys, key],
        });
        setProperty(updated);
      } else {
        await api.extract(session.idToken, id, docType, key);
        load();
      }
      fileInput.value = "";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload didn't go through — try again");
    } finally {
      setUploading(false);
    }
  };

  if (!property) {
    return (
      <div>
        <button onClick={onBack} className="text-sm text-stone-500 hover:underline">
          &larr; Back to all houses
        </button>
        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        ) : (
          <p className="mt-4 text-sm text-stone-400">Loading...</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="text-sm text-stone-500 hover:underline">
        &larr; Back to all houses
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-stone-900">{property.address}</h1>
          <p className="mt-1 text-sm text-stone-500">
            {property.price ? `$${property.price.toLocaleString()}` : "Price unknown"}
            {property.beds ? ` · ${property.beds} bd` : ""}
            {property.baths ? ` · ${property.baths} ba` : ""}
            {property.total_sqft ? ` · ${property.total_sqft.toLocaleString()} sqft` : ""}
          </p>
          {property.extraction_status === "needs_review" && (
            <p className="mt-2 inline-block rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
              ⚠️ Some details couldn&apos;t be read confidently — please double-check the numbers below
            </p>
          )}
          <div className="mt-3 space-y-2.5">
            <VoteBadges votes={property.votes} />
            <VoteButtons currentVote={session ? property.votes?.[session.email] : undefined} onVote={handleVote} />
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <ScoreBadge score={property.score} size="lg" />
          {isOwner && (
            <button
              onClick={handleArchive}
              className="rounded-lg border border-stone-300 px-3 py-1.5 text-xs text-stone-500 hover:border-red-300 hover:text-red-600"
            >
              Archive this house
            </button>
          )}
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {Object.keys(property.subscores).length > 0 && (
        <Section
          title="Why this score?"
          subtitle="Each bar shows how this house does on one thing you care about (100 = ideal)."
        >
          <ScoreBreakdown subscores={property.subscores} weights={weights?.weights} />
        </Section>
      )}

      {property.photo_keys.length > 0 && (
        <Section title="Photos">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {property.photo_keys.map((key) =>
              photoUrls[key] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={key} src={photoUrls[key]} alt="" className="aspect-square rounded-xl object-cover" />
              ) : (
                <div key={key} className="aspect-square animate-pulse rounded-xl bg-stone-100" />
              )
            )}
          </div>
        </Section>
      )}

      {isOwner && (
        <Section
          title="Add photos or documents"
          subtitle="Upload a listing sheet or county report and the details below fill in automatically."
        >
          <form onSubmit={handleUpload} className="flex flex-wrap items-center gap-2.5">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input type="file" name="file" required className="text-sm text-stone-600" />
            <button
              type="submit"
              disabled={uploading}
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </form>
        </Section>
      )}

      <Section
        title="The numbers"
        subtitle={isOwner ? "Filled in from uploads, but you can correct anything here." : "Read-only for your account."}
      >
        <form onSubmit={saveFields} className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {EDITABLE_FIELDS.map((f) => (
              <label key={f.key as string} className="text-sm text-stone-600">
                {f.label}
                <div className="relative mt-1">
                  {f.prefix && (
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-stone-400">
                      {f.prefix}
                    </span>
                  )}
                  <input
                    type="number"
                    step="any"
                    value={fieldValues[f.key as string] ?? ""}
                    onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key as string]: e.target.value }))}
                    disabled={!isOwner}
                    className={`w-full rounded-lg border border-stone-300 py-2 text-sm focus:border-emerald-600 focus:outline-none disabled:bg-stone-50 disabled:text-stone-500 ${f.prefix ? "pl-6 pr-2.5" : "px-2.5"}`}
                  />
                </div>
                {f.hint && <span className="mt-0.5 block text-[11px] text-stone-400">{f.hint}</span>}
              </label>
            ))}
          </div>
          <label className="block text-sm text-stone-600">
            Notes — anything you noticed or want to remember
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!isOwner}
              className="mt-1 w-full rounded-lg border border-stone-300 px-2.5 py-2 text-sm focus:border-emerald-600 focus:outline-none disabled:bg-stone-50"
              rows={3}
              placeholder="e.g. Great backyard, but the basement smelled musty"
            />
          </label>
          {isOwner && (
            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-lg bg-emerald-700 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
              >
                Save changes
              </button>
              {saved && <span className="text-sm font-medium text-green-700">✓ Saved</span>}
            </div>
          )}
        </form>
      </Section>

      {(["extracted_mls", "extracted_gis", "extracted_detailed", "extracted_permit"] as const).some(
        (field) => property[field]
      ) && (
        <details className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <summary className="cursor-pointer text-sm font-medium text-stone-500">
            What we read from the uploaded documents (raw data)
          </summary>
          <div className="mt-3 space-y-4">
            {(["extracted_mls", "extracted_gis", "extracted_detailed", "extracted_permit"] as const).map((field) =>
              property[field] ? (
                <div key={field}>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-400">
                    {field.replace("extracted_", "")}
                  </h3>
                  <pre className="overflow-x-auto rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
                    {JSON.stringify(property[field], null, 2)}
                  </pre>
                </div>
              ) : null
            )}
          </div>
        </details>
      )}
    </div>
  );
}
