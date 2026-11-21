import { relative, sep } from "node:path";

// The code hint (Next.js only, first version): which page address a file is.
//   App Router:   app/pricing/page.tsx → /pricing; (groups) dropped; @slots and _private skipped; [slug] kept as a
//                 pattern; app/page.tsx → /
//   Pages Router: pages/blog/[slug].tsx → /blog/[slug]; pages/index.tsx → /; _app, _document, api/ skipped
// Both under the project's folder or its src/.

const PAGE_FILE = /^page\.(?:tsx|ts|jsx|js|mdx)$/;
const PAGES_EXT = /\.(?:tsx|ts|jsx|js|mdx)$/;

/** The route pattern of a Next.js page file ("/blog/[slug]"), or null when the file isn't a page. */
export function routeOfFile(projectRoot: string, file: string): string | null {
  const rel = relative(projectRoot, file).split(sep);
  if (rel[0] === "..") return null;
  const parts = rel[0] === "src" ? rel.slice(1) : rel;
  const name = parts.at(-1) ?? "";
  if (parts[0] === "app" && PAGE_FILE.test(name)) {
    const segs = parts.slice(1, -1);
    if (segs.some((s) => s.startsWith("@") || s.startsWith("_"))) return null;
    return "/" + segs.filter((s) => !/^\(.*\)$/.test(s)).join("/");
  }
  if (parts[0] === "pages" && PAGES_EXT.test(name)) {
    const segs = [...parts.slice(1, -1), name.replace(PAGES_EXT, "")];
    if (segs[0] === "api" || segs.at(-1)!.startsWith("_")) return null;
    if (segs.at(-1) === "index") segs.pop();
    return "/" + segs.join("/");
  }
  return null;
}

/** Whether a page address ("/blog/hello") matches a route pattern ("/blog/[slug]", "/docs/[...rest]", "/[[...all]]"). */
export function matchesRoute(route: string, path: string): boolean {
  const r = route.split("/").filter(Boolean);
  const p = path.split("?")[0]!.split("/").filter(Boolean);
  for (let i = 0; i < r.length; i++) {
    const seg = r[i]!;
    if (/^\[\[\.\.\..+\]\]$/.test(seg)) return true;
    if (/^\[\.\.\..+\]$/.test(seg)) return p.length > i;
    if (p[i] === undefined) return false;
    if (!/^\[.+\]$/.test(seg) && seg !== p[i]) return false;
  }
  return p.length === r.length;
}

export interface PageFigures { path: string; visitors: number; previousVisitors: number | null; change: number | null }

/** A route's visitors (summed over its addresses), change and LCP, from the site's page list; null with no visits. */
export function figuresFor(route: string, pages: PageFigures[], routes: { route: string; lcpMs: number }[]) {
  const hits = pages.filter((p) => matchesRoute(route, p.path));
  if (!hits.length) return null;
  const visitors = hits.reduce((s, p) => s + p.visitors, 0);
  const prevKnown = hits.every((p) => p.previousVisitors !== null);
  const prev = prevKnown ? hits.reduce((s, p) => s + (p.previousVisitors ?? 0), 0) : null;
  const pct = prev && prev > 0 ? Math.round(((visitors - prev) / prev) * 1000) / 10 : null;
  const lcp = routes.find((r) => r.route === route)?.lcpMs ?? null;
  return { visitors, change: pct, lcpMs: lcp };
}
