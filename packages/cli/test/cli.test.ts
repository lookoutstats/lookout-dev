import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cli, folders, KEY, OVERVIEW, SITES, speed } from "./helpers.js";

// npx lookoutstats, each command in a linked folder, an unlinked folder, and signed out (marketing handoff 2026-11-21).

describe("npx lookoutstats (this folder's site)", () => {
  it("in a linked folder: the design's lines, from the folder's Vercel link, with the saved key", async () => {
    const r = await cli([]);
    expect(r.code).toBe(0);
    expect(r.out).toBe(
      [
        "",
        "  northwind.io · last 7 days",
        "",
        "  Visitors     13,912   ▲ 9.6%",
        "  Page views   34,780",
        "  Speed        A        3 of 3 checks pass on phones",
        "               LCP 2.1s · INP 140ms · CLS 0.04",
        "",
        "  Daily        ▁▂▂▄▅▇█  Mon – Sun",
        "",
        "  Top pages    /           6,204",
        "               /pricing    3,483",
        "               /docs       2,110",
        "",
        "  Last deploy  fix/hero-copy · 2h ago",
        "",
        "  Open   https://lookoutstats.com/projects/prj_north",
      ].join("\n"),
    );
    expect(r.calls).toEqual([expect.objectContaining({ method: "GET", path: "/v1/sites/prj_north/overview?range=7d", auth: `Bearer ${KEY}` })]);
  });

  it("--json: the same numbers as data", async () => {
    const r = await cli(["--json"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ site: "northwind.io", range: "7d", visitors: 13912, change: 9.6, grade: "A", lcp: 2.1, inp: 140, cls: 0.04, topPages: [{ path: "/", visitors: 6204 }, { path: "/pricing", visitors: 3483 }, { path: "/docs", visitors: 2110 }] });
  });

  it("in an unlinked folder: says how to link it or name the site, exit 2; --site by domain works", async () => {
    const r = await cli([], { linked: false });
    expect(r.code).toBe(2);
    expect(r.err).toContain("This folder isn't linked to a Vercel project");
    expect(r.err).toContain("npx lookoutstats --site <id or domain>");
    expect(r.calls).toEqual([]);
    const named = await cli(["--site", "northwind.io"], { linked: false });
    expect(named.code).toBe(0);
    expect(named.out).toContain("northwind.io · last 7 days");
  });

  it("a monorepo: the app's own link under apps/", async () => {
    const dirs = await folders({ linked: false });
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(join(dirs.cwd, "apps", "web", ".vercel"), { recursive: true });
    await writeFile(join(dirs.cwd, "apps", "web", ".vercel", "project.json"), JSON.stringify({ projectId: "prj_north" }));
    const r = await cli([], { dirs });
    expect(r.code).toBe(0);
    expect(r.calls[0]!.path).toBe("/v1/sites/prj_north/overview?range=7d");
  });

  it("signed out: says to log in, calls nothing, exit 2; LOOKOUT_API_KEY signs in for CI", async () => {
    const r = await cli([], { signedIn: false });
    expect(r.code).toBe(2);
    expect(r.err).toBe("Not signed in. Run npx lookoutstats login (or set LOOKOUT_API_KEY in CI).");
    expect(r.calls).toEqual([]);
    const ci = await cli([], { signedIn: false, env: { LOOKOUT_API_KEY: "lk_live_ci0000000000000000000000" } });
    expect(ci.code).toBe(0);
    expect(ci.calls[0]!.auth).toBe("Bearer lk_live_ci0000000000000000000000");
  });

  it("a revoked key says so", async () => {
    const r = await cli([], { fake: { status: 401 } });
    expect([r.code, r.err]).toEqual([2, "Your Lookout key was revoked or is invalid. Run npx lookoutstats login."]);
  });
});

describe("an empty workspace (no Vercel team connected yet)", () => {
  it("sites says to connect Vercel; check stops with exit 2, not 1", async () => {
    const s = await cli(["sites"], { fake: { sites: [] } });
    expect([s.code, s.out]).toEqual([0, "\n  No sites in this workspace yet. Connect Vercel at https://lookoutstats.com/connect"]);
    const c = await cli(["check"], { linked: false, fake: { sites: [] } });
    expect(c.code).toBe(2);
    expect(c.err).toContain("No sites to check");
  });
  it("a linked folder whose project isn't in the workspace says how to fix it", async () => {
    const r = await cli([], { fake: { overview: { ...OVERVIEW, site: { ...OVERVIEW.site, id: "prj_other" } } } });
    expect([r.code, r.err]).toEqual([2, "This site isn't in your Lookout workspace. Connect its Vercel team at https://lookoutstats.com, or pass --site. See your sites with npx lookoutstats sites."]);
  });
});

describe("npx lookoutstats sites", () => {
  it("every site in a table, busiest first, with a summary line", async () => {
    const r = await cli(["sites"]);
    expect(r.code).toBe(0);
    expect(r.out.split("\n")).toEqual([
      "",
      "  SITE                     VISITORS   CHANGE    SPEED",
      "  northwind.io               13,912   ▲ 9.6%    A",
      "  docs.northwind.io           4,210   ▲ 5.7%    A",
      "  pricing.northwind.io        3,483   ▲ 18.5%   B",
      "  launch.northwind.io         2,104   ▼ 31.0%   D",
      "  promo.northwind.io          1,006   ▲ 212%    C",
      "",
      "  5 sites · 24,715 visitors · 1 needs a look",
    ]);
  });

  it("--board limits it to one board; an unknown board says so", async () => {
    const r = await cli(["sites", "--board", "Landing pages", "--json"]);
    expect(JSON.parse(r.out).sites.map((s: { site: string }) => s.site)).toEqual(["pricing.northwind.io", "launch.northwind.io"]);
    const missing = await cli(["sites", "--board", "Nope"]);
    expect([missing.code, missing.err]).toEqual([2, 'No board "Nope" in your workspace.']);
  });

  it("works in an unlinked folder, and signed out says to log in", async () => {
    expect((await cli(["sites"], { linked: false })).code).toBe(0);
    const out = await cli(["sites"], { signedIn: false });
    expect([out.code, out.calls.length]).toEqual([2, 0]);
  });
});

