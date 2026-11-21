// A small client of Lookout's public API (api.lookoutstats.com/v1), for the fields the tools show. The full document is
// https://api.lookoutstats.com/v1/openapi.json; lookout-mcp has a generated client of all of it.

export const API_URL = "https://api.lookoutstats.com";
export const APP_URL = "https://lookoutstats.com";

export type Grade = "A" | "B" | "C" | "D";
export type SpeedStatus = "passing" | "needs_work" | "poor" | "off";
export interface DeviceSpeed { lcpMs: number | null; inpMs: number | null; cls: number | null; samples: number }
export interface Speed extends DeviceSpeed { status: SpeedStatus; grade: Grade | null; gradeDevice: "mobile" | "desktop" | null; mobile: DeviceSpeed | null; desktop: DeviceSpeed | null }
export interface Ranked { name: string; visitors: number; share: number }
export interface Overview {
  site: { id: string; name: string; domain: string };
  range: string;
  granularity: "hour" | "day";
  visitors: number;
  previousVisitors: number | null;
  change: number | null;
  pageviews: number;
  points: { start: string; visitors: number; previousVisitors: number | null }[];
  pages: Ranked[];
  deployments: { at: string; message: string | null; branch: string | null; state: string }[] | null;
  speed: Speed;
}
export interface WorkspaceSite {
  id: string;
  name: string;
  domain: string;
  visitors: number;
  previousVisitors: number | null;
  change: number | null;
  pageviews: number;
  speed: { status: SpeedStatus; grade: Grade | null; gradeDevice: "mobile" | "desktop" | null };
}
export interface WorkspaceSites { range: string; sites: WorkspaceSite[]; unavailable: string[] }
export interface SiteDetail { site: { id: string; name: string; domain: string }; range: string; speed: Speed }
export interface SitePages { site: { id: string; name: string; domain: string }; range: string; pages: { path: string; visitors: number; previousVisitors: number | null; change: number | null }[]; routes: { route: string; lcpMs: number; samples: number }[] }
export interface BoardSites { board: { id: string; name: string }; range: string; sites: { id: string; domain: string }[]; unavailable: string[] }
export type Range = "24h" | "7d" | "30d";

/** An error answer: its HTTP status and Lookout's error code. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  key: string;
  apiUrl?: string;
  fetch?: typeof fetch;
  userAgent?: string;
}

export function createClient({ key, apiUrl = API_URL, fetch: f = fetch, userAgent = "lookout-dev" }: ClientOptions) {
  async function get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await f(`${apiUrl}${path}`, { headers: { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": userAgent }, signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new ApiError(0, "network", "Couldn’t reach Lookout. Check your connection and try again.");
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      throw new ApiError(res.status, body?.error?.code ?? `http_${res.status}`, body?.error?.message ?? `Lookout answered ${res.status}`);
    }
    return (await res.json()) as T;
  }
  const q = (range: Range) => `range=${range}`;
  const id = encodeURIComponent;
  return {
    overview: (site: string, range: Range) => get<Overview>(`/v1/sites/${id(site)}/overview?${q(range)}`),
    site: (site: string, range: Range) => get<SiteDetail>(`/v1/sites/${id(site)}?${q(range)}`),
    pages: (site: string, range: Range) => get<SitePages>(`/v1/sites/${id(site)}/pages?${q(range)}`),
    sites: (range: Range) => get<WorkspaceSites>(`/v1/sites?${q(range)}`),
    boardSites: (board: string, range: Range) => get<BoardSites>(`/v1/boards/${id(board)}/sites?${q(range)}`),
  };
}
export type Client = ReturnType<typeof createClient>;

/** The site's page in Lookout. */
export const siteUrl = (siteId: string) => `${APP_URL}/projects/${encodeURIComponent(siteId)}`;
