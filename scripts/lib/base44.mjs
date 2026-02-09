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
      "api_key": BASE44_API_KEY,
    },
    body: JSON.stringify(payload ?? {}),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Base44 function ${fnName} failed: ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

// Generic entity helpers using Base44's actual API format:
// GET /api/apps/{appId}/entities/{EntityName} - list all
// GET /api/apps/{appId}/entities/{EntityName}/{id} - get one
// POST /api/apps/{appId}/entities/{EntityName} - create
// PUT /api/apps/{appId}/entities/{EntityName}/{id} - update
// DELETE /api/apps/{appId}/entities/{EntityName}/{id} - delete

async function request(path, { method = "GET", body } = {}) {
  requireEnv();
  const url = `${BASE44_API_URL}/apps/${BASE44_APP_ID}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "api_key": BASE44_API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Base44 request failed: ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}

export const base44Entity = {
  // List all entities of a type
  list: (entityName) => request(`/entities/${entityName}`),
  
  // Get a single entity by ID
  get: (entityName, id) => request(`/entities/${entityName}/${id}`),
  
  // Filter entities - Note: Base44 might not support this endpoint
  // If filtering is not supported, you'll need to list all and filter client-side
  // or use a custom function
  filter: async (entityName, where = {}) => {
    // Try the filter endpoint first
    try {
      return await request(`/entities/${entityName}/filter`, { method: "POST", body: where });
    } catch (e) {
      // If filter endpoint doesn't exist, fall back to listing all and filtering client-side
      console.warn(`Filter endpoint not available for ${entityName}, falling back to client-side filtering`);
      const all = await request(`/entities/${entityName}`);
      // Simple client-side filtering (you may need to enhance this based on your needs)
      if (!where || Object.keys(where).length === 0) return all;
      return (all || []).filter(item => {
        return Object.entries(where).every(([key, condition]) => {
          if (typeof condition === 'object' && condition !== null) {
            // Handle operators like { gte: value }
            if ('gte' in condition) return item[key] >= condition.gte;
            if ('lte' in condition) return item[key] <= condition.lte;
            if ('gt' in condition) return item[key] > condition.gt;
            if ('lt' in condition) return item[key] < condition.lt;
            if ('eq' in condition) return item[key] === condition.eq;
            return false;
          }
          return item[key] === condition;
        });
      });
    }
  },
  
  // Create a new entity
  create: (entityName, data) =>
    request(`/entities/${entityName}`, { method: "POST", body: data }),
  
  // Update an existing entity by ID (uses PUT method)
  update: (entityName, id, data) =>
    request(`/entities/${entityName}/${id}`, { method: "PUT", body: data }),
  
  // Delete an entity by ID
  delete: (entityName, id) =>
    request(`/entities/${entityName}/${id}`, { method: "DELETE" }),
};
