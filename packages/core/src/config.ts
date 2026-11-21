import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

// The command line's sign-in: ~/.lookout, a JSON file only its owner can read (0600). It holds the read-only key and
// who approved it. LOOKOUT_API_KEY overrides the key (CI).

export interface Saved {
  key?: string;
  email?: string | null;
  workspace?: string | null;
}

export const configPath = (home: string) => join(home, ".lookout");

export async function readConfig(home: string): Promise<Saved> {
  try {
    const v = JSON.parse(await readFile(configPath(home), "utf8")) as unknown;
    return v && typeof v === "object" ? (v as Saved) : {};
  } catch {
    return {};
  }
}

export async function writeConfig(home: string, next: Saved): Promise<void> {
  const path = configPath(home);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600); // an older file keeps its mode on write
}
