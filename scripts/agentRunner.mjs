/* scripts/agentRunner.mjs */
import process from "process";

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
const raw = getArg("params_json");
const params_json_raw = (raw && raw.trim().length > 0) ? raw : "{}";

if (!run_id || !agent_name) {
  console.error("Missing required args: --run_id, --agent_name");
  process.exit(1);
}

let params = {};
try { params = JSON.parse(params_json_raw); } catch { params = {}; }

async function invokeBase44(fnName, payload) {
  const base = String(process.env.BASE44_API_URL || "").replace(/\/$/, "");
  // Base44 callable functions are here:
  const url = `${base}/functions/${fnName}`;

  console.log("invokeBase44 →", fnName, url); // keep this until everything works

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.BASE44_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Base44 ${fnName} failed: ${res.status} ${text}`);
  try { return JSON.parse(text); } catch { return text; }
}



/**
 * Map agent_name -> real agent implementation in THIS repo.
 * Keep agent implementations in /agents/* or similar.
 */
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
(async () => {
  const started = Date.now();

  // Mark running (idempotent server-side update)
  await invokeBase44("agentRunUpdate", {
    run_id,
    status: "running",
    severity: "info",
  });

  try {
    const outputs = await runAgent(agent_name, params);

    await invokeBase44("agentRunUpdate", {
      run_id,
      status: "success",
      outputs_json: outputs ?? {},
      duration_ms: Date.now() - started,
      severity: "info",
    });

    console.log("✅ Agent run success:", run_id, agent_name);
  } catch (err) {
    const msg = err?.message || String(err);

    await invokeBase44("agentRunUpdate", {
      run_id,
      status: "failed",
      error_message: msg,
      duration_ms: Date.now() - started,
      severity: "critical",
    });

    console.error("❌ Agent run failed:", run_id, agent_name, msg);
    process.exit(1);
  }
})();
