# Lookout developer tools

Two read-only tools for [Lookout](https://lookoutstats.com), the dashboard for Vercel Web Analytics across all your projects:

- [`packages/cli`](packages/cli): the command line, `npx lookoutstats`.
- [`packages/vscode`](packages/vscode): the extension for VS Code and Cursor.
- [`packages/core`](packages/core): the code both share: the API client, the folder's Vercel link, sign-in, and number formatting.

Both sign in through the browser and get a read-only API key.

```sh
npm install
npm run check      # typecheck, tests, build
```

MIT licence.
