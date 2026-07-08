import { config } from "./config";

export interface Property {
  property_id: string;
  status: "active" | "archived";
  added_date: string;
  address: string;
  notes?: string;
  price?: number;
  beds?: number;
  baths?: number;
  total_sqft?: number;
  hoa?: number;
  year_built?: number;
  price_per_sqft?: number;
  commute_minutes?: number;
  safety_score?: number;
  extracted_mls?: Record<string, unknown>;
  extracted_gis?: Record<string, unknown>;
  extracted_detailed?: Record<string, unknown>;
  extracted_permit?: Record<string, unknown>;
  extraction_status: "pending" | "complete" | "needs_review";
  photo_keys: string[];
  score: number | null;
  subscores: Record<string, number>;
  lat?: number;
  lng?: number;
  votes: Record<string, Vote>;
}

export type Vote = "yes" | "maybe" | "no" | "more_info";

export interface Bounds {
  [factor: string]: { best: number; worst: number };
}

export interface WeightsConfig {
  config_id: string;
  weights: Record<string, number>;
  bounds: Bounds;
}

export interface Location {
  location_id: string;
  label: string;
  address: string;
  lat?: number;
  lng?: number;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiFetch<T>(
  idToken: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
      ...options.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? `request failed: ${res.status}`);
  }
  return body as T;
}

export const api = {
  listProperties: (idToken: string, status: "active" | "archived" = "active") =>
    apiFetch<{ properties: Property[]; count: number }>(idToken, `/properties?status=${status}`),

  createProperty: (idToken: string, address: string, notes?: string) =>
    apiFetch<Property>(idToken, "/properties", {
      method: "POST",
      body: JSON.stringify({ address, notes }),
    }),

  getProperty: (idToken: string, id: string) =>
    apiFetch<Property>(idToken, `/properties/${id}`),

  updateProperty: (idToken: string, id: string, updates: Partial<Property>) =>
    apiFetch<Property>(idToken, `/properties/${id}`, {
      method: "PATCH",
      body: JSON.stringify(updates),
    }),

  archiveProperty: (idToken: string, id: string) =>
    apiFetch<{ property_id: string; status: string }>(idToken, `/properties/${id}`, {
      method: "DELETE",
    }),

  getUploadUrl: (idToken: string, propertyId: string, fileType: string, fileName: string, contentType: string) =>
    apiFetch<{ upload_url: string; key: string }>(idToken, `/properties/${propertyId}/files`, {
      method: "POST",
      body: JSON.stringify({ file_type: fileType, file_name: fileName, content_type: contentType }),
    }),

  getDownloadUrl: (idToken: string, propertyId: string, key: string) =>
    apiFetch<{ download_url: string }>(
      idToken,
      `/properties/${propertyId}/files?key=${encodeURIComponent(key)}`
    ),

  uploadFile: async (uploadUrl: string, file: File) => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!res.ok) throw new ApiError(res.status, "upload failed");
  },

  extract: (idToken: string, propertyId: string, fileType: string, key: string) =>
    apiFetch<{ needs_review: boolean; fields: Record<string, unknown>; low_confidence: string[] }>(
      idToken,
      `/properties/${propertyId}/extract`,
      { method: "POST", body: JSON.stringify({ file_type: fileType, key }) }
    ),

  listLocations: (idToken: string) =>
    apiFetch<{ locations: Location[] }>(idToken, "/locations"),

  createLocation: (idToken: string, label: string, address: string) =>
    apiFetch<Location>(idToken, "/locations", {
      method: "POST",
      body: JSON.stringify({ label, address }),
    }),

  deleteLocation: (idToken: string, id: string) =>
    apiFetch<{ location_id: string; deleted: boolean }>(idToken, `/locations/${id}`, {
      method: "DELETE",
    }),

  getWeights: (idToken: string) => apiFetch<WeightsConfig>(idToken, "/weights"),

  putWeights: (idToken: string, patch: Partial<WeightsConfig>) =>
    apiFetch<WeightsConfig>(idToken, "/weights", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  castVote: (idToken: string, propertyId: string, vote: Vote) =>
    apiFetch<{ property_id: string; votes: Record<string, Vote> }>(
      idToken,
      `/properties/${propertyId}/vote`,
      { method: "PUT", body: JSON.stringify({ vote }) }
    ),

  getMapsKey: (idToken: string) =>
    apiFetch<{ api_key: string; region: string }>(idToken, "/maps-key"),
};
