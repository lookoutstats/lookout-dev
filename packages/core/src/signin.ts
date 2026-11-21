import { API_URL, cleanText } from "./api.js";

/** The only page a sign-in opens (security review 2026-11-21): a hostile API can't make the tool open anything else. */
export const DEVICE_URL = /^https:\/\/lookoutstats\.com\/device\?code=[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$/;

// Browser sign-in (Lookout's device flow): ask for a code, open lookoutstats.com/device, and wait while the owner
// approves it there. The answer is a read-only API key named after this computer.

export type DeviceClient = "cli" | "vscode";
export interface DeviceCode { deviceCode: string; userCode: string; verificationUrl: string; expiresIn: number; interval: number }
export interface SignedIn { key: string; email: string | null; workspace: string | null }

export class SignInError extends Error {
  constructor(readonly code: "denied" | "expired" | "network" | "refused", message: string) {
    super(message);
    this.name = "SignInError";
  }
}

export interface SignInDeps {
  fetch?: typeof fetch;
  apiUrl?: string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const post = async (deps: SignInDeps, path: string, body: unknown): Promise<Response> => {
  try {
    return await (deps.fetch ?? fetch)(`${deps.apiUrl ?? API_URL}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new SignInError("network", "Couldn’t reach Lookout. Check your connection and try again.");
  }
};

/** The computer's name as the approval page shows it: the host name's first label ("Studio-MBP-3.lan" → "Studio-MBP-3"). */
export const deviceName = (host: string) => host.split(".")[0]!.slice(0, 40) || "computer";

export async function startSignIn(client: DeviceClient, device: string, deps: SignInDeps = {}): Promise<DeviceCode> {
  const res = await post(deps, "/v1/device/code", { client, device: deviceName(device) });
  if (!res.ok) throw new SignInError("refused", `Lookout refused the sign-in (${res.status}). Try again in a minute.`);
  const code = (await res.json()) as DeviceCode;
  if (!DEVICE_URL.test(code.verificationUrl)) throw new SignInError("refused", "Lookout answered with an unexpected sign-in page. Try again.");
  return code;
}

/** Waits for the approval; the key, or a SignInError (denied, expired). */
export async function waitForApproval(code: DeviceCode, deps: SignInDeps = {}): Promise<SignedIn> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? Date.now;
  const until = now() + code.expiresIn * 1000;
  while (now() < until) {
    await sleep(code.interval * 1000);
    const res = await post(deps, "/v1/device/token", { deviceCode: code.deviceCode });
    if (res.status === 403) throw new SignInError("denied", "The sign-in was denied in the browser.");
    if (res.status === 410) throw new SignInError("expired", "The sign-in expired. Run it again.");
    if (res.status === 429) continue;
    if (!res.ok) throw new SignInError("refused", `Lookout answered ${res.status}. Try again.`);
    const body = (await res.json()) as { status: "pending" } | ({ status: "approved" } & SignedIn);
    if (body.status === "approved") return cleanText({ key: body.key, email: body.email ?? null, workspace: body.workspace ?? null });
  }
  throw new SignInError("expired", "The sign-in expired. Run it again.");
}
