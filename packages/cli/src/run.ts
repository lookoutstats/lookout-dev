import { parseArgs } from "node:util";
import {
  ApiError, bars, below, change, checksOf, compact, configPath, createClient, findLink, int, isGrade, keyAndUrl, readConfig, safeApiUrl, siteUrl, startSignIn, verdict, vitalsLine, waitForApproval, writeConfig,
  type Client, type Grade, type Range, type SignInDeps, type WorkspaceSite,
} from "@lookout-dev/core";

// npx lookoutstats: Lookout's numbers for the project in this folder (marketing handoff "Editor extension and
// command-line check"). Everything here takes its outside world as `Env`, so the tests run it without a network,
// a terminal or a browser.

export interface Env {
  cwd: string;
  home: string;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  hostname: string;
  /** Opens a URL in the browser; false when it couldn't. */
  openBrowser(url: string): Promise<boolean>;
  sleep?: SignInDeps["sleep"];
  now?: () => number;
  /** Colors on (a terminal without NO_COLOR). */
  color: boolean;
  out(line: string): void;
  err(line: string): void;
}

/** Exit codes: 0 fine, 1 `check` found a site below the minimum grade, 2 anything else that stopped the command. */
export const EXIT = { ok: 0, belowGrade: 1, failed: 2 } as const;

const HELP = `Lookout for the terminal: your Vercel Analytics numbers, read-only.

Usage
  npx lookoutstats                 This folder's site: visitors, page views, speed, top pages
  npx lookoutstats sites           Every site in the workspace   (--board "name": one board)
  npx lookoutstats check           Exit 1 when a site's speed grade is below --min-grade (default B)
  npx lookoutstats login           Approve this computer in the browser; saves a read-only key to ~/.lookout
  npx lookoutstats logout          Forget the key (revoke it in Settings › API & MCP)

Options
  --json             The same numbers as JSON
  --range 7d         24h, 7d or 30d
  --site <id|domain> A site instead of this folder's (also LOOKOUT_SITE)
  --min-grade B      check: the lowest grade that passes (A–D)
  --require-data     check: fail a site without speed data, instead of skipping it

In CI, set LOOKOUT_API_KEY to a read-only key from Settings › API & MCP.`;

type Tone = "muted" | "up" | "down" | "warn" | "accent" | "bold";
const ANSI: Record<Tone, string> = { muted: "2", up: "32", down: "31", warn: "33", accent: "36", bold: "1" };

class Stop extends Error {
  constructor(message: string, readonly exitCode: number = EXIT.failed) {
    super(message);
  }
}

