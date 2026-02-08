// scripts/agents/metrics_hourly.mjs
import { base44Entity } from "../lib/base44.mjs";

/**
 * params example:
 * { window_minutes: 60, dry_run: false }
 */
export default async function metricsHourly(params = {}) {
  const { window_minutes = 60, dry_run = false } = params;

  const since = new Date(Date.now() - window_minutes * 60 * 1000).toISOString();

  // Example: compute counts for the last window
  const runs = await base44Entity.filter("AgentRun", { started_at: { gte: since } });
  const alerts = await base44Entity.filter("SystemAlert", { created_date: { gte: since } });

  const summary = {
    window_minutes,
    runs_total: runs?.length ?? 0,
    runs_failed: (runs ?? []).filter(r => r.status === "failed").length,
    alerts_total: alerts?.length ?? 0,
    alerts_critical: (alerts ?? []).filter(a => a.severity === "critical").length,
    computed_at: new Date().toISOString(),
  };

  if (!dry_run) {
    await base44Entity.create("MetricSnapshot", summary); // ensure this entity exists or rename
  }

  return { agent: "metrics_hourly", summary, dry_run };
}
