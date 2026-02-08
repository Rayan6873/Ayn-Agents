// scripts/lib/base44.mjs
import process from "process";

const BASE44_API_URL = process.env.BASE44_API_URL;
const BASE44_API_KEY = process.env.BASE44_API_KEY;
const BASE44_APP_ID = process.env.BASE44_APP_ID;

function requireEnv() {
  if (!BASE44_API_URL || !BASE44_API_KEY || !BASE44_APP_ID) {
    throw new Error(
      "Missing required env vars: BASE44_API_URL, BASE44_API_KEY, BASE44_APP_ID"
    );
  }
}

export async function invokeFunction(fnName, payload) {
  requireEnv();
  const url = `${BASE44_API_URL}/apps/${BASE44_APP_ID}/functions/${fnName}/invoke`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BASE44_API_KEY}`,
    },
    body: JSON.stringify(payload ?? {}),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Base44 function ${fnName} failed: ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

// Generic entity helpers (works if your Base44 API supports these endpoints)
// If your Base44 entity REST paths differ, tell me the exact shape and I’ll adjust.
async function request(path, { method = "GET", body } = {}) {
  requireEnv();
  const url = `${BASE44_API_URL}/apps/${BASE44_APP_ID}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${BASE44_API_KEY}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Base44 request failed: ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

export const base44Entity = {
  list: (entityName) => request(`/entities/${entityName}/list`),
  filter: (entityName, where = {}) =>
    request(`/entities/${entityName}/filter`, { method: "POST", body: where }),
  create: (entityName, data) =>
    request(`/entities/${entityName}/create`, { method: "POST", body: data }),
  update: (entityName, id, data) =>
    request(`/entities/${entityName}/${id}/update`, { method: "POST", body: data }),
};
