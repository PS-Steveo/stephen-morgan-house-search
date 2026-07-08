"use client";

import { useEffect, useState, FormEvent } from "react";
import { api, Property, Vote } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { VoteBadges, VoteButtons } from "./VoteTiles";
import { ScoreBadge } from "./Score";

const STATUS_META: Record<Property["extraction_status"], { label: string; cls: string }> = {
  pending: { label: "No documents yet", cls: "bg-stone-100 text-stone-500" },
  complete: { label: "Details filled in", cls: "bg-green-100 text-green-700" },
  needs_review: { label: "Double-check details", cls: "bg-amber-100 text-amber-800" },
};

type SortKey = "score" | "price" | "newest";

function sortProperties(items: Property[], sort: SortKey) {
  const copy = [...items];
  if (sort === "price") {
    copy.sort((a, b) => (a.price == null) === (b.price == null) ? (a.price ?? 0) - (b.price ?? 0) : a.price == null ? 1 : -1);
  } else if (sort === "newest") {
    copy.sort((a, b) => Number(b.added_date) - Number(a.added_date));
  } else {
    copy.sort((a, b) => ((b.score ?? -1) - (a.score ?? -1)));
  }
  return copy;
}

function Thumbnail({ url, address }: { url: string | undefined; address: string }) {
  if (!url) {
    return (
      <div className="flex h-36 w-full items-center justify-center rounded-t-2xl bg-stone-100 text-4xl">
        🏠
      </div>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={address} className="h-36 w-full rounded-t-2xl object-cover" />;
}

export function PropertyList({ onSelect }: { onSelect: (id: string) => void }) {
  const { session } = useAuth();
  const [properties, setProperties] = useState<Property[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");
  const [showArchived, setShowArchived] = useState(false);
  const isOwner = session?.role === "owner";

  const load = () => {
    if (!session) return;
    setLoading(true);
    api
      .listProperties(session.idToken, showArchived ? "archived" : "active")
      .then((res) => setProperties(res.properties))
      .catch((err) => setError(err instanceof Error ? err.message : "Couldn't load your houses"))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [session, showArchived]);

  // First photo of each property as its card image, best-effort.
  useEffect(() => {
    if (!session) return;
    properties.forEach((p) => {
      const key = p.photo_keys?.[0];
      if (!key || thumbs[p.property_id]) return;
      api
        .getDownloadUrl(session.idToken, p.property_id, key)
        .then((res) => setThumbs((prev) => ({ ...prev, [p.property_id]: res.download_url })))
        .catch(() => {});
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties, session]);

  const handleVote = async (propertyId: string, vote: Vote) => {
    if (!session) return;
    try {
      const res = await api.castVote(session.idToken, propertyId, vote);
      setProperties((prev) =>
        prev.map((p) => (p.property_id === propertyId ? { ...p, votes: res.votes } : p))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your vote");
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !address.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await api.createProperty(session.idToken, address.trim());
      setAddress("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't add that house");
    } finally {
      setCreating(false);
    }
  };

  const sorted = sortProperties(properties, sort);

  return (
    <div className="space-y-5">
      {isOwner && !showArchived && (
        <form onSubmit={handleCreate} className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
          <label className="mb-1.5 block text-sm font-medium text-stone-700">
            Add a house you&apos;re considering
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              placeholder="Type the full address, e.g. 123 Main St, Indianapolis, IN"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="flex-1 rounded-lg border border-stone-300 px-3 py-2.5 text-sm focus:border-emerald-600 focus:outline-none"
            />
            <button
              type="submit"
              disabled={creating || !address.trim()}
              className="rounded-lg bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-40"
            >
              {creating ? "Adding..." : "Add house"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-stone-400">
            We&apos;ll find it on the map automatically. You can upload listing sheets and photos after.
          </p>
        </form>
      )}

      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-stone-500">
          <span>Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="score">Best match first</option>
            <option value="price">Lowest price first</option>
            <option value="newest">Recently added</option>
          </select>
        </div>
        <button
          onClick={() => setShowArchived((v) => !v)}
          className="text-sm text-stone-400 underline-offset-2 hover:text-stone-600 hover:underline"
        >
          {showArchived ? "← Back to current houses" : "See archived houses"}
        </button>
      </div>

      {loading && <p className="text-sm text-stone-400">Loading your houses...</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((p) => {
          const status = STATUS_META[p.extraction_status];
          return (
            <div
              key={p.property_id}
              className="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm transition hover:shadow-md"
            >
              <div onClick={() => onSelect(p.property_id)} className="cursor-pointer">
                <Thumbnail url={thumbs[p.property_id]} address={p.address} />
                <div className="flex items-start justify-between gap-3 p-4 pb-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-stone-900" title={p.address}>
                      {p.address}
                    </p>
                    <p className="mt-0.5 text-sm text-stone-500">
                      {p.price ? `$${p.price.toLocaleString()}` : "Price unknown"}
                      {p.beds ? ` · ${p.beds} bd` : ""}
                      {p.baths ? ` · ${p.baths} ba` : ""}
                      {p.total_sqft ? ` · ${p.total_sqft.toLocaleString()} sqft` : ""}
                    </p>
                    <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${status.cls}`}>
                      {status.label}
                    </span>
                  </div>
                  <ScoreBadge score={p.score} />
                </div>
              </div>
              <div className="space-y-2.5 border-t border-stone-100 p-4 pt-3">
                <VoteBadges votes={p.votes} />
                <VoteButtons
                  currentVote={session ? p.votes?.[session.email] : undefined}
                  onVote={(vote) => handleVote(p.property_id, vote)}
                />
              </div>
            </div>
          );
        })}
      </div>

      {!loading && sorted.length === 0 && (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white p-10 text-center">
          <p className="text-3xl">🏡</p>
          <p className="mt-2 font-medium text-stone-700">
            {showArchived ? "Nothing archived yet" : "No houses yet"}
          </p>
          {!showArchived && (
            <p className="mt-1 text-sm text-stone-500">
              {isOwner
                ? "Add the first address above to start comparing."
                : "Stephen and Morgan haven't added any houses yet."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
