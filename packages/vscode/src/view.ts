import { change, compact, ms, verdict, vitalsLine, type Overview, type WorkspaceSite } from "@lookout-dev/core";

// What the extension shows, without VS Code (so it's tested on its own): the status bar text, the side panel's HTML in
// its states, and the code hint's line. The design: "Lookout Editor and CLI.dc.html".

export type PanelState =
  | { kind: "signedOut" }
  | { kind: "waiting"; userCode: string; url: string }
  | { kind: "noFolder" }
  | { kind: "unlinked"; sites: WorkspaceSite[]; note?: string }
  | { kind: "loading" }
  | { kind: "connected"; overview: Overview; linkedBy: "link" | "picked"; now: number }
  | { kind: "error"; text: string };

/** The status bar item, bottom right: "Lookout  13.9K ▲ 9.6% · A", or what to do next. */
export function statusText(state: PanelState): { text: string; on: boolean } {
  switch (state.kind) {
    case "connected": {
      const v = state.overview;
      return { text: `Lookout  ${compact(v.visitors)} ${change(v.change)}${v.speed.grade ? ` · ${v.speed.grade}` : ""}`, on: true };
    }
    case "signedOut":
    case "waiting":
      return { text: "Lookout  Sign in", on: false };
    case "unlinked":
      return { text: "Lookout  Pick a site", on: false };
    case "noFolder":
      return { text: "Lookout  Open a folder", on: false };
    case "loading":
      return { text: "Lookout  …", on: false };
    case "error":
      return { text: "Lookout  ⚠", on: false };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function spark(points: number[]): string {
  if (points.length < 2) return "";
  const mx = Math.max(...points), mn = Math.min(...points);
  const d = points.map((v, i) => `${i ? "L" : "M"}${(2 + (i / (points.length - 1)) * 80).toFixed(1)},${(31 - (mx === mn ? 0.5 : (v - mn) / (mx - mn)) * 28).toFixed(1)}`).join(" ");
  return `<svg width="84" height="34" viewBox="0 0 84 34" aria-hidden="true"><path d="${d}" fill="none" stroke="var(--up)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function ago(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const RANGE: Record<string, string> = { "24h": "last 24 hours", "7d": "last 7 days", "30d": "last 30 days" };
const COMPARE: Record<string, string> = { "24h": "vs the day before", "7d": "vs last week", "30d": "vs the 30 days before" };

/** The panel's body for a state. Buttons post { type, … } to the extension. */
export function panelBody(state: PanelState): string {
  switch (state.kind) {
    case "signedOut":
      return `<div class="state"><span class="title">Sign in to see this project's numbers</span><span class="text">Opens lookoutstats.com to approve this editor. It gets a read-only key and can't change anything.</span><button class="primary" data-msg="signIn">Sign in to Lookout</button><span class="small">No account? The button also lets you create one.</span></div>`;
    case "waiting":
      return `<div class="state"><span class="title">Approve this editor in the browser</span><span class="text">Check that the page shows this code, then click Approve.</span><span class="code">${esc(state.userCode)}</span><button class="secondary" data-msg="openUrl" data-url="${esc(state.url)}">Open the page again</button><button class="link" data-msg="cancelSignIn">Cancel</button></div>`;
    case "noFolder":
      return `<div class="state"><span class="title">Open a project folder</span><span class="text">Lookout shows the numbers for the Vercel project in the folder you have open.</span></div>`;
    case "unlinked":
      return `<div class="state"><span class="title">Which site is this folder?</span><span class="text">${esc(state.note ?? "This folder isn't linked to a Vercel project, so pick the site once.")}</span><div class="list">${state.sites.length ? state.sites.map((s) => `<button class="pick" data-msg="pick" data-id="${esc(s.id)}"><span>${esc(s.domain)}</span><span class="muted">${compact(s.visitors)}</span></button>`).join("") : `<span class="small">No sites in this workspace yet. Connect Vercel at lookoutstats.com.</span>`}</div></div>`;
    case "loading":
      return `<div class="state"><span class="small">Loading…</span></div>`;
    case "error":
      return `<div class="state"><span class="text">${esc(state.text)}</span><button class="secondary" data-msg="refresh">Try again</button></div>`;
    case "connected": {
      const v = state.overview;
      const why = verdict(v.speed);
      const up = v.change == null ? "muted" : v.change < 0 ? "down" : "up";
      const grade = v.speed.grade
        ? `<div class="grade"><span class="letter" data-grade="${esc(v.speed.grade)}">${v.speed.grade}</span><span class="gtext"><span>${esc(why ?? "")}</span><span class="mono">${esc(vitalsLine(v.speed))}</span></span></div>`
        : `<div class="grade"><span class="letter" data-grade="none">–</span><span class="gtext"><span>No speed grade</span><span class="mono">${v.speed.status === "off" ? "Speed Insights is off, or needs Plus" : "Too few visits to grade"}</span></span></div>`;
      const pages = v.pages.slice(0, 3).map((p) => `<button class="page" data-msg="openPage" data-path="${esc(p.name)}"><span>${esc(p.name)}</span><span class="muted">${compact(p.visitors)}</span></button>`).join("");
      const last = v.deployments?.[0];
      return `<div class="state">
<div class="stack"><span class="site">${esc(v.site.domain)}</span><span class="small">${state.linkedBy === "link" ? "Linked to this folder" : "Picked for this folder"} · ${RANGE[v.range] ?? esc(v.range)}</span></div>
<div class="visitors"><div class="stack"><span class="small">Visitors</span><span class="big">${compact(v.visitors)}</span><span class="delta ${up}">${change(v.change)} ${COMPARE[v.range] ?? ""}</span></div>${spark(v.points.map((p) => p.visitors))}</div>
${grade}
${pages ? `<div class="pages"><span class="small">Top pages · click to open the file</span>${pages}</div>` : ""}
${last ? `<div class="stack small"><span>Last deploy</span><span class="deploy">${esc(last.branch ?? last.message ?? "production")} · ${ago(Date.parse(last.at), state.now)}</span></div>` : ""}
<div class="actions"><button class="primary" data-msg="openSite">Open in Lookout ↗</button><button class="secondary" data-msg="ask">Ask Lookout</button></div>
${state.linkedBy === "picked" ? `<button class="link" data-msg="unpick">Pick another site</button>` : ""}
</div>`;
    }
  }
}

/** The whole webview document: the design's dark panel, in the editor's own colors where it has them. */
export function panelHtml(state: PanelState, nonce: string, cspSource: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
:root { --ink: var(--vscode-foreground); --muted: var(--vscode-descriptionForeground); --line: var(--vscode-panel-border, #262626); --bg: var(--vscode-editor-background); --surface2: var(--vscode-list-hoverBackground); --up: #4ade80; --down: #f87171; --warn: #fbbf24; }
body { margin: 0; padding: 14px; color: var(--ink); font-family: var(--vscode-font-family); font-size: 13px; }
.label { font: 500 10px/1 var(--vscode-editor-font-family); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 14px; }
.state { display: flex; flex-direction: column; gap: 14px; }
.stack { display: flex; flex-direction: column; gap: 4px; }
.site { font: 600 13px/1.2 var(--vscode-editor-font-family); }
.small { font-size: 11.5px; color: var(--muted); line-height: 1.45; }
.muted { color: var(--muted); }
.title { font-size: 14px; font-weight: 600; line-height: 1.3; }
.text { font-size: 12.5px; line-height: 1.5; color: var(--muted); }
.code { font: 600 20px/1 var(--vscode-editor-font-family); letter-spacing: .08em; }
.visitors { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; }
.big { font: 500 24px/1 var(--vscode-editor-font-family); letter-spacing: -.03em; }
.delta { font: 500 11px/1 var(--vscode-editor-font-family); }
.up { color: var(--up); } .down { color: var(--down); }
.grade { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); }
.letter { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; font: 600 15px/1 var(--vscode-editor-font-family); flex: none; background: rgba(251,191,36,.14); color: var(--warn); }
.letter[data-grade="A"] { background: rgba(74,222,128,.14); color: var(--up); }
.letter[data-grade="D"] { background: rgba(248,113,113,.14); color: var(--down); }
.letter[data-grade="none"] { background: transparent; border: 1px solid var(--line); color: var(--muted); }
.gtext { display: flex; flex-direction: column; gap: 3px; min-width: 0; font-size: 12.5px; font-weight: 600; }
.mono { font: 400 11px/1.3 var(--vscode-editor-font-family); color: var(--muted); }
.pages, .list { display: flex; flex-direction: column; gap: 2px; }
.list { gap: 4px; }
button { font-family: inherit; }
.page, .pick { all: unset; cursor: pointer; display: flex; justify-content: space-between; gap: 10px; font: 400 12px/1.2 var(--vscode-editor-font-family); }
.page { padding: 6px 8px; margin: 0 -8px; border-radius: 6px; }
.page:hover { background: var(--surface2); }
.pick { padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
.pick:hover { border-color: var(--muted); }
.deploy { color: var(--ink); font-family: var(--vscode-editor-font-family); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.primary { align-self: flex-start; height: 30px; padding: 0 11px; border-radius: 7px; border: 0; background: var(--vscode-button-background); color: var(--vscode-button-foreground); cursor: pointer; font-weight: 600; font-size: 12px; }
.secondary { align-self: flex-start; height: 30px; padding: 0 11px; border-radius: 7px; border: 1px solid var(--line); background: transparent; color: var(--ink); cursor: pointer; font-size: 12px; }
.link { all: unset; cursor: pointer; font-size: 11.5px; color: var(--vscode-textLink-foreground); }
button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
</style></head><body><span class="label">Lookout</span>${panelBody(state)}
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-msg]");
  if (b) vscode.postMessage({ type: b.dataset.msg, id: b.dataset.id, path: b.dataset.path, url: b.dataset.url });
});
</script></body></html>`;
}

/** The code hint above a page's code: "/pricing · 3,483 visitors · ▲ 18.5% · LCP 2.9s". */
export function hintText(route: string, f: { visitors: number; change: number | null; lcpMs: number | null }): string {
  return [route, `${f.visitors.toLocaleString("en-US")} visitor${f.visitors === 1 ? "" : "s"}`, f.change == null ? null : change(f.change), f.lcpMs == null ? null : `LCP ${ms(f.lcpMs)}`].filter(Boolean).join(" · ");
}

/** The line a code hint sits above: the page's default export, else the first line. */
export function hintLine(text: string): number {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /^\s*export\s+default\b/.test(l));
  return i >= 0 ? i : 0;
}
