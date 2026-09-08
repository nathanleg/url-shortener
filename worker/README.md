# Worker deploy steps

One-time setup (needs your Cloudflare account — free tier is enough):

```bash
cd worker
npm install
npx wrangler login                     # opens a browser to authorize
npx wrangler kv namespace create LINKS  # prints an "id" — copy it
```

Paste the printed id into `wrangler.toml`, replacing `REPLACE_WITH_KV_NAMESPACE_ID`.

```bash
npx wrangler deploy
```

This prints your Worker URL, e.g. `https://natesurlshortener-api.<your-subdomain>.workers.dev`.
Put that exact URL into `../config.js` as `API_BASE`, then commit and push
so GitHub Pages picks up the change.
