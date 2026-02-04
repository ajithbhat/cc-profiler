import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import type { SessionData } from "../session/schema";

const require = createRequire(__filename);

function percentile(values: number[], p: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx];
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function loadChartJsUmd(): Promise<string> {
  const entry = require.resolve("chart.js");
  const entryDir = path.dirname(entry);
  const candidates = [
    path.join(entryDir, "chart.umd.js"),
    path.join(entryDir, "dist", "chart.umd.js"),
    path.join(path.dirname(entryDir), "dist", "chart.umd.js"),
  ];

  for (const p of candidates) {
    try {
      return await fs.readFile(p, "utf8");
    } catch {
      // try next
    }
  }

  throw new Error(`Unable to locate chart.js UMD bundle from entry ${entry}`);
}

export async function generateReportHtml(session: SessionData): Promise<string> {
  const chartJs = await loadChartJsUmd();

  const baselineT1 = typeof session.calibration?.t1Ms === "number" ? session.calibration.t1Ms : undefined;
  const baselineT2 = typeof session.calibration?.t2Ms === "number" ? session.calibration.t2Ms : undefined;

  const adjust = (value: number, baseline: number | undefined): number =>
    baseline == null ? value : Math.max(0, value - baseline);

  const turnT1 = session.interactions
    .filter((i) => i.kind === "turn" && typeof i.t1Ms === "number")
    .map((i) => i.t1Ms as number);
  const turnT2 = session.interactions
    .filter((i) => i.kind === "turn" && typeof i.t2Ms === "number")
    .map((i) => i.t2Ms as number);

  const turnT1Adj = turnT1.map((v) => adjust(v, baselineT1));
  const turnT2Adj = turnT2.map((v) => adjust(v, baselineT2));

  const summary = {
    turns: session.turns.length,
    durationMs:
      session.endedAtIso && session.startedAtIso
        ? Date.parse(session.endedAtIso) - Date.parse(session.startedAtIso)
        : undefined,
    calibration: session.calibration
      ? { t1Ms: session.calibration.t1Ms, t2Ms: session.calibration.t2Ms, burstIdleMs: session.calibration.burstIdleMs }
      : undefined,
    jsonl: session.jsonl?.samples?.length
      ? {
          activePathSha256: session.jsonl.activePathSha256,
          startBytes: session.jsonl.samples[0]?.sizeBytes,
          endBytes: session.jsonl.samples[session.jsonl.samples.length - 1]?.sizeBytes,
          growthBytes:
            (session.jsonl.samples[session.jsonl.samples.length - 1]?.sizeBytes ?? 0) -
            (session.jsonl.samples[0]?.sizeBytes ?? 0),
        }
      : undefined,
    turnT1Raw: { avg: mean(turnT1), p95: percentile(turnT1, 95) },
    turnT2Raw: { avg: mean(turnT2), p95: percentile(turnT2, 95) },
    turnT1Adjusted: { avg: mean(turnT1Adj), p95: percentile(turnT1Adj, 95) },
    turnT2Adjusted: { avg: mean(turnT2Adj), p95: percentile(turnT2Adj, 95) },
    peakRssBytes: session.samples.reduce((m, s) => Math.max(m, s.rssBytes ?? 0), 0) || undefined,
  };

  const env = session.environment;
  const mcpServers = env.claude?.mcpServers?.length ? env.claude.mcpServers.join(", ") : "(none found)";
  const plugins = env.claude?.plugins?.length ? env.claude.plugins.join(", ") : "(none found)";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>cc-profiler report</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; margin: 24px; color: #111; }
      .grid { display: grid; grid-template-columns: 1fr; gap: 16px; }
      @media (min-width: 1100px) { .grid { grid-template-columns: 1fr 1fr; } }
      .card { border: 1px solid #e5e7eb; border-radius: 10px; padding: 14px 16px; background: #fff; }
      h1 { margin: 0 0 8px; font-size: 22px; }
      h2 { margin: 0 0 10px; font-size: 16px; }
      pre { margin: 0; background: #0b1020; color: #e5e7eb; padding: 12px; border-radius: 10px; overflow: auto; }
      code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
      table { width: 100%; border-collapse: collapse; }
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5e7eb; font-size: 13px; vertical-align: top; }
      th { color: #374151; width: 220px; }
      .muted { color: #6b7280; font-size: 12px; }
      canvas { width: 100% !important; height: 320px !important; }
    </style>
  </head>
  <body>
    <h1>cc-profiler report</h1>
    <div class="muted">Schema v${session.schemaVersion} • Generated ${new Date().toISOString()}</div>

    <div class="grid" style="margin-top:16px">
      <div class="card">
        <h2>Summary</h2>
        <pre><code>${escapeHtml(JSON.stringify(summary, null, 2))}</code></pre>
      </div>
      <div class="card">
        <h2>Environment</h2>
        <table>
          <tr><th>OS</th><td>${escapeHtml(`${env.os.type} ${env.os.release}${env.os.version ? ` (${env.os.version})` : ""}`)}</td></tr>
          <tr><th>Node</th><td>${escapeHtml(env.nodeVersion)}</td></tr>
          <tr><th>Terminal</th><td>${escapeHtml(`${env.terminal.termProgram ?? ""} ${env.terminal.term ?? ""}`.trim() || "(unknown)")}</td></tr>
          <tr><th>Parent process</th><td>${escapeHtml(env.terminal.parentProcessName ?? "(unknown)")}</td></tr>
          <tr><th>CPU</th><td>${escapeHtml(env.machine.cpuModel ?? "(unknown)")} (${escapeHtml(String(env.machine.cpuCores ?? ""))} cores)</td></tr>
          <tr><th>Total RAM</th><td>${env.machine.totalMemBytes ? escapeHtml(formatBytes(env.machine.totalMemBytes)) : "(unknown)"}</td></tr>
          <tr><th>Claude version</th><td>${escapeHtml(env.claude?.versionText ?? "(not captured)")}</td></tr>
          <tr><th>MCP servers (names)</th><td>${escapeHtml(mcpServers)}</td></tr>
          <tr><th>Plugins (names)</th><td>${escapeHtml(plugins)}</td></tr>
          <tr><th>MCPs disabled</th><td>${escapeHtml(String(env.claude?.effectiveMcpsDisabled ?? false))}</td></tr>
        </table>
      </div>
      <div class="card">
        <h2>Observability (v1)</h2>
        <table>
          <tr><th>RSS</th><td>Recorded (cross-platform)</td></tr>
          <tr><th>CPU %</th><td>Recorded (cross-platform)</td></tr>
          <tr><th>Page faults</th><td>Recorded (Linux only)</td></tr>
          <tr><th>Context switches</th><td>Recorded (Linux only)</td></tr>
          <tr><th>File descriptors</th><td>Recorded (Linux only)</td></tr>
          <tr><th>Thread count</th><td>Recorded (Linux only)</td></tr>
          <tr><th>JS heap / GC timing</th><td>Not directly observable externally</td></tr>
          <tr><th>GC/stall inference</th><td>Not implemented in v1 (planned via correlation heuristics)</td></tr>
        </table>
      </div>
      <div class="card">
        <h2>RSS + CPU over time</h2>
        <canvas id="chart-rss-cpu"></canvas>
      </div>
      <div class="card">
        <h2>Turn latency (T2) over time</h2>
        <canvas id="chart-turn-t2-time"></canvas>
      </div>
      <div class="card">
        <h2>Turn latency (T2) vs turn index</h2>
        <canvas id="chart-turn-t2"></canvas>
      </div>
    </div>

    <script>
${chartJs}
    </script>
    <script id="session-data" type="application/json">${safeJsonForHtml(session)}</script>
    <script>
      const session = JSON.parse(document.getElementById('session-data').textContent);

      const samples = session.samples || [];
      const tSec = samples.map(s => (s.tMs || 0) / 1000);
      const rssMb = samples.map(s => (s.rssBytes || 0) / (1024 * 1024));
      const cpu = samples.map(s => s.cpuPercent ?? null);

      const ctx1 = document.getElementById('chart-rss-cpu').getContext('2d');
      new Chart(ctx1, {
        type: 'line',
        data: {
          labels: tSec,
          datasets: [
            { label: 'RSS (MB)', data: rssMb, borderColor: '#2563eb', yAxisID: 'y', pointRadius: 0, tension: 0.15 },
            { label: 'CPU (%)', data: cpu, borderColor: '#dc2626', yAxisID: 'y1', pointRadius: 0, tension: 0.15 },
          ],
        },
        options: {
          responsive: true,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { title: { display: true, text: 'Time (s)' } },
            y: { title: { display: true, text: 'RSS (MB)' } },
            y1: { title: { display: true, text: 'CPU (%)' }, position: 'right', grid: { drawOnChartArea: false } },
          }
        }
      });

      const baselineT2 = typeof session.calibration?.t2Ms === 'number' ? session.calibration.t2Ms : 0;
      const adjust = (v, base) => Math.max(0, v - base);

      const turnPoints = (session.interactions || [])
        .filter(i => i.kind === 'turn' && typeof i.turnIndex === 'number' && typeof i.t2Ms === 'number')
        .map(i => ({ x: i.turnIndex, y: adjust(i.t2Ms, baselineT2) }));

      const turnTime = (session.interactions || [])
        .filter(i => i.kind === 'turn' && typeof i.t0Ms === 'number' && typeof i.t2Ms === 'number')
        .map(i => ({ x: (i.t0Ms || 0) / 1000, y: adjust(i.t2Ms, baselineT2) }));

      const ctxTurnTime = document.getElementById('chart-turn-t2-time').getContext('2d');
      new Chart(ctxTurnTime, {
        type: 'line',
        data: {
          datasets: [{
            label: 'T2 adjusted (ms)',
            data: turnTime,
            parsing: false,
            borderColor: '#10b981',
            pointRadius: 2,
            tension: 0.15,
          }]
        },
        options: {
          responsive: true,
          scales: {
            x: { title: { display: true, text: 'Time (s)' } },
            y: { title: { display: true, text: 'T2 (ms)' } },
          }
        }
      });

      const ctxTurnIndex = document.getElementById('chart-turn-t2').getContext('2d');
      new Chart(ctxTurnIndex, {
        type: 'scatter',
        data: { datasets: [{ label: 'T2 adjusted (ms)', data: turnPoints, backgroundColor: '#10b981' }] },
        options: {
          responsive: true,
          scales: {
            x: { title: { display: true, text: 'Turn index' }, ticks: { precision: 0 } },
            y: { title: { display: true, text: 'T2 (ms)' } },
          }
        }
      });
    </script>
  </body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function safeJsonForHtml(value: unknown): string {
  // Prevent `</script>` injection and keep JSON parseable.
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
