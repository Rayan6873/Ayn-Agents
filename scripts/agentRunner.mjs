/* scripts/agentRunner.mjs
 *
 * GitHub Actions runner entrypoint.
 * - Receives: run_id, agent_name, params_json
 * - Updates Base44 AgentRun state via Entities API (NO function invoke)
 * - Executes the agent implementation from ./agents/*.mjs
 */

import process from "process";
import { createClient } from '@base44/sdk';


// -------------------------
// Args + Env
// -------------------------
function getArg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const BASE44_API_URL = process.env.BASE44_API_URL;
const BASE44_API_KEY = process.env.BASE44_API_KEY;
const BASE44_APP_ID = process.env.BASE44_APP_ID;

if (!BASE44_API_URL || !BASE44_API_KEY || !BASE44_APP_ID) {
  console.error("Missing required env vars: BASE44_API_URL, BASE44_API_KEY, BASE44_APP_ID");
  process.exit(1);
}

const run_id = getArg("run_id");
const agent_name = getArg("agent_name");
const rawParams = getArg("params_json");

// GitHub sometimes passes empty string. Treat empty as {}
const params_json_raw = (rawParams && rawParams.trim().length > 0) ? rawParams : "{}";

if (!run_id || !agent_name) {
  console.error("Missing required args: --run_id, --agent_name");
  process.exit(1);
}

let params = {};
try {
  params = JSON.parse(params_json_raw);
} catch (e) {
  console.error("params_json is not valid JSON. Falling back to {}. Raw:", params_json_raw);
  params = {};
}

// -------------------------
// Base44 Entities API helper
// -------------------------
const base44 = createClient({
  apiUrl: BASE44_API_URL,
  serviceRoleKey: BASE44_API_KEY,
});

async function updateAgentRun(id, patch) {
  return base44.entities.AgentRun.update(id, patch);
}

async function createSystemAlert({ severity, message, agent_run_id }) {
  return base44.entities.SystemAlert.create({
    severity: severity || "critical",
    message,
    agent_run_id,
    status: "open",
  });
}

async function safeMarkFailed({ message, duration_ms }) {
  try {
    await updateAgentRun(run_id, {
      status: "failed",
      severity: "critical",
      error_message: message,
      duration_ms,
      finished_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Failed to mark AgentRun as failed:", e?.message || e);
  }

  try {
    await createSystemAlert({
      severity: "critical",
      message: `Agent failed: ${agent_name} — ${message}`,
      agent_run_id: run_id,
    });
  } catch (e) {
    console.error("Failed to create SystemAlert:", e?.message || e);
  }
}

// -------------------------
// Agent dispatch
// -------------------------
async function runAgent(agentName, params) {
  switch (agentName) {
    case "outreach_drafts_daily":
      return (await import("./agents/outreach_drafts_daily.mjs")).default(params);

    case "events_ingest_daily":
      return (await import("./agents/events_ingest_daily.mjs")).default(params);

    case "metrics_hourly":
      return (await import("./agents/metrics_hourly.mjs")).default(params);

    case "rollup_nightly":
      return (await import("./agents/rollup_nightly.mjs")).default(params);

    case "leads_generate_daily":
      return (await import("./agents/leads_generate_daily.mjs")).default(params);

    default:
      throw new Error(`Unknown agent_name "${agentName}" - add it in scripts/agentRunner.mjs`);
  }
}

// -------------------------
// Main
// -------------------------
(async () => {
  const started = Date.now();

  // 1) Mark running
  try {
    await updateAgentRun(run_id, {
      status: "running",
      severity: "info",
    });
  } catch (e) {
    // If we can't even mark running, fail early (otherwise you'll get "queued forever")
    const msg = e?.message || String(e);
    console.error("Cannot update AgentRun to running:", msg);
    await safeMarkFailed({ message: `Failed to mark running: ${msg}`, duration_ms: Date.now() - started });
    process.exit(1);
  }

  // 2) Execute agent
  try {
    const outputs = await runAgent(agent_name, params);

    // 3) Mark success
    await updateAgentRun(run_id, {
      status: "success",
      severity: "info",
      outputs_json: outputs ?? {},
      duration_ms: Date.now() - started,
      finished_at: new Date().toISOString(),
    });

    console.log("✅ Agent run success:", run_id, agent_name);
    process.exit(0);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error("❌ Agent run failed:", run_id, agent_name, msg);

    await safeMarkFailed({ message: msg, duration_ms: Date.now() - started });
    process.exit(1);
  }
})();
