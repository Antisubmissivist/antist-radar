# Antist Radar

An independent, evidence-led radar for Japan and the world. Public information is organized around changes, decisions and verifiable forecasts, with native Japanese, English and Chinese editions.

Built on [Crucix](https://github.com/calesthio/Crucix) under AGPL-3.0. The Node.js engine lives in `engine/`; the Hono / Tailwind Cloudflare Worker lives in `site/`.

## Development

Use Node.js 22 or later. Run `npm ci`, `npm test`, `npm run build`, and `npm run check`. Configure private engine credentials in `engine/.env`; never commit environment files or runtime snapshots. Deploy bindings are in `site/wrangler.jsonc`.

The public dataset excludes personal positions, precise locations, individual matching criteria, credentials and upstream error bodies. A failed source is explicitly marked unavailable; it is never presented as an uneventful day. Forecasts retain their original evidence and resolve against fresh observations after their deadline.

## Automation

The sweep workflow collects hourly; deployment runs when site or shared publication code changes. Runtime data is published through an authenticated Worker ingestion route, archived in R2 and recorded in D1. Never run integration tests against a production destination without configuring that destination intentionally.
