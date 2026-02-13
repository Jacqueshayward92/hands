import { html, nothing } from "lit";
import type { GatewayEventFrame } from "../gateway.ts";
import { formatAgo, formatDurationMs } from "../format.ts";

export type ActivityEntry = {
  id: string;
  ts: number;
  type: "agent" | "cron" | "heartbeat" | "tool" | "worker" | "error";
  source?: string; // agent id, worker id, job id, etc.
  event: string;
  details?: string;
  status?: "pending" | "running" | "success" | "error" | "warning";
  data?: unknown;
};

export type ActivityProps = {
  loading: boolean;
  entries: ActivityEntry[];
  agentStatus: {
    main: "idle" | "thinking" | "tool" | "error";
    workers: { idle: number; active: number; total: number };
  } | null;
  cronStatus: {
    lastRun: number | null;
    nextRun: number | null;
    running: number;
  } | null;
  heartbeatStatus: {
    lastCheck: number | null;
    results: string[];
  } | null;
  resources: {
    tokenRate?: number; // tokens/sec
    queueSize?: number;
  } | null;
  onRefresh: () => void;
  onClear: () => void;
};

function renderActivityIcon(type: string, status?: string) {
  const statusIcon = (() => {
    if (status === "running") return "⏳";
    if (status === "success") return "✅";
    if (status === "error") return "❌";
    if (status === "warning") return "⚠️";
    if (status === "pending") return "🔄";
    return "•";
  })();

  const typeIcon = (() => {
    switch (type) {
      case "agent":
        return "🤖";
      case "cron":
        return "⏰";
      case "heartbeat":
        return "💓";
      case "tool":
        return "🔧";
      case "worker":
        return "👷";
      case "error":
        return "🚨";
      default:
        return "📝";
    }
  })();

  return `${typeIcon} ${statusIcon}`;
}

