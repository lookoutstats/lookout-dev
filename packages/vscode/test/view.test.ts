import { describe, expect, it } from "vitest";
import type { Overview, WorkspaceSite } from "@lookout-dev/core";
import { hintLine, hintText, panelBody, panelHtml, statusText, type PanelState } from "../src/view.js";

// The extension's status bar, side panel and code hint (marketing handoff 2026-11-21), without VS Code.

const overview: Overview = {
  site: { id: "prj_north", name: "northwind-web", domain: "northwind.io" },
  range: "7d",
  granularity: "day",
  visitors: 13912,
  previousVisitors: 12693,
  change: 9.6,
  pageviews: 34780,
  points: [4, 5, 5, 6, 7, 8, 9].map((v, i) => ({ start: `2026-11-${16 + i}T00:00:00.000Z`, visitors: v, previousVisitors: null })),
  pages: [{ name: "/", visitors: 6204, share: 44 }, { name: "/pricing", visitors: 3483, share: 25 }, { name: "/docs", visitors: 2110, share: 15 }],
  deployments: [{ at: "2026-11-21T10:00:00.000Z", message: "x", branch: "fix/hero-copy", state: "ready" }],
  speed: { status: "passing", grade: "A", gradeDevice: "mobile", lcpMs: 2100, inpMs: 140, cls: 0.04, samples: 800, mobile: { lcpMs: 2100, inpMs: 140, cls: 0.04, samples: 500 }, desktop: null },
};
const connected: PanelState = { kind: "connected", overview, linkedBy: "link", now: Date.parse("2026-11-21T12:00:00.000Z") };
const sites = [{ id: "prj_north", domain: "northwind.io", visitors: 13912 }, { id: "prj_pricing", domain: "pricing.northwind.io", visitors: 3483 }] as WorkspaceSite[];
const text = (html: string) =>
  html.replace(/<svg[\s\S]*?<\/svg>/g, "").replace(/<[^>]+>/g, "|").replace(/\|+/g, "|").replace(/\s+/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("the status bar item", () => {
  it("the design's three texts", () => {
    expect(statusText(connected)).toEqual({ text: "Lookout  13.9K ▲ 9.6% · A", on: true });
    expect(statusText({ kind: "signedOut" })).toEqual({ text: "Lookout  Sign in", on: false });
    expect(statusText({ kind: "unlinked", sites })).toEqual({ text: "Lookout  Pick a site", on: false });
  });
});

describe("the side panel", () => {
  it("connected: site, link, visitors with change, grade with its checks, top three pages, last deploy, the two buttons", () => {
    const t = text(panelBody(connected));
    for (const s of ["northwind.io", "Linked to this folder · last 7 days", "Visitors", "13.9K", "▲ 9.6% vs last week", "Feels fast to real visitors", "LCP 2.1s · INP 140ms · CLS 0.04", "Top pages · click to open the file", "/pricing", "3,483", "Last deploy", "fix/hero-copy · 2h ago", "Open in Lookout ↗", "Ask Lookout"]) expect(t).toContain(s);
    expect(panelBody(connected)).toContain('data-msg="openPage" data-path="/pricing"');
  });

  it("signed out: the sign-in button and the read-only promise", () => {
    const t = text(panelBody({ kind: "signedOut" }));
    expect(t).toContain("Sign in to see this project's numbers");
    expect(t).toContain("It gets a read-only key and can't change anything.");
    expect(panelBody({ kind: "signedOut" })).toContain('data-msg="signIn"');
  });

  it("folder not linked: the workspace's sites to pick from", () => {
    const html = panelBody({ kind: "unlinked", sites });
    expect(text(html)).toContain("Which site is this folder?");
    expect(text(html)).toContain("This folder isn't linked to a Vercel project, so pick the site once.");
    expect(html).toContain('data-msg="pick" data-id="prj_pricing"');
    expect(text(html)).toContain("pricing.northwind.io|3,483");
  });

  it("escapes what comes from the API, and runs only its own script", () => {
    const evil = { ...connected, overview: { ...overview, site: { ...overview.site, domain: "<img src=x onerror=alert(1)>" } } } as PanelState;
    expect(panelBody(evil)).not.toContain("<img");
    const html = panelHtml(connected, "abc123", "vscode-resource:");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'nonce-abc123'");
    expect(html.match(/<script/g)).toHaveLength(1);
  });
});

describe("the code hint", () => {
  it("one muted line: path, visitors, change, LCP; parts it lacks are left out", () => {
    expect(hintText("/pricing", { visitors: 3483, change: 18.5, lcpMs: 2900 })).toBe("/pricing · 3,483 visitors · ▲ 18.5% · LCP 2.9s");
    expect(hintText("/about", { visitors: 1, change: null, lcpMs: null })).toBe("/about · 1 visitor");
  });
  it("sits above the page's default export", () => {
    expect(hintLine("import x from 'y'\n\nexport default function PricingPage() {\n}")).toBe(2);
    expect(hintLine("const a = 1")).toBe(0);
  });
});

describe("a linked project that isn't in the workspace", () => {
  it("offers the workspace's sites with the reason", () => {
    const t = text(panelBody({ kind: "unlinked", sites, note: "This folder's Vercel project isn't in your Lookout workspace. Pick its site, or connect its Vercel team at lookoutstats.com." }));
    expect(t).toContain("This folder's Vercel project isn't in your Lookout workspace.");
    expect(t).toContain("northwind.io");
  });
});
