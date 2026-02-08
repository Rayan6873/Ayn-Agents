// scripts/agents/events_ingest_daily.mjs
import { base44Entity } from "../lib/base44.mjs";

/**
 * params example:
 * { source: "instagram", limit: 50, dry_run: false }
 */
export default async function eventsIngestDaily(params = {}) {
  const { source = "manual", limit = 50, dry_run = false } = params;

  // TODO: Replace with your real ingest source:
  // - scraping is not ideal; prefer approved APIs or manual import feeds
  // - or read from a "EventSource" table you populate yourself
  const eventSources = await base44Entity.list("EventSource"); // optional
  const incoming = (eventSources ?? []).slice(0, limit).map(mapSourceToEvent);

  let created = 0;

  for (const evt of incoming) {
    // Simple idempotency: unique key check before creating
    const existing = await base44Entity.filter("Event", { external_id: evt.external_id });
    if (existing?.length) continue;

    if (!dry_run) {
      await base44Entity.create("Event", evt);
      created += 1;
    } else {
      created += 1;
    }
  }

  return { agent: "events_ingest_daily", source, processed: incoming.length, created, dry_run };
}

function mapSourceToEvent(src) {
  return {
    title: src.title || "Untitled event",
    venue_id: src.venue_id,
    start_at: src.start_at,
    end_at: src.end_at,
    status: "active",
    external_id: src.external_id || src.id, // IMPORTANT: stable id for idempotency
    raw_json: src,
    created_at: new Date().toISOString(),
  };
}