describe("npx lookoutstats check", () => {
  const sites = (grades: ("A" | "B" | "C" | "D" | null)[]) => grades.map((g, i) => ({ ...SITES[i]!, speed: { status: g ? ("needs_work" as const) : ("off" as const), grade: g, gradeDevice: g ? ("mobile" as const) : null } }));

  it("exits 1 when a site is below the minimum, with the reason in plain words", async () => {
    const r = await cli(["check", "--min-grade", "B"], { linked: false, fake: { sites: sites(["A", "B", "D"]), detail: { prj_pricing: speed("D", { lcpMs: 4600, inpMs: 150, cls: 0.05 }) } } });
    expect(r.code).toBe(1);
    expect(r.out.split("\n")).toEqual([
      "",
      "  ✓ northwind.io           A",
      "  ✓ docs.northwind.io      B",
      "  ✗ pricing.northwind.io   D   needs B · slow to show content on phones",
      "",
      "  1 of 3 sites is below B. Exit code 1.",
    ]);
  });

  it("exits 0 when every site is at the minimum or better; a site without speed data is skipped", async () => {
    const r = await cli(["check", "--min-grade", "B"], { linked: false, fake: { sites: sites(["A", "B", null]) } });
    expect(r.code).toBe(0);
    expect(r.out).toContain("  – pricing.northwind.io   –   no speed data, skipped");
    expect(r.out).toContain("All 3 sites are at B or better (sites without speed data skipped).");
  });

  it("--require-data fails a site without speed data; other errors never exit 1", async () => {
    expect((await cli(["check", "--require-data"], { linked: false, fake: { sites: sites(["A", null]) } })).code).toBe(1);
    expect((await cli(["check"], { linked: false, signedIn: false })).code).toBe(2);
    expect((await cli(["check"], { linked: false, fake: { status: 500 } })).code).toBe(2);
    expect((await cli(["check", "--min-grade", "E"], { linked: false })).code).toBe(2);
  });

  it("in a linked folder, checks that folder's site only; --json carries the same verdict", async () => {
    const r = await cli(["check", "--min-grade", "A", "--json"], { fake: { detail: { prj_north: speed("A", { lcpMs: 2100, inpMs: 140, cls: 0.04 }) } } });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ minGrade: "A", range: "7d", sites: [{ site: "northwind.io", id: "prj_north", grade: "A", pass: true }], below: 0 });
  });
});

describe("npx lookoutstats login", () => {
  it("opens the approval page, waits, and saves the read-only key to ~/.lookout, readable only by you", async () => {
    const dirs = await folders({ signedIn: false });
    const r = await cli(["login"], { dirs, fake: { tokens: [{ status: "pending" }, { status: "approved", key: KEY, email: "you@northwind.io", workspace: "Northwind" }] } });
    expect(r.code).toBe(0);
    expect(r.opened).toEqual(["https://lookoutstats.com/device?code=BCDF-GHJK"]);
    expect(r.calls[0]).toMatchObject({ method: "POST", path: "/v1/device/code", body: { client: "cli", device: "dev-laptop" } });
    expect(r.out).toContain("  Opening lookoutstats.com to approve this computer…");
    expect(r.out).toContain("  ✓ Signed in as you@northwind.io · workspace Northwind");
    expect(r.out).toContain("  ✓ Read-only key saved to ~/.lookout");
    expect(r.out).toContain("  Try: npx lookoutstats");
    const file = join(dirs.home, ".lookout");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ key: KEY, email: "you@northwind.io", workspace: "Northwind" });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("the key it saves is read-only: login asks only for a sign-in, never for a write key", async () => {
    // The approval makes a read-only key on Lookout's side (the API refuses writes with it: apps/api
    // routes/device-login.test.ts). The command line sends nothing that could ask for more.
    const r = await cli(["login"], { signedIn: false, fake: { tokens: [{ status: "approved", key: KEY, email: null, workspace: null }] } });
    expect(r.calls.map((c) => c.body)).toEqual([{ client: "cli", device: "dev-laptop" }, { deviceCode: "d".repeat(40) }]);
    expect(JSON.stringify(r.calls)).not.toMatch(/write|scope/i);
  });

  it("a denied or expired sign-in says so and saves nothing", async () => {
    const dirs = await folders({ signedIn: false });
    const denied = await cli(["login"], { dirs, fake: { tokens: [403] } });
    expect([denied.code, denied.err]).toEqual([2, "The sign-in was denied in the browser."]);
    const expired = await cli(["login"], { dirs, fake: { tokens: [410] } });
    expect([expired.code, expired.err]).toEqual([2, "The sign-in expired. Run it again."]);
    await expect(readFile(join(dirs.home, ".lookout"), "utf8")).rejects.toThrow();
  });
});

describe("the command line in general", () => {
  it("--help lists the commands; an unknown command or option exits 2", async () => {
    const help = await cli(["--help"]);
    expect(help.out).toContain("npx lookoutstats check");
    expect((await cli(["deploy"])).code).toBe(2);
    expect((await cli(["--colour"])).code).toBe(2);
  });
});
