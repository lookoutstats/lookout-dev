import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import * as vscode from "vscode";
import {
  ApiError, createClient, figuresFor, findLink, matchesRoute, routeOfFile, siteUrl, startSignIn, waitForApproval,
  type Client, type FolderLink, type Range, type SitePages,
} from "@lookout-dev/core";
import { hintLine, hintText, panelHtml, statusText, type PanelState } from "./view.js";

// Lookout for VS Code and Cursor (marketing handoff "Editor extension and command-line check"): a status bar item, a
// side panel for the open folder's site, and a one-line hint above each Next.js page's code. Read-only: it signs in
// through the browser and keeps a read-only key in the editor's secret storage.

const KEY_SECRET = "lookout.apiKey";
const PICKED = (folder: string) => `lookout.site:${folder}`;
const REFRESH_MS = 10 * 60_000;
const PAGES_TTL_MS = 10 * 60_000;
const VIEW_ID = "lookout.panel";

export function activate(context: vscode.ExtensionContext): void {
  const lookout = new Lookout(context);
  context.subscriptions.push(lookout);
  void lookout.refresh();
}

export function deactivate(): void {}

class Lookout implements vscode.WebviewViewProvider, vscode.CodeLensProvider, vscode.Disposable {
  private state: PanelState = { kind: "loading" };
  private view: vscode.WebviewView | undefined;
  private readonly status = vscode.window.createStatusBarItem("lookout.status", vscode.StatusBarAlignment.Right, 100);
  private readonly lensChanged = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.lensChanged.event;
  private readonly disposables: vscode.Disposable[] = [];
  private link: FolderLink | null = null;
  private siteId: string | null = null;
  private pages: { siteId: string; at: number; data: SitePages } | null = null;
  private signIn: { cancelled: boolean } | null = null;
  private timer: ReturnType<typeof setInterval>;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.status.name = "Lookout";
    this.status.command = "lookout.togglePanel";
    this.status.tooltip = "Click to open the Lookout panel";
    this.status.show();
    const cmd = (id: string, fn: (...args: unknown[]) => unknown) => this.disposables.push(vscode.commands.registerCommand(id, fn));
    cmd("lookout.signIn", () => this.startSignIn());
    cmd("lookout.signOut", () => this.signOut());
    cmd("lookout.refresh", () => this.refresh());
    cmd("lookout.pickSite", () => this.pickSite());
    cmd("lookout.openInLookout", () => this.siteId && vscode.env.openExternal(vscode.Uri.parse(siteUrl(this.siteId))));
    cmd("lookout.togglePanel", () => this.togglePanel());
    this.disposables.push(
      vscode.window.registerWebviewViewProvider(VIEW_ID, this),
      vscode.languages.registerCodeLensProvider([{ scheme: "file", pattern: "**/{app,pages}/**/*.{tsx,ts,jsx,js,mdx}" }], this),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh()),
      vscode.window.onDidChangeActiveTextEditor(() => this.relinkForFile()),
      vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("lookout") && this.refresh()),
      context.secrets.onDidChange((e) => e.key === KEY_SECRET && this.refresh()),
    );
    this.timer = setInterval(() => void this.refresh(), REFRESH_MS);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.status.dispose();
    this.lensChanged.dispose();
    for (const d of this.disposables) d.dispose();
  }

  private get range(): Range {
    const r = vscode.workspace.getConfiguration("lookout").get<string>("range", "7d");
    return r === "24h" || r === "30d" ? r : "7d";
  }
  private get folder(): string | null {
    const active = vscode.window.activeTextEditor?.document.uri;
    const f = (active && vscode.workspace.getWorkspaceFolder(active)) ?? vscode.workspace.workspaceFolders?.[0];
    return f?.uri.fsPath ?? null;
  }

  private async client(): Promise<Client | null> {
    // The editor's secret storage; LOOKOUT_API_KEY in the editor's environment otherwise (remote machines, the command line's parity).
    const key = (await this.context.secrets.get(KEY_SECRET)) ?? process.env.LOOKOUT_API_KEY;
    return key ? createClient({ key, apiUrl: process.env.LOOKOUT_API_URL, userAgent: `lookout-vscode/${this.context.extension.packageJSON.version}` }) : null;
  }

  private show(state: PanelState): void {
    this.state = state;
    const s = statusText(state);
    this.status.text = `$(${s.on ? "circle-filled" : "circle-outline"}) ${s.text.replace(/^Lookout {2}/, "Lookout  ")}`;
    this.status.color = s.on ? new vscode.ThemeColor("charts.green") : undefined;
    if (this.view) this.view.webview.html = panelHtml(state, randomBytes(16).toString("base64"), this.view.webview.cspSource);
    this.lensChanged.fire();
  }

  /** Reads the folder's site and its numbers again. */
  async refresh(): Promise<void> {
    if (this.signIn) return;
    const api = await this.client();
    if (!api) return this.show({ kind: "signedOut" });
    const folder = this.folder;
    if (!folder) return this.show({ kind: "noFolder" });
    this.link = await findLink(folder, vscode.window.activeTextEditor?.document.uri.fsPath);
    const picked = this.context.workspaceState.get<string>(PICKED(folder));
    // A site picked for this folder wins over its Vercel link: the person chose it (a link to a project in another workspace).
    this.siteId = picked ?? this.link?.projectId ?? null;
    try {
      if (!this.siteId) {
        const list = await api.sites(this.range);
        return this.show({ kind: "unlinked", sites: list.sites });
      }
      if (this.state.kind !== "connected") this.show({ kind: "loading" });
      const overview = await api.overview(this.siteId, this.range);
      this.show({ kind: "connected", overview, linkedBy: picked ? "picked" : "link", now: Date.now() });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // The site isn't in this workspace (another team, or not connected): forget a stale pick, offer the list.
        await this.context.workspaceState.update(PICKED(folder), undefined);
        const list = await api.sites(this.range).catch(() => null);
        if (list) return this.show({ kind: "unlinked", sites: list.sites, note: "This folder's Vercel project isn't in your Lookout workspace. Pick its site, or connect its Vercel team at lookoutstats.com." });
      }
      this.show(await this.errorState(e, folder));
    }
  }

  private async errorState(e: unknown, folder: string): Promise<PanelState> {
    if (e instanceof ApiError && e.status === 401) {
      await this.context.secrets.delete(KEY_SECRET);
      return { kind: "signedOut" };
    }
    if (e instanceof ApiError && e.status === 404) return { kind: "error", text: `This folder's Vercel project isn't in your Lookout workspace (${folder}). Connect its team at lookoutstats.com.` };
    return { kind: "error", text: e instanceof Error ? e.message : "Something went wrong." };
  }

  /** A monorepo: the open file can belong to another app's project. */
  private async relinkForFile(): Promise<void> {
    const folder = this.folder;
    const file = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (!folder || this.state.kind === "signedOut" || this.signIn) return;
    const next = await findLink(folder, file);
    if (next && next.projectId !== this.link?.projectId) await this.refresh();
  }

  private async startSignIn(): Promise<void> {
    const flow = { cancelled: false };
    this.signIn = flow;
    try {
      const code = await startSignIn("vscode", hostname());
      this.show({ kind: "waiting", userCode: code.userCode, url: code.verificationUrl });
      await vscode.env.openExternal(vscode.Uri.parse(code.verificationUrl));
      const got = await waitForApproval(code, { sleep: (ms) => new Promise((r) => setTimeout(r, ms)).then(() => { if (flow.cancelled) throw new Error("cancelled"); }) });
      await this.context.secrets.store(KEY_SECRET, got.key);
      void vscode.window.showInformationMessage(`Lookout: signed in${got.email ? ` as ${got.email}` : ""}${got.workspace ? ` · workspace ${got.workspace}` : ""}. The key is read-only.`);
    } catch (e) {
      if (!flow.cancelled) void vscode.window.showWarningMessage(`Lookout: ${e instanceof Error ? e.message : "the sign-in didn't finish."}`);
    } finally {
      this.signIn = null;
      await this.refresh();
    }
  }

  private async signOut(): Promise<void> {
    await this.context.secrets.delete(KEY_SECRET);
    void vscode.window.showInformationMessage("Lookout: signed out. Revoke the key in Settings › API & MCP on lookoutstats.com if you no longer need it.");
    await this.refresh();
  }

  private async pickSite(id?: string): Promise<void> {
    const folder = this.folder;
    const api = await this.client();
    if (!folder || !api) return;
    let chosen = id;
    if (!chosen) {
      const list = await api.sites(this.range);
      const item = await vscode.window.showQuickPick(list.sites.map((s) => ({ label: s.domain, description: `${s.visitors.toLocaleString("en-US")} visitors`, id: s.id })), { placeHolder: "Which site is this folder?" });
      chosen = item?.id;
    }
    if (!chosen) return;
    await this.context.workspaceState.update(PICKED(folder), chosen);
    await this.refresh();
  }

  private async togglePanel(): Promise<void> {
    if (this.view?.visible) await vscode.commands.executeCommand("workbench.action.closeSidebar");
    else await vscode.commands.executeCommand(`${VIEW_ID}.focus`);
  }

  /** Opens the file for a page address: the Next.js page whose route matches it (a static route before a pattern). */
  private async openPage(path: string): Promise<void> {
    const root = this.link?.root ?? this.folder;
    if (!root) return;
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(root, "{app,src/app,pages,src/pages}/**/*.{tsx,ts,jsx,js,mdx}"), "**/node_modules/**", 2000);
    const hits = files.flatMap((f) => {
      const route = routeOfFile(root, f.fsPath);
      return route && matchesRoute(route, path) ? [{ f, dynamic: route.includes("[") }] : [];
    }).sort((a, b) => Number(a.dynamic) - Number(b.dynamic));
    if (!hits[0]) return void vscode.window.showInformationMessage(`Lookout: no page file found for ${path} in this folder.`);
    await vscode.window.showTextDocument(hits[0].f);
  }

  // The side panel.
  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = panelHtml(this.state, randomBytes(16).toString("base64"), view.webview.cspSource);
    view.webview.onDidReceiveMessage((m: { type: string; id?: string; path?: string; url?: string }) => {
      if (m.type === "signIn") void this.startSignIn();
      else if (m.type === "cancelSignIn" && this.signIn) this.signIn.cancelled = true;
      else if (m.type === "openUrl" && m.url?.startsWith("https://lookoutstats.com/")) void vscode.env.openExternal(vscode.Uri.parse(m.url));
      else if (m.type === "pick" && m.id) void this.pickSite(m.id);
      else if (m.type === "unpick" && this.folder) void this.context.workspaceState.update(PICKED(this.folder), undefined).then(() => this.refresh());
      else if (m.type === "openPage" && m.path) void this.openPage(m.path);
      else if ((m.type === "openSite" || m.type === "ask") && this.siteId) void vscode.env.openExternal(vscode.Uri.parse(siteUrl(this.siteId)));
      else if (m.type === "refresh") void this.refresh();
    });
  }

  // The code hint: one line above a Next.js page's default export.
  async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!vscode.workspace.getConfiguration("lookout").get<boolean>("codeHints", true)) return [];
    if (this.state.kind !== "connected" || !this.siteId) return [];
    const root = this.link?.root ?? this.folder;
    const route = root ? routeOfFile(root, doc.uri.fsPath) : null;
    if (!route) return [];
    const data = await this.pageList();
    if (!data) return [];
    const f = figuresFor(route, data.pages, data.routes);
    if (!f) return [];
    const line = hintLine(doc.getText());
    return [new vscode.CodeLens(new vscode.Range(line, 0, line, 0), { title: hintText(route, f), command: "lookout.openInLookout", tooltip: `Lookout · ${this.range === "7d" ? "last 7 days" : this.range}. Click to open the site in Lookout.` })];
  }

  /** The site's page list, fetched once per 10 minutes, not per file. */
  private async pageList(): Promise<SitePages | null> {
    const id = this.siteId;
    if (!id) return null;
    if (this.pages && this.pages.siteId === id && Date.now() - this.pages.at < PAGES_TTL_MS) return this.pages.data;
    const api = await this.client();
    if (!api) return null;
    try {
      const data = await api.pages(id, this.range);
      this.pages = { siteId: id, at: Date.now(), data };
      return data;
    } catch {
      return null;
    }
  }
}