function renderAgentStatusCard(props: ActivityProps) {
  const status = props.agentStatus;
  if (!status) {
    return html`
      <div class="card">
        <div class="card-title">Agent Status</div>
        <div class="card-sub">Main agent and worker pool activity.</div>
        <div class="muted" style="margin-top: 12px;">Loading...</div>
      </div>
    `;
  }

  const mainStatus = {
    idle: "bg-green-100 text-green-700",
    thinking: "bg-blue-100 text-blue-700",
    tool: "bg-yellow-100 text-yellow-700",
    error: "bg-red-100 text-red-700",
  }[status.main];

  const mainLabel = {
    idle: "Idle",
    thinking: "Thinking",
    tool: "Executing tool",
    error: "Error",
  }[status.main];

  return html`
    <div class="card">
      <div class="card-title">Agent Status</div>
      <div class="card-sub">Main agent and worker pool activity.</div>
      <div class="grid grid-cols-2" style="margin-top: 16px;">
        <div>
          <div class="muted">Main Agent</div>
          <div style="margin-top: 6px;">
            <span class="badge ${mainStatus}" style="padding: 4px 8px; border-radius: 4px;">
              ${mainLabel}
            </span>
          </div>
        </div>
        <div>
          <div class="muted">Worker Pool</div>
          <div style="margin-top: 6px;">
            <div>
              ${status.workers.active} / ${status.workers.total} active
            </div>
            <div class="muted" style="font-size: 12px;">
              ${status.workers.idle} idle
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCronStatusCard(props: ActivityProps) {
  const status = props.cronStatus;
  if (!status) {
    return html`
      <div class="card">
        <div class="card-title">Cron Jobs</div>
        <div class="card-sub">Scheduled task execution.</div>
        <div class="muted" style="margin-top: 12px;">Loading...</div>
      </div>
    `;
  }

  return html`
    <div class="card">
      <div class="card-title">Cron Jobs</div>
      <div class="card-sub">Scheduled task execution.</div>
      <div class="stat-grid" style="margin-top: 16px;">
        <div class="stat">
          <div class="stat-label">Last Run</div>
          <div class="stat-value">
            ${status.lastRun ? formatAgo(new Date(status.lastRun)) : "Never"}
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">Next Run</div>
          <div class="stat-value">
            ${status.nextRun
              ? new Date(status.nextRun).toLocaleTimeString()
              : "No jobs"}
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">Running</div>
          <div class="stat-value">${status.running}</div>
        </div>
      </div>
    </div>
  `;
}

function renderHeartbeatStatusCard(props: ActivityProps) {
  const status = props.heartbeatStatus;
  if (!status) {
    return html`
      <div class="card">
        <div class="card-title">Heartbeat</div>
        <div class="card-sub">Periodic automated checks.</div>
        <div class="muted" style="margin-top: 12px;">Loading...</div>
      </div>
    `;
  }

  return html`
    <div class="card">
      <div class="card-title">Heartbeat</div>
      <div class="card-sub">Periodic automated checks.</div>
      <div style="margin-top: 16px;">
        <div class="muted">Last Check</div>
        <div>
          ${status.lastCheck
            ? `${new Date(status.lastCheck).toLocaleTimeString()} (${formatAgo(
                new Date(status.lastCheck),
              )})`
            : "Never"}
        </div>
      </div>
      ${
        status.results.length > 0
          ? html`
              <div style="margin-top: 12px;">
                <div class="muted">Recent Results</div>
                <div class="stack" style="margin-top: 6px;">
                  ${status.results.slice(0, 3).map(
                    (result) => html`
                      <div class="muted" style="font-size: 13px;">
                        • ${result}
                      </div>
                    `,
                  )}
                </div>
              </div>
            `
          : nothing
      }
    </div>
  `;
}

function renderResourcesCard(props: ActivityProps) {
  const resources = props.resources;
  if (!resources) {
    return html`
      <div class="card">
        <div class="card-title">Resources</div>
        <div class="card-sub">Token usage and queue status.</div>
        <div class="muted" style="margin-top: 12px;">Loading...</div>
      </div>
    `;
  }

  return html`
    <div class="card">
      <div class="card-title">Resources</div>
      <div class="card-sub">Token usage and queue status.</div>
      <div class="stat-grid" style="margin-top: 16px;">
        <div class="stat">
          <div class="stat-label">Token Rate</div>
          <div class="stat-value">
            ${resources.tokenRate !== undefined
              ? `${resources.tokenRate.toFixed(1)} tok/s`
              : "N/A"}
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">Queue Size</div>
          <div class="stat-value">
            ${resources.queueSize !== undefined ? resources.queueSize : "N/A"}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderActivityFeed(props: ActivityProps) {
  if (props.entries.length === 0) {
    return html`
      <section class="card">
        <div class="card-title">Activity Feed</div>
        <div class="card-sub">Real-time events from agents, cron, and heartbeats.</div>
        <div class="muted" style="margin-top: 12px;">No activity yet.</div>
      </section>
    `;
  }

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between;">
        <div>
          <div class="card-title">Activity Feed</div>
          <div class="card-sub">Real-time events from agents, cron, and heartbeats.</div>
        </div>
        <div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Refreshing…" : "Refresh"}
          </button>
          <button class="btn" @click=${props.onClear}>Clear</button>
        </div>
      </div>
      <div class="list" style="margin-top: 12px;">
        ${props.entries.map(
          (entry) => html`
            <div class="list-item">
              <div class="list-main">
                <div class="row" style="align-items: center; gap: 8px;">
                  <span style="font-size: 18px;">
                    ${renderActivityIcon(entry.type, entry.status)}
                  </span>
                  <div class="list-title">${entry.event}</div>
                  ${
                    entry.status
                      ? html`
                          <span class="badge" style="font-size: 11px;">
                            ${entry.status}
                          </span>
                        `
                      : nothing
                  }
                </div>
                <div class="row" style="align-items: center; gap: 12px;">
                  <div class="list-sub">${new Date(entry.ts).toLocaleTimeString()}</div>
                  ${formatDurationMs(Date.now() - entry.ts) !== "0ms"
                    ? html`
                        <div class="list-sub muted">
                          (${formatDurationMs(Date.now() - entry.ts)} ago)
                        </div>
                      `
                    : nothing}
                  ${entry.source
                    ? html`
                        <div class="list-sub muted">
                          ${entry.source}
                        </div>
                      `
                    : nothing}
                </div>
              </div>
              ${entry.details
                ? html`
                    <div class="list-meta">
                      <div class="muted" style="font-size: 13px;">
                        ${entry.details}
                      </div>
                    </div>
                  `
                : nothing}
            </div>
          `,
        )}
      </div>
    </section>
  `;
}

export function renderActivity(props: ActivityProps) {
  return html`
    <div class="grid grid-cols-2" style="margin-bottom: 18px;">
      ${renderAgentStatusCard(props)}
      ${renderCronStatusCard(props)}
    </div>
    <div class="grid grid-cols-2" style="margin-bottom: 18px;">
      ${renderHeartbeatStatusCard(props)}
      ${renderResourcesCard(props)}
    </div>
    ${renderActivityFeed(props)}
  `;
}
