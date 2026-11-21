import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

// Which site a folder is: the folder's Vercel link, written by Vercel's own CLI (`vercel link`).
//   1. <folder>/.vercel/project.json — { projectId, orgId }
//   2. <folder>/.vercel/repo.json (a monorepo, `vercel link --repo`) — { projects: [{ id, name, directory }] }: the
//      project whose directory holds the open file, or the only one
//   3. apps/* and packages/* one level down, each with its own .vercel/project.json: the one holding the open file, or
//      the only one
// A folder without any of these isn't linked: the tools ask which site it is and remember the answer.

export interface FolderLink {
  projectId: string;
  /** Where the link came from, for messages. */
  source: string;
  /** The project's own folder (a monorepo app's), for matching files to pages. */
  root: string;
}

const readJson = async (path: string): Promise<unknown> => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return null;
  }
};
const isId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(v);
const inside = (dir: string, file: string | undefined) => !!file && !relative(dir, file).startsWith("..") && !relative(dir, file).startsWith(sep);

async function projectJson(dir: string): Promise<string | null> {
  const j = (await readJson(join(dir, ".vercel", "project.json"))) as { projectId?: unknown } | null;
  return j && isId(j.projectId) ? j.projectId : null;
}

/** The folder's site, from its Vercel link; null when it has none. `file`: the open file, for monorepos. */
export async function findLink(folder: string, file?: string): Promise<FolderLink | null> {
  const own = await projectJson(folder);
  if (own) return { projectId: own, source: ".vercel/project.json", root: folder };

  const repo = (await readJson(join(folder, ".vercel", "repo.json"))) as { projects?: unknown } | null;
  if (repo && Array.isArray(repo.projects)) {
    const projects = repo.projects.flatMap((p: unknown) => {
      const x = p as { id?: unknown; directory?: unknown };
      return isId(x.id) ? [{ id: x.id, dir: join(folder, typeof x.directory === "string" ? x.directory : ".") }] : [];
    });
    // The deepest project folder holding the open file wins (an app inside apps/ over the repo root).
    const hit = projects.filter((p) => inside(p.dir, file)).sort((a, b) => b.dir.length - a.dir.length)[0] ?? (projects.length === 1 ? projects[0] : undefined);
    if (hit) return { projectId: hit.id, source: ".vercel/repo.json", root: hit.dir };
  }

  const found: FolderLink[] = [];
  for (const parent of ["apps", "packages"]) {
    let names: string[] = [];
    try {
      names = (await readdir(join(folder, parent), { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue;
    }
    for (const name of names) {
      const dir = join(folder, parent, name);
      const id = await projectJson(dir);
      if (id) found.push({ projectId: id, source: `${parent}/${name}/.vercel/project.json`, root: dir });
    }
  }
  const byFile = found.find((l) => inside(l.root, file));
  if (byFile) return byFile;
  return found.length === 1 ? found[0]! : null;
}
