import type { DeviceSpeed, Grade, Speed } from "./api.js";

// Numbers and words as both tools show them (the design's wording; Google's Core Web Vitals thresholds).

export const int = (n: number) => Math.round(n).toLocaleString("en-US");
/** 13.9K from 10,000 up, 1.2M from a million; smaller numbers in full (3,483). */
export const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : int(n));
/** "▲ 9.6%", "▼ 31.0%", "▲ 212%"; "–" with nothing to compare with. */
export function change(pct: number | null | undefined): string {
  if (pct == null) return "–";
  const a = Math.abs(pct);
  return `${pct < 0 ? "▼" : "▲"} ${a >= 100 ? Math.round(a) : a.toFixed(1)}%`;
}
export const ms = (v: number | null) => (v == null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
export const cls = (v: number | null) => (v == null ? "–" : v.toFixed(2));
/** A small bar chart in block characters: ▁▂▂▃▅▆█. */
export function bars(values: number[]): string {
  if (!values.length) return "";
  const lo = Math.min(...values), hi = Math.max(...values);
  const marks = "▁▂▃▄▅▆▇█";
  return values.map((v) => marks[hi === lo ? 3 : Math.round(((v - lo) / (hi - lo)) * 7)]).join("");
}

export type Metric = "lcp" | "inp" | "cls";
const LIMITS: Record<Metric, { good: number; poor: number }> = { lcp: { good: 2500, poor: 4000 }, inp: { good: 200, poor: 500 }, cls: { good: 0.1, poor: 0.25 } };
const value = (d: DeviceSpeed, m: Metric) => (m === "lcp" ? d.lcpMs : m === "inp" ? d.inpMs : d.cls);
export const rate = (m: Metric, v: number) => (v <= LIMITS[m].good ? "good" : v <= LIMITS[m].poor ? "needs work" : "poor");

/** The grade's device figures and how many of the three checks pass on it. */
export function checksOf(speed: Speed) {
  const device = speed.gradeDevice === "desktop" ? speed.desktop : speed.mobile ?? speed.desktop;
  const where = speed.gradeDevice === "desktop" ? "on desktop" : "on phones";
  if (!device) return null;
  const measured = (["lcp", "inp", "cls"] as Metric[]).flatMap((m) => {
    const v = value(device, m);
    return v == null ? [] : [{ metric: m, value: v, rating: rate(m, v) }];
  });
  const firstBad = measured.find((c) => c.rating !== "good")?.metric ?? null;
  return { device, where, measured: measured.length, pass: measured.filter((c) => c.rating === "good").length, firstBad };
}

const BAD: Record<Metric, string> = { lcp: "Slow to show content", inp: "Slow to react to taps", cls: "The page jumps while loading" };
/** "Feels fast to real visitors" or the first failing check, in plain words. */
export function verdict(speed: Speed): string | null {
  const c = checksOf(speed);
  if (!c || !speed.grade) return null;
  return c.firstBad ? `${BAD[c.firstBad]} ${c.where}` : "Feels fast to real visitors";
}
/** "LCP 2.1s · INP 140ms · CLS 0.04" on the grade's device. */
export function vitalsLine(speed: Speed): string {
  const d = speed.gradeDevice === "desktop" ? speed.desktop : speed.mobile ?? speed.desktop;
  return d ? `LCP ${ms(d.lcpMs)} · INP ${ms(d.inpMs)} · CLS ${cls(d.cls)}` : "No speed data";
}

const RANK: Record<Grade, number> = { A: 4, B: 3, C: 2, D: 1 };
export const isGrade = (v: string): v is Grade => v === "A" || v === "B" || v === "C" || v === "D";
/** Whether `grade` is below `min` (D is below B). */
export const below = (grade: Grade, min: Grade) => RANK[grade] < RANK[min];
