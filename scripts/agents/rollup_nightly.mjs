// scripts/agents/rollup_nightly.mjs
import { base44Entity } from "../lib/base44.mjs";

/**
 * params example:
 * { days: 7, dry_run: false }
 */
export default async function rollupNightly(params = {}) {
  const { days = 7, dry_run = false } = params;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Example: roll up drafts created in the last N days
  const drafts = await base44Entity.filter("OutreachDraft", { created_at: { gte: since } });

  const rollup = {
    range_days: days,
    outreach_drafts_created: drafts?.length ?? 0,
    by_channel: groupCount(drafts ?? [], d => d.channel || "unknown"),
    computed_at: new Date().toISOString(),
  };

  if (!dry_run) {
    await base44Entity.create("RollupSnapshot", rollup); // ensure entity exists or rename
  }

  return { agent: "rollup_nightly", rollup, dry_run };
}

function groupCount(items, keyFn) {
  const out = {};
  for (const item of items) {
    const k = keyFn(item);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
