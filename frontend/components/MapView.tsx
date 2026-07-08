"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";

const FALLBACK_CENTER: [number, number] = [-86.15, 39.77]; // Indianapolis area

function scoreColor(score: number | null) {
  if (score === null) return "#6b7280";
  if (score >= 75) return "#16a34a";
  if (score >= 50) return "#d97706";
  return "#dc2626";
}

export function MapView({ onSelect }: { onSelect: (id: string) => void }) {
  const { session } = useAuth();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unlocatedCount, setUnlocatedCount] = useState(0);

  useEffect(() => {
    if (!session || !containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        const [{ api_key, region }, { properties }] = await Promise.all([
          api.getMapsKey(session.idToken),
          api.listProperties(session.idToken),
        ]);
        if (cancelled || !containerRef.current) return;

        const styleUrl = `https://maps.geo.${region}.amazonaws.com/v2/styles/Satellite/descriptor?key=${api_key}`;
        const map = new maplibregl.Map({
          container: containerRef.current,
          style: styleUrl,
          center: FALLBACK_CENTER,
          zoom: 10,
        });
        map.addControl(new maplibregl.NavigationControl(), "top-right");
        mapRef.current = map;

        const located = properties.filter((p) => p.lat != null && p.lng != null);
        setUnlocatedCount(properties.length - located.length);

        if (located.length > 0) {
          const bounds = new maplibregl.LngLatBounds();
          located.forEach((p) => {
            const popupNode = document.createElement("div");
            const title = document.createElement("strong");
            title.textContent = p.address;
            const scoreLine = document.createElement("div");
            scoreLine.className = "text-sm";
            scoreLine.textContent = `Score: ${p.score !== null ? Math.round(p.score) : "--"}`;
            const viewBtn = document.createElement("button");
            viewBtn.textContent = "View details";
            viewBtn.className = "mt-1 text-sm text-blue-600 underline";
            viewBtn.onclick = () => onSelect(p.property_id);
            popupNode.append(title, scoreLine, viewBtn);

            new maplibregl.Marker({ color: scoreColor(p.score) })
              .setLngLat([p.lng!, p.lat!])
              .setPopup(new maplibregl.Popup({ offset: 24 }).setDOMContent(popupNode))
              .addTo(map);
            bounds.extend([p.lng!, p.lat!]);
          });
          map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load map");
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [session, onSelect]);

  return (
    <div className="space-y-2">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <p className="text-sm text-stone-500">
        Every house you&apos;re considering, on satellite view. Pin colors match the score — green is a
        great match. Tap a pin for details.
        {unlocatedCount > 0 &&
          ` (${unlocatedCount} house${unlocatedCount === 1 ? "" : "s"} couldn't be placed on the map.)`}
      </p>
      <div ref={containerRef} className="h-[70vh] w-full overflow-hidden rounded-2xl border border-stone-200 shadow-sm" />
    </div>
  );
}
