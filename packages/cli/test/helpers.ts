import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Overview, WorkspaceSite } from "@lookout-dev/core";
import { run, type Env } from "../src/run.js";

// A fake Lookout API and a folder on disk, so each command runs end to end without a network.

export const KEY = "lk_live_abcdefghijklmnopqrstuvwx";

export const speed = (grade: "A" | "B" | "C" | "D" | null, mobile: { lcpMs: number; inpMs: number; cls: number } | null) => ({
  status: grade === "A" ? ("passing" as const) : grade ? ("needs_work" as const) : ("off" as const),
  grade,
  gradeDevice: grade ? ("mobile" as const) : null,
  lcpMs: mobile?.lcpMs ?? null,
  inpMs: mobile?.inpMs ?? null,
  cls: mobile?.cls ?? null,
  samples: mobile ? 800 : 0,
  mobile: mobile ? { ...mobile, samples: 500 } : null,
  desktop: null,
});

export const OVERVIEW: Overview = {
  site: { id: "prj_north", name: "northwind-web", domain: "northwind.io" },
  range: "7d",
  granularity: "day",
  visitors: 13912,
  previousVisitors: 12693,
  change: 9.6,
  pageviews: 34780,
  points: [4, 5, 5, 6, 7, 8, 9].map((v, i) => ({ start: new Date(Date.UTC(2026, 10, 16 + i)).toISOString(), visitors: v * 100, previousVisitors: null })),
  pages: [
    { name: "/", visitors: 6204, share: 44.6 },
    { name: "/pricing", visitors: 3483, share: 25 },
    { name: "/docs", visitors: 2110, share: 15.2 },
  ],
  deployments: [{ at: "2026-11-21T10:00:00.000Z", message: "Fix hero copy", branch: "fix/hero-copy", state: "ready" }],
  speed: speed("A", { lcpMs: 2100, inpMs: 140, cls: 0.04 }),
};

const site = (id: string, domain: string, visitors: number, change: number | null, grade: "A" | "B" | "C" | "D" | null): WorkspaceSite => ({
  id, name: domain, domain, visitors, previousVisitors: null, change, pageviews: visitors * 2, speed: { status: grade ? "needs_work" : "off", grade, gradeDevice: grade ? "mobile" : null },
});
export const SITES: WorkspaceSite[] = [
  site("prj_north", "northwind.io", 13912, 9.6, "A"),
  site("prj_docs", "docs.northwind.io", 4210, 5.7, "A"),
  site("prj_pricing", "pricing.northwind.io", 3483, 18.5, "B"),
  site("prj_launch", "launch.northwind.io", 2104, -31, "D"),
  site("prj_promo", "promo.northwind.io", 1006, 212, "C"),
];

export interface Fake {
  sites?: WorkspaceSite[];
  overview?: Overview;
  /** /v1/sites/{id}: the speed per site. */
  detail?: Record<string, ReturnType<typeof speed>>;
  /** What /v1/device/token answers, in turn. */
  tokens?: unknown[];
  status?: number;
}

export function fakeApi(fake: Fake = {}) {
  const calls: { method: string; path: string; auth: string | null; body: unknown }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const tokens = [...(fake.tokens ?? [])];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path: url.pathname + url.search, auth: new Headers(init?.headers).get("authorization"), body });
    if (fake.status) return json({ error: { code: "x", message: "x" } }, fake.status);
    const p = url.pathname;
    if (method === "POST" && p === "/v1/device/code") return json({ deviceCode: "d".repeat(40), userCode: "BCDF-GHJK", verificationUrl: "https://lookoutstats.com/device?code=BCDF-GHJK", expiresIn: 600, interval: 3 });
    if (method === "POST" && p === "/v1/device/token") {
      const next = tokens.shift() ?? { status: "pending" };
      return typeof next === "number" ? json({ error: { code: "x", message: "x" } }, next) : json(next);
    }
    if (p === "/v1/sites") return json({ range: "7d", sites: fake.sites ?? SITES, unavailable: [] });
    const m = /^\/v1\/sites\/([^/]+)(\/overview)?$/.exec(p);
    if (m && m[2]) return m[1] === (fake.overview ?? OVERVIEW).site.id ? json(fake.overview ?? OVERVIEW) : json({ error: { code: "not_found", message: "Project not found" } }, 404);
    if (m) {
      const s = (fake.sites ?? SITES).find((x) => x.id === m[1]);
      if (!s) return json({ error: { code: "not_found", message: "Project not found" } }, 404);
      return json({ site: { id: s.id, name: s.name, domain: s.domain }, range: "7d", speed: fake.detail?.[s.id] ?? speed(s.speed.grade, { lcpMs: 4200, inpMs: 150, cls: 0.05 }) });
    }
    const b = /^\/v1\/boards\/([^/]+)\/sites$/.exec(p);
    if (b) return decodeURIComponent(b[1]!) === "Landing pages" ? json({ board: { id: "b1", name: "Landing pages" }, range: "7d", sites: [{ id: "prj_pricing", domain: "pricing.northwind.io" }, { id: "prj_launch", domain: "launch.northwind.io" }], unavailable: [] }) : json({ error: { code: "not_found", message: "Board not found" } }, 404);
    return json({ error: { code: "not_found", message: "Not found" } }, 404);
  }) as typeof fetch;
  return { fetch: f, calls };
}

/** A temporary home and project folder; `linked`: the folder has .vercel/project.json for prj_north. */
export async function folders({ linked = true, signedIn = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), "lookoutstats-"));
  const home = join(root, "home");
  const cwd = join(root, "northwind-web");
  await mkdir(home, { recursive: true });
  await mkdir(join(cwd, ".vercel"), { recursive: true });
  if (linked) await writeFile(join(cwd, ".vercel", "project.json"), JSON.stringify({ projectId: "prj_north", orgId: "team_1" }));
  if (signedIn) await writeFile(join(home, ".lookout"), JSON.stringify({ key: KEY, email: "you@northwind.io", workspace: "Northwind" }), { mode: 0o600 });
  return { root, home, cwd };
}

export async function cli(argv: string[], opts: { fake?: Fake; linked?: boolean; signedIn?: boolean; env?: Record<string, string>; dirs?: Awaited<ReturnType<typeof folders>> } = {}) {
  const dirs = opts.dirs ?? (await folders({ linked: opts.linked, signedIn: opts.signedIn }));
  const api = fakeApi(opts.fake);
  const out: string[] = [];
  const err: string[] = [];
  const opened: string[] = [];
  const env: Env = {
    cwd: dirs.cwd,
    home: dirs.home,
    env: opts.env ?? {},
    fetch: api.fetch,
    hostname: "dev-laptop",
    openBrowser: async (u) => (opened.push(u), true),
    sleep: async () => {},
    now: () => Date.parse("2026-11-21T12:00:00.000Z"),
    color: false,
    out: (l) => out.push(l),
    err: (l) => err.push(l),
  };
  const code = await run(argv, env);
  return { code, out: out.join("\n"), err: err.join("\n"), calls: api.calls, opened, dirs };
}
