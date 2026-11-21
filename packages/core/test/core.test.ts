import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bars, below, change, compact, deviceName, figuresFor, findLink, matchesRoute, routeOfFile } from "@lookout-dev/core";

const tmp = () => mkdtemp(join(tmpdir(), "lookout-core-"));
const put = async (path: string, body: unknown) => {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(body));
};

describe("finding the folder's site", () => {
  it("reads .vercel/project.json; none means not linked", async () => {
    const dir = await tmp();
    expect(await findLink(dir)).toBeNull();
    await put(join(dir, ".vercel", "project.json"), { projectId: "prj_a", orgId: "team_1" });
    expect(await findLink(dir)).toMatchObject({ projectId: "prj_a", source: ".vercel/project.json" });
  });

  it("a monorepo's .vercel/repo.json: the project holding the open file, or the only one", async () => {
    const dir = await tmp();
    await put(join(dir, ".vercel", "repo.json"), { orgId: "team_1", projects: [{ id: "prj_web", name: "web", directory: "apps/web" }, { id: "prj_docs", name: "docs", directory: "apps/docs" }] });
    expect(await findLink(dir, join(dir, "apps", "docs", "app", "page.tsx"))).toMatchObject({ projectId: "prj_docs", root: join(dir, "apps", "docs") });
    expect(await findLink(dir, join(dir, "README.md"))).toBeNull(); // two projects, no file in either: ask
  });

  it("apps/* with their own links: the one holding the file; a garbled file is no link", async () => {
    const dir = await tmp();
    await put(join(dir, "apps", "web", ".vercel", "project.json"), { projectId: "prj_web" });
    await put(join(dir, "apps", "admin", ".vercel", "project.json"), { projectId: "prj_admin" });
    expect(await findLink(dir, join(dir, "apps", "admin", "app", "page.tsx"))).toMatchObject({ projectId: "prj_admin" });
    expect(await findLink(dir)).toBeNull();
    const bad = await tmp();
    await mkdir(join(bad, ".vercel"), { recursive: true });
    await writeFile(join(bad, ".vercel", "project.json"), "{not json");
    expect(await findLink(bad)).toBeNull();
  });
});

describe("Next.js files to page addresses (the code hint)", () => {
  const root = "/p";
  it.each([
    ["/p/app/page.tsx", "/"],
    ["/p/app/pricing/page.tsx", "/pricing"],
    ["/p/src/app/(marketing)/blog/[slug]/page.tsx", "/blog/[slug]"],
    ["/p/app/@modal/login/page.tsx", null],
    ["/p/app/_parts/x/page.tsx", null],
    ["/p/app/pricing/layout.tsx", null],
    ["/p/pages/index.tsx", "/"],
    ["/p/pages/docs/[...rest].tsx", "/docs/[...rest]"],
    ["/p/pages/_app.tsx", null],
    ["/p/pages/api/hello.ts", null],
    ["/elsewhere/app/page.tsx", null],
  ])("%s → %s", (file, route) => expect(routeOfFile(root, file)).toBe(route));

  it("matches addresses to patterns, and sums a dynamic route's pages", () => {
    expect(matchesRoute("/blog/[slug]", "/blog/hello")).toBe(true);
    expect(matchesRoute("/blog/[slug]", "/blog")).toBe(false);
    expect(matchesRoute("/docs/[...rest]", "/docs/a/b")).toBe(true);
    expect(matchesRoute("/[[...all]]", "/")).toBe(true);
    expect(matchesRoute("/pricing", "/pricing?ref=x")).toBe(true);
    const pages = [{ path: "/blog/a", visitors: 30, previousVisitors: 20, change: 50 }, { path: "/blog/b", visitors: 10, previousVisitors: 20, change: -50 }, { path: "/", visitors: 99, previousVisitors: 99, change: 0 }];
    expect(figuresFor("/blog/[slug]", pages, [{ route: "/blog/[slug]", lcpMs: 2900 }])).toEqual({ visitors: 40, change: 0, lcpMs: 2900 });
    expect(figuresFor("/about", pages, [])).toBeNull();
  });
});

describe("formatting", () => {
  it("numbers, changes, bars and grades as the design writes them", () => {
    expect([compact(13912), compact(3483), compact(1_250_000)]).toEqual(["13.9K", "3,483", "1.3M"]);
    expect([change(9.6), change(-31), change(212), change(null)]).toEqual(["▲ 9.6%", "▼ 31.0%", "▲ 212%", "–"]);
    expect(bars([1, 1, 1])).toBe("▄▄▄");
    expect([below("D", "B"), below("B", "B"), below("A", "B")]).toEqual([true, false, false]);
    expect([deviceName("Studio-MBP-3.lan"), deviceName("ci-runner"), deviceName("")]).toEqual(["Studio-MBP-3", "ci-runner", "computer"]);
  });
});
