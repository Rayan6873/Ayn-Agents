/* scripts/agents/leads_generate_daily.mjs */
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

function assertEnv() {
  if (!GOOGLE_PLACES_API_KEY) throw new Error("Missing env: GOOGLE_PLACES_API_KEY");
}

async function google(url) {
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok) throw new Error(`Google HTTP ${res.status}: ${JSON.stringify(json)}`);
  if (json.status && json.status !== "OK" && json.status !== "ZERO_RESULTS") {
    throw new Error(`Google Places error: ${json.status} ${json.error_message || ""}`.trim());
  }
  return json;
}

function pickBestCityResult(results = []) {
  // Prefer localities; fallback to first.
  return results[0] || null;
}

async function resolveCity({ city_query = "Dubai", country = "UAE" }) {
  const q = encodeURIComponent(`${city_query}, ${country}`);
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&key=${GOOGLE_PLACES_API_KEY}`;
  const json = await google(url);

  const place = pickBestCityResult(json.results);
  if (!place) throw new Error(`Could not resolve city from "${city_query}"`);

  return {
    resolved_city_name: place.name,
    resolved_city_address: place.formatted_address,
    lat: place.geometry?.location?.lat,
    lng: place.geometry?.location?.lng,
    place_id: place.place_id,
  };
}

async function nearbySearch({ lat, lng, radius_m, keyword }) {
  const loc = `${lat},${lng}`;
  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${loc}&radius=${radius_m}&keyword=${encodeURIComponent(keyword)}&key=${GOOGLE_PLACES_API_KEY}`;
  return google(url);
}

async function placeDetails(place_id) {
  const fields = [
    "place_id","name","formatted_address","geometry","rating","user_ratings_total",
    "international_phone_number","website","types"
  ].join(",");
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place_id}&fields=${fields}&key=${GOOGLE_PLACES_API_KEY}`;
  const json = await google(url);
  return json.result || null;
}

function bucketFromKeyword(bucketKey) {
  switch (bucketKey) {
    case "restaurant": return "restaurant";
    case "fine_dining": return "fine_dining";
    case "shisha": return "shisha";
    case "beach_club": return "beach_club";
    case "other_food": return "other_food";
    default: return "other_food";
  }
}

// Simple Phase-1 scoring (fast + works). You can upgrade later.
function scoreLead({ rating = 0, reviews = 0, bucket }) {
  const r = Math.min(Math.max(rating, 0), 5);        // 0-5
  const rv = Math.min(reviews, 5000);               // cap
  const ratingScore = (r / 5) * 60;                 // up to 60
  const reviewsScore = Math.log10(rv + 1) / Math.log10(5000 + 1) * 30; // up to 30
  const bucketBoost = (bucket === "fine_dining") ? 10 : 0;            // +10
  return Math.round(Math.min(100, ratingScore + reviewsScore + bucketBoost));
}

async function upsertLead(base44, lead) {
  // You said Lead has place_id unique. We’ll upsert by filter then create/update.
  const existing = await base44.entities.Lead.filter({ place_id: lead.place_id });
  const hit = Array.isArray(existing) ? existing[0] : null;

  if (hit?.id) {
    // Don’t overwrite outreach status if it’s already being worked
    const safeUpdate = { ...lead };
    delete safeUpdate.outreach_status;
    return base44.entities.Lead.update(hit.id, safeUpdate);
  }
  return base44.entities.Lead.create(lead);
}

export default async function leads_generate_daily(params = {}) {
  assertEnv();

  const {
    country = "UAE",
    city_query = "Dubai",
    radius_m = 25000,
    min_rating = 4.0,
    limits = {
      restaurant: 10,
      fine_dining: 5,
      shisha: 5,
      beach_club: 5,
      other_food: 5,
    },
  } = params;

  // base44 client should be provided by your agentRunner import context OR you can pass in
  // But in your pattern, agent files only return outputs. So we call Base44 via REST inside agentRunner,
  // OR we keep agents pure and do Base44 writes via helper.
  // Easiest: use Base44 REST directly here (same as agentRunner invokeBase44).
  const BASE44_API_URL = process.env.BASE44_API_URL;
  const BASE44_API_KEY = process.env.BASE44_API_KEY;
  const BASE44_APP_ID  = process.env.BASE44_APP_ID;

  if (!BASE44_API_URL || !BASE44_API_KEY || !BASE44_APP_ID) {
    throw new Error("Missing Base44 env vars in runner: BASE44_API_URL, BASE44_API_KEY, BASE44_APP_ID");
  }

  async function base44Req(path, body) {
    const url = `${BASE44_API_URL}/apps/${BASE44_APP_ID}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${BASE44_API_KEY}` },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Base44 API failed ${res.status}: ${text}`);
    return JSON.parse(text);
  }

  const base44 = {
    entities: {
      Lead: {
        filter: (where) => base44Req(`/entities/Lead/filter`, where),
        create: (data) => base44Req(`/entities/Lead/create`, data),
        update: (id, data) => base44Req(`/entities/Lead/update`, { id, data }),
      }
    }
  };

  const city = await resolveCity({ city_query, country });
  if (!city.lat || !city.lng) throw new Error(`City resolved but missing lat/lng: ${JSON.stringify(city)}`);

  const bucketQueries = [
    { key: "restaurant",  keyword: "restaurant" },
    { key: "fine_dining", keyword: "fine dining restaurant" },
    { key: "shisha",      keyword: "shisha lounge" },
    { key: "beach_club",  keyword: "beach club" },
    { key: "other_food",  keyword: "cafe" }, // wide net
  ];

  const created = [];
  const skippedLowRating = [];
  const seenPlaceIds = new Set();

  for (const b of bucketQueries) {
    const limit = limits[b.key] || 0;
    if (!limit) continue;

    // Pull more than needed, then filter + dedupe
    const nearby = await nearbySearch({ lat: city.lat, lng: city.lng, radius_m, keyword: b.keyword });
    const candidates = (nearby.results || []).slice(0, Math.max(15, limit * 3));

    let taken = 0;
    for (const c of candidates) {
      if (taken >= limit) break;
      const pid = c.place_id;
      if (!pid || seenPlaceIds.has(pid)) continue;
      seenPlaceIds.add(pid);

      const details = await placeDetails(pid);
      if (!details) continue;

      const rating = details.rating ?? 0;
      const reviews = details.user_ratings_total ?? 0;
      if (rating < min_rating) {
        skippedLowRating.push({ place_id: pid, name: details.name, rating });
        continue;
      }

      const bucket = bucketFromKeyword(b.key);
      const lead_score = scoreLead({ rating, reviews, bucket });

      const lead = {
        place_id: details.place_id,
        name: details.name,
        country,
        city: city.resolved_city_name,
        area: null,
        category_bucket: bucket,
        google_rating: rating,
        google_reviews: reviews,
        address: details.formatted_address,
        lat: details.geometry?.location?.lat,
        lng: details.geometry?.location?.lng,
        phone: details.international_phone_number || null,
        website: details.website || null,
        instagram_handle: null, // Phase 2: enrich from website/knowledge panel
        tech_stack: null,
        lead_score,
        outreach_status: "new",
        outreach_attempts: 0,
      };

      await upsertLead(base44, lead);
      created.push({ place_id: lead.place_id, name: lead.name, bucket, lead_score });
      taken++;
    }
  }

  return {
    resolved_city: city,
    totals: {
      created_or_updated: created.length,
      skipped_low_rating: skippedLowRating.length,
    },
    sample: created.slice(0, 10),
  };
}
