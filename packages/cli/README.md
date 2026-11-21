# lookoutstats

Lookout for the terminal. It shows the Vercel Web Analytics and Speed Insights numbers for the project in the current folder. It is read-only.

```sh
npx lookoutstats login     # approve this computer in the browser once
npx lookoutstats           # this folder's site: visitors, page views, speed grade, top pages
```

## Commands

| Command | What it does |
|---|---|
| `npx lookoutstats` | Shows this folder's site for the last 7 days. |
| `npx lookoutstats sites` | Shows every site in the workspace as a table. Add `--board "name"` to show one board. |
| `npx lookoutstats check --min-grade B` | Lists each site's speed grade. Exits with code 1 when a site is below the minimum. |
| `npx lookoutstats login` | Opens the browser to approve this computer. Saves a read-only key to `~/.lookout`. |
| `npx lookoutstats logout` | Removes the key from this computer. |

Add `--json` to any command to get the numbers as JSON. Add `--range 24h`, `7d` or `30d` to change the period.

## Which site

The tool reads the folder's Vercel link, `.vercel/project.json`, which `vercel link` writes. In a monorepo it also reads `.vercel/repo.json` and `apps/*` or `packages/*`. Without a link, give the site: `--site <id or domain>`, or set `LOOKOUT_SITE`.

## In CI

Create a read-only key in Lookout, Settings › API & MCP. Set it as `LOOKOUT_API_KEY`. CI checkouts have no Vercel link, so set `LOOKOUT_SITE` or use `--site`.

The speed grade comes from real visits to what is already live. A build step cannot test the new build. Run `check` after a deploy, or on a schedule.

- Exit code 0: every graded site is at the minimum grade or better.
- Exit code 1: one or more sites are below the minimum grade.
- Exit code 2: the command could not run (not signed in, no such site, network error).

A site without speed data (Speed Insights off, or under 50 page loads) is skipped. Add `--require-data` to fail it.

## Licence

MIT. Lookout is not affiliated with Vercel Inc.
