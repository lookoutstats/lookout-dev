# Lookout for Vercel Analytics

Vercel Web Analytics and Speed Insights for the project you have open in VS Code or Cursor. It is read-only.

- **Status bar:** the site's visitors for the week, the change, and the speed grade. Click it to open the panel.
- **Side panel:** visitors with a small chart, the speed grade with LCP, INP and CLS, the top three pages (click one to open its file), the last deploy, and a link to the site in Lookout.
- **Code hint:** one line above each Next.js page's code with that page's visitors, change and LCP.

## Sign in

Click **Sign in to Lookout** in the panel. The browser opens lookoutstats.com to approve this editor. The extension gets a read-only key and keeps it in the editor's secret storage. It cannot deploy or change settings. You can revoke the key in Lookout, Settings › API & MCP.

## Which site

The extension reads the folder's Vercel link, `.vercel/project.json`, which `vercel link` writes. In a monorepo it reads `.vercel/repo.json`, or `apps/*` and `packages/*`, and uses the project that holds the open file. A folder without a link shows your sites. Pick one, and the extension remembers it for that folder.

## Settings

- `lookout.range`: `24h`, `7d` (default) or `30d`.
- `lookout.codeHints`: show the code hint (default on). The hint supports the Next.js App Router and Pages Router.

## Licence

MIT. Lookout is not affiliated with Vercel Inc.
