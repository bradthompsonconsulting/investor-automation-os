/**
 * IAOS GHL Service Module — single entry point for all GHL data access.
 *
 * Phase A (current): every call proxies through a server-side Netlify function
 * that holds GHL_API_TOKEN. The browser never sees the key.
 *
 * Phase B (OAuth): replace the `request` function implementation only.
 * All callers stay the same — pages import from this module, never from GHL directly.
 *
 * Write methods are stubbed with comments so pages can call them
 * without refactoring once implemented.
 */

const LOCATION_ID = "jmHG4B8RdzwpfqruNf68";
const PROXY       = "/.netlify/functions/ghl-proxy";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ContactRow {
  id:              string;
  firstName:       string;
  lastName:        string;
  phone:           string;
  email:           string;
  dateAdded:       string | null;
  motivationScore: number | null;
  dealScore:       number | null;
  combinedScore:   number | null;
}

// ── Transport (swap this block for OAuth in Phase B) ─────────────────────────

async function request<T = unknown>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${PROXY}?path=${encodeURIComponent(path)}`, {
    method,
    headers: body != null ? { "Content-Type": "application/json" } : {},
    body: body != null ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ── Public API ────────────────────────────────────────────────────────────────

export const ghl = {
  contacts: {
    // Returns all contacts with scores, paged server-side
    listAll: async (): Promise<ContactRow[]> => {
      const res = await fetch("/.netlify/functions/ghl-contacts");
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ghl-contacts → ${res.status}: ${text}`);
      }
      return res.json() as Promise<ContactRow[]>;
    },
    list: (params?: Record<string, string>) => {
      const qs = new URLSearchParams({ locationId: LOCATION_ID, limit: "25", ...params }).toString();
      return request<any>(`/contacts?${qs}`);
    },
    get: (id: string) => request<any>(`/contacts/${id}`),
    // update: (id: string, data: unknown) => request(`/contacts/${id}`, "PUT", data),
  },

  customFields: {
    list: () => request<any>(`/locations/${LOCATION_ID}/customFields`),
  },

  pipelines: {
    list: () => request<any>(`/opportunities/pipelines?locationId=${LOCATION_ID}`),
  },

  opportunities: {
    list: (params?: Record<string, string>) => {
      const qs = new URLSearchParams({ location_id: LOCATION_ID, ...params }).toString();
      return request<any>(`/opportunities/search?${qs}`);
    },
    get: (id: string) => request<any>(`/opportunities/${id}`),
    // create: (data: unknown) => request("/opportunities/", "POST", data),
    // update: (id: string, data: unknown) => request(`/opportunities/${id}`, "PUT", data),
  },
};