export async function run(argv: string[], io: Env): Promise<number> {
  const c = (tone: Tone, s: string) => (io.color ? `\x1b[${ANSI[tone]}m${s}\x1b[0m` : s);
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\nRun npx lookoutstats --help for the options.`);
    return EXIT.failed;
  }
  const { values: o, positionals } = args;
  const command = positionals[0] ?? "site";
  if (o.help) return (io.out(HELP), EXIT.ok);
  const range = (o.range ?? "7d") as Range;
  if (!["24h", "7d", "30d"].includes(range)) return (io.err("--range is 24h, 7d or 30d."), EXIT.failed);
  // Sign-in sends no key, so a test address is fine for it; reads use keyAndUrl (a saved key goes to Lookout only).
  const apiUrl = safeApiUrl(io.env.LOOKOUT_API_URL) ?? undefined;

  try {
    switch (command) {
      case "login":
        return await login();
      case "logout": {
        const saved = await readConfig(io.home);
        delete saved.key;
        delete saved.email;
        delete saved.workspace;
        await writeConfig(io.home, saved);
        io.out("Signed out. The key still works until you revoke it in Settings › API & MCP.");
        return EXIT.ok;
      }
      case "site":
        return await site(await client(), await siteOf());
      case "sites":
        return await sites(await client());
      case "check":
        return await check(await client());
      default:
        io.err(`Unknown command: ${command}. Run npx lookoutstats --help.`);
        return EXIT.failed;
    }
  } catch (e) {
    if (e instanceof Stop) {
      if (o.json) io.out(JSON.stringify({ error: e.message }, null, 2));
      else io.err(e.message);
      return e.exitCode;
    }
    if (e instanceof ApiError) {
      const text =
        e.status === 401 ? "Your Lookout key was revoked or is invalid. Run npx lookoutstats login." :
        e.status === 404 ? "This site isn't in your Lookout workspace. Connect its Vercel team at https://lookoutstats.com, or pass --site. See your sites with npx lookoutstats sites." :
        e.status === 429 ? "Too many requests for this key. Try again in a few minutes." : e.message;
      if (o.json) io.out(JSON.stringify({ error: text, code: e.code }, null, 2));
      else io.err(text);
      return EXIT.failed;
    }
    throw e;
  }

  async function client(): Promise<Client> {
    const use = keyAndUrl(io.env, (await readConfig(io.home)).key);
    if (!use) throw new Stop("Not signed in. Run npx lookoutstats login (or set LOOKOUT_API_KEY in CI).");
    return createClient({ ...use, fetch: io.fetch, userAgent: "lookoutstats-cli" });
  }

  /** The site to show: --site, LOOKOUT_SITE, or the folder's Vercel link. */
  async function siteOf(): Promise<string> {
    const given = o.site ?? io.env.LOOKOUT_SITE;
    if (given) return given;
    const link = await findLink(io.cwd);
    if (link) return link.projectId;
    throw new Stop(
      "This folder isn't linked to a Vercel project, so Lookout doesn't know which site it is.\n" +
        "Run vercel link here, or pass the site: npx lookoutstats --site <id or domain>\n" +
        "See your sites with npx lookoutstats sites.",
    );
  }

  /** A site named by id, or by domain or project name from the workspace's list. */
  async function resolve(api: Client, ref: string): Promise<string> {
    if (/^prj_/.test(ref)) return ref;
    const list = await api.sites(range);
    const hit = list.sites.find((s) => s.domain === ref || s.name === ref || s.id === ref);
    if (!hit) throw new Stop(`No site "${ref}" in your workspace. See your sites with npx lookoutstats sites.`);
    return hit.id;
  }

  async function login(): Promise<number> {
    const deps: SignInDeps = { fetch: io.fetch, apiUrl, sleep: io.sleep, now: io.now };
    const code = await startSignIn("cli", io.hostname, deps).catch((e: Error) => {
      throw new Stop(e.message);
    });
    io.out("");
    io.out(c("muted", "  Opening lookoutstats.com to approve this computer…"));
    io.out(c("muted", `  Code ${code.userCode} · ${code.verificationUrl}`));
    if (!(await io.openBrowser(code.verificationUrl))) io.out(c("muted", "  Open the link above in a browser."));
    const got = await waitForApproval(code, deps).catch((e: Error) => {
      throw new Stop(e.message);
    });
    await writeConfig(io.home, { ...(await readConfig(io.home)), key: got.key, email: got.email, workspace: got.workspace });
    io.out("");
    io.out(`${c("up", "  ✓ ")}${got.email ? `Signed in as ${got.email}` : "Signed in"}${got.workspace ? c("muted", ` · workspace ${got.workspace}`) : ""}`);
    io.out(`${c("up", "  ✓ ")}Read-only key saved to ${configPath("~")}`);
    io.out("");
    io.out(`${c("muted", "  Try: ")}npx lookoutstats`);
    return EXIT.ok;
  }

  async function site(api: Client, ref: string): Promise<number> {
    const v = await api.overview(await resolve(api, ref), range);
    const checks = checksOf(v.speed);
    if (o.json) {
      const d = checks?.device ?? null;
      io.out(JSON.stringify({ site: v.site.domain, id: v.site.id, range: v.range, visitors: v.visitors, change: v.change, pageviews: v.pageviews, grade: v.speed.grade, lcp: d?.lcpMs != null ? Math.round(d.lcpMs / 100) / 10 : null, inp: d?.inpMs ?? null, cls: d?.cls ?? null, daily: v.points.map((p) => ({ start: p.start, visitors: p.visitors })), topPages: v.pages.map((p) => ({ path: p.name, visitors: p.visitors })), url: siteUrl(v.site.id) }, null, 2));
      return EXIT.ok;
    }
    const label = (s: string) => c("muted", `  ${s.padEnd(13)}`);
    const tone = (pct: number | null) => (pct == null ? "muted" : pct < 0 ? "down" : "up");
    const gradeTone = (g: Grade | null): Tone => (g === "A" ? "up" : g === "D" ? "down" : g ? "warn" : "muted");
    io.out("");
    io.out(`  ${c("bold", v.site.domain)}${c("muted", ` · last ${RANGE_WORDS[range]}`)}`);
    io.out("");
    io.out(`${label("Visitors")}${int(v.visitors).padEnd(9)}${c(tone(v.change), change(v.change))}`);
    io.out(`${label("Page views")}${int(v.pageviews)}`);
    if (v.speed.grade && checks) {
      io.out(`${label("Speed")}${c(gradeTone(v.speed.grade), v.speed.grade.padEnd(9))}${c("muted", `${checks.pass} of ${checks.measured} checks pass ${checks.where}`)}`);
      io.out(c("muted", `${" ".repeat(15)}${vitalsLine(v.speed)}`));
    } else {
      io.out(`${label("Speed")}${c("muted", v.speed.status === "off" ? "No speed data (Speed Insights is off, or needs Plus)" : "Too few visits to grade")}`);
    }
    if (v.granularity === "day" && v.points.length > 1) {
      const days = v.points.map((p) => new Date(p.start));
      const day = (d: Date) => d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
      io.out("");
      io.out(`${label("Daily")}${c("up", bars(v.points.map((p) => p.visitors)))}${c("muted", `  ${day(days[0]!)} – ${day(days.at(-1)!)}`)}`);
    }
    if (v.pages.length) {
      io.out("");
      const width = Math.max(12, ...v.pages.slice(0, 3).map((p) => p.name.length + 4));
      v.pages.slice(0, 3).forEach((p, i) => io.out(`${i === 0 ? label("Top pages") : " ".repeat(15)}${p.name.padEnd(width)}${int(p.visitors)}`));
    }
    const last = v.deployments?.[0];
    if (last) {
      io.out("");
      io.out(`${label("Last deploy")}${last.branch ?? last.message ?? "production"}${c("muted", ` · ${ago(Date.parse(last.at), (io.now ?? Date.now)())}`)}`);
    }
    io.out("");
    io.out(`${c("muted", "  Open   ")}${c("accent", siteUrl(v.site.id))}`);
    return EXIT.ok;
  }

  async function listFor(api: Client): Promise<{ list: WorkspaceSite[]; unavailable: string[] }> {
    const all = await api.sites(range);
    if (!o.board) return { list: all.sites, unavailable: all.unavailable };
    const board = await api.boardSites(o.board, range).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) throw new Stop(`No board "${o.board}" in your workspace.`);
      throw e;
    });
    const ids = new Set(board.sites.map((s) => s.id));
    return { list: all.sites.filter((s) => ids.has(s.id)), unavailable: board.unavailable };
  }

  async function sites(api: Client): Promise<number> {
    const { list, unavailable } = await listFor(api);
    const needsLook = (s: WorkspaceSite) => s.speed.grade === "D" || (s.change != null && s.change <= -25);
    if (o.json) {
      io.out(JSON.stringify({ range, sites: list.map((s) => ({ site: s.domain, id: s.id, visitors: s.visitors, change: s.change, grade: s.speed.grade, needsLook: needsLook(s) })), unavailable }, null, 2));
      return EXIT.ok;
    }
    if (!list.length && !o.board) {
      io.out("");
      io.out("  No sites in this workspace yet. Connect Vercel at https://lookoutstats.com/connect");
      return EXIT.ok;
    }
    const w = Math.max(24, ...list.map((s) => s.domain.length + 2));
    io.out("");
    io.out(c("muted", `  ${"SITE".padEnd(w)} ${"VISITORS".padStart(8)}   ${"CHANGE".padEnd(9)} SPEED`));
    for (const s of list) {
      const ch = change(s.change);
      const chTone: Tone = s.change == null ? "muted" : s.change < 0 ? "down" : "up";
      const g = s.speed.grade;
      io.out(`  ${s.domain.padEnd(w)} ${int(s.visitors).padStart(8)}   ${c(chTone, ch.padEnd(9))} ${c(g === "A" ? "up" : g === "D" ? "down" : g ? "warn" : "muted", g ?? "–")}`);
    }
    const total = list.reduce((n, s) => n + s.visitors, 0);
    const look = list.filter(needsLook).length;
    io.out("");
    io.out(`${c("muted", `  ${list.length} site${list.length === 1 ? "" : "s"} · ${int(total)} visitors`)}${look ? `${c("muted", " · ")}${c("down", `${look} need${look === 1 ? "s" : ""} a look`)}` : ""}`);
    if (unavailable.length) io.out(c("muted", `  Couldn’t read just now: ${unavailable.join(", ")}`));
    return EXIT.ok;
  }

  async function check(api: Client): Promise<number> {
    const min = (o["min-grade"] ?? "B").toUpperCase();
    if (!isGrade(min)) throw new Stop("--min-grade is A, B, C or D.");
    // Which sites: --site / LOOKOUT_SITE, else this folder's, else --board's, else every site in the workspace.
    const given = o.site ?? io.env.LOOKOUT_SITE;
    const link = given ? null : await findLink(io.cwd);
    let list: { id: string; domain: string; grade: Grade | null }[];
    if (given || link) {
      const id = given ? await resolve(api, given) : link!.projectId;
      const d = await api.site(id, range);
      list = [{ id, domain: d.site.domain, grade: d.speed.grade }];
    } else {
      list = (await listFor(api)).list.map((s) => ({ id: s.id, domain: s.domain, grade: s.speed.grade }));
    }
    if (!list.length) throw new Stop("No sites to check: this workspace has none yet. Connect Vercel at https://lookoutstats.com/connect");
    const failing = list.filter((s) => (s.grade ? below(s.grade, min) : !!o["require-data"]));
    // Why each failing site fails: its first check that isn't Good, in plain words.
    const why = new Map<string, string>();
    for (const s of failing) {
      if (!s.grade) {
        why.set(s.id, "no speed data");
        continue;
      }
      const d = await api.site(s.id, range).catch(() => null);
      const v = d ? verdict(d.speed) : null;
      why.set(s.id, v ? v.charAt(0).toLowerCase() + v.slice(1) : "");
    }
    if (o.json) {
      io.out(JSON.stringify({ minGrade: min, range, sites: list.map((s) => ({ site: s.domain, id: s.id, grade: s.grade, pass: !failing.includes(s), ...(why.has(s.id) ? { reason: why.get(s.id) } : {}) })), below: failing.length }, null, 2));
      return failing.length ? EXIT.belowGrade : EXIT.ok;
    }
    const w = Math.max(...list.map((s) => s.domain.length), 10) + 3;
    io.out("");
    for (const s of list) {
      const bad = failing.includes(s);
      const g = s.grade;
      const mark = bad ? c("down", "  ✗ ") : g ? c("up", "  ✓ ") : c("muted", "  – ");
      const gt: Tone = g === "A" ? "up" : g === "D" ? "down" : g ? "warn" : "muted";
      const tail = bad ? c("muted", `   needs ${min}${why.get(s.id) ? ` · ${why.get(s.id)}` : ""}`) : g ? "" : c("muted", "   no speed data, skipped");
      io.out(`${mark}${s.domain.padEnd(w)}${c(gt, g ?? "–")}${tail}`);
    }
    io.out("");
    if (failing.length) {
      io.out(`${c("down", `  ${failing.length} of ${list.length} site${list.length === 1 ? "" : "s"} ${failing.length === 1 ? "is" : "are"} below ${min}. `)}${c("muted", "Exit code 1.")}`);
      return EXIT.belowGrade;
    }
    io.out(c("up", `  ${list.length === 1 ? "The site is" : `All ${list.length} sites are`} at ${min} or better${list.some((s) => !s.grade) ? " (sites without speed data skipped)" : ""}.`));
    return EXIT.ok;
  }
}

const RANGE_WORDS: Record<Range, string> = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" };

function ago(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000));
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      range: { type: "string" },
      site: { type: "string" },
      board: { type: "string" },
      "min-grade": { type: "string" },
      "require-data": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
}
