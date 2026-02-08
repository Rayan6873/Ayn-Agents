// scripts/agents/outreach_drafts_daily.mjs
import { base44Entity, invokeFunction } from "../lib/base44.mjs";

/**
 * Expected params (example):
 * {
 *   min_score: 70,
 *   limit: 15,
 *   channel: "instagram",
 *   tone: "premium",
 *   dry_run: false
 * }
 */
export default async function outreachDraftsDaily(params = {}) {
  const {
    min_score = 70,
    limit = 15,
    channel = "instagram",
    tone = "premium",
    dry_run = false,
  } = params;

  // 1) Pull leads to contact
  // Adjust entity names/fields to YOUR schema (Lead, Venue, OutreachDraft etc.)
  // If your Base44 function already had the exact filter logic, paste it here.
  const leads = await base44Entity.filter("Lead", {
    score: { gte: min_score },
    contacted_today: { neq: true },
    status: { in: ["new", "open"] },
  });

  const picked = (leads ?? []).slice(0, limit);

  // 2) Generate DM drafts
  // You likely already had prompt logic in Base44. Use that same prompt here.
  // Two options:
  //   - Call a Base44 AI function you already built (recommended if it exists)
  //   - Or generate text here (if your runner has access to an LLM)
  //
  // If you already have Base44 function like "generateOutreachDraft",
  // you can call it like this:
  //
  // const draft = await invokeFunction("generateOutreachDraft", { lead, channel, tone });

  const createdDrafts = [];

  for (const lead of picked) {
    const draftText = await buildDraftLocal(lead, { channel, tone });

    const draftRecord = {
      lead_id: lead.id,
      channel,
      tone,
      message: draftText,
      status: "draft",
      created_at: new Date().toISOString(),
    };

    if (!dry_run) {
      const created = await base44Entity.create("OutreachDraft", draftRecord);
      createdDrafts.push(created);
    } else {
      createdDrafts.push(draftRecord);
    }

    // Mark lead as "contacted today" so we don't spam
    if (!dry_run) {
      await base44Entity.update("Lead", lead.id, { contacted_today: true });
    }
  }

  return {
    agent: "outreach_drafts_daily",
    picked: picked.length,
    created: createdDrafts.length,
    dry_run,
  };
}

// Replace this with the exact logic you had in your Base44 function.
function buildDraftLocal(lead, { channel, tone }) {
  const name = lead?.contact_name || "there";
  const venue = lead?.venue_name || "your venue";

  // Keep it short and pasteable
  if (tone === "premium") {
    return `Hi ${name} — quick one. We help venues like ${venue} turn Instagram interest into booked tables with a premium “pick-your-spot” booking experience. If I send a 30-sec demo, would you be open to a chat this week?`;
  }

  return `Hey ${name}! I saw ${venue} and wanted to share a quick way we’re helping venues get more bookings from IG/WhatsApp. Want a 30-sec demo?`;
}
