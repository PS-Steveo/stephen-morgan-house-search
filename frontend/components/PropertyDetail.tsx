"use client";

import { useEffect, useState, FormEvent } from "react";
import { api, Property, Vote } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { VoteBadges, VoteButtons } from "./VoteTiles";

const DOCUMENT_TYPES = [
  { value: "mls", label: "MLS sheet" },
  { value: "gis", label: "GIS report" },
  { value: "detailed", label: "Detailed property report" },
  { value: "permit", label: "Permit record" },
];

const EDITABLE_FIELDS: Array<{ key: keyof Property; label: string }> = [
  { key: "price", label: "Price" },
  { key: "beds", label: "Beds" },
  { key: "baths", label: "Baths" },
  { key: "total_sqft", label: "Total sqft" },
  { key: "hoa", label: "HOA / mo" },
  { key: "year_built", label: "Year built" },
  { key: "commute_minutes", label: "Commute (min)" },
  { key: "safety_score", label: "Safety score (0-100)" },
];

export function PropertyDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { session } = useAuth();
  const [property, setProperty] = useState<Property | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [docType, setDocType] = useState(DOCUMENT_TYPES[0].value);
  const [uploading, setUploading] = useState(false);
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
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load property"));
  };

  useEffect(load, [session, id]);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    }
  };

  const handleVote = async (vote: Vote) => {
    if (!session) return;
    const res = await api.castVote(session.idToken, id, vote);
    setProperty((prev) => (prev ? { ...prev, votes: res.votes } : prev));
  };

  const handleArchive = async () => {
    if (!session) return;
    if (!confirm("Archive this property?")) return;
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
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (!property) {
    return (
      <div>
        <button onClick={onBack} className="text-sm text-gray-500 hover:underline">
          &larr; Back
        </button>
        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : <p className="mt-4 text-sm">Loading...</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button onClick={onBack} className="text-sm text-gray-500 hover:underline">
        &larr; Back to properties
      </button>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold">{property.address}</h1>
          <p className="text-sm text-gray-500">
            Score: {property.score !== null ? Math.round(property.score) : "--"}
            {property.extraction_status === "needs_review" && (
              <span className="ml-2 text-amber-600">needs review</span>
            )}
          </p>
        </div>
        {isOwner && (
          <button onClick={handleArchive} className="rounded border px-3 py-1 text-sm text-red-600">
            Archive
          </button>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {Object.keys(property.subscores).length > 0 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {Object.entries(property.subscores).map(([factor, score]) => (
            <span key={factor} className="rounded bg-gray-100 px-2 py-1">
              {factor}: {score}
            </span>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <VoteBadges votes={property.votes} />
        <VoteButtons currentVote={session ? property.votes?.[session.email] : undefined} onVote={handleVote} />
      </div>

      <form onSubmit={saveFields} className="space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {EDITABLE_FIELDS.map((f) => (
            <label key={f.key as string} className="text-sm">
              {f.label}
              <input
                type="number"
                value={fieldValues[f.key as string] ?? ""}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key as string]: e.target.value }))}
                disabled={!isOwner}
                className="mt-1 w-full rounded border px-2 py-1 disabled:bg-gray-50"
              />
            </label>
          ))}
        </div>
        <label className="block text-sm">
          Notes
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={!isOwner}
            className="mt-1 w-full rounded border px-2 py-1 disabled:bg-gray-50"
            rows={3}
          />
        </label>
        {isOwner && (
          <button type="submit" className="rounded bg-black px-4 py-2 text-sm text-white">
            Save
          </button>
        )}
      </form>

      {isOwner && (
        <form onSubmit={handleUpload} className="space-y-2 rounded border p-4">
          <h2 className="font-medium">Upload a document or photo</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded border px-2 py-1">
              <option value="photo">Photo</option>
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <input type="file" name="file" required className="text-sm" />
            <button type="submit" disabled={uploading} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-50">
              {uploading ? "Uploading..." : "Upload"}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Documents trigger extraction automatically. Photos are gallery-only, not scored.
          </p>
        </form>
      )}

      {property.photo_keys.length > 0 && (
        <div>
          <h2 className="mb-2 font-medium">Photos</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {property.photo_keys.map((key) =>
              photoUrls[key] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={key} src={photoUrls[key]} alt="" className="aspect-square rounded object-cover" />
              ) : (
                <div key={key} className="aspect-square animate-pulse rounded bg-gray-100" />
              )
            )}
          </div>
        </div>
      )}

      {(["extracted_mls", "extracted_gis", "extracted_detailed", "extracted_permit"] as const).map((field) =>
        property[field] ? (
          <div key={field}>
            <h2 className="mb-1 font-medium">{field.replace("extracted_", "").toUpperCase()} extraction</h2>
            <pre className="overflow-x-auto rounded bg-gray-50 p-3 text-xs">
              {JSON.stringify(property[field], null, 2)}
            </pre>
          </div>
        ) : null
      )}
    </div>
  );
}
