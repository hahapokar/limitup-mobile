# limitupnewapp

A lightweight post-market stock selection app focused on the final loop:

- pull post-market market data
- run factor scoring
- filter and rank Top 8 candidates
- show a clean card-based dashboard in the browser

## Project structure

- `quant_system/core/data_fetcher.py` — real market data fetch and cleaning
- `quant_system/core/scoring.py` — factor scoring and Top 8 ranking
- `quant_system/data/` — cached sentiment and candidate snapshots
- `server.ts` — lightweight Express API for the frontend
- `src/App.tsx` — minimal Top 8 dashboard UI

## Commands

1. Install dependencies:
   `npm install`
2. Run the frontend + API locally:
   `npm run dev`
3. Build the production bundle:
   `npm run build`
4. Start the built server:
   `npm run start`
5. Run the Python scoring flow directly:
   `python3 quant_system/app.py review --date 2026-09-02`
6. Build and synchronize Android:
   `npm run cap:build`
7. Open the Android project in Android Studio:
   `npm run cap:open`
8. Install and type-check the Cloudflare Worker:
   `npm run worker:install`
   `npm run worker:typecheck`

## Automatic date selection

When the app opens, it automatically requests data without requiring a button or command:

- Before 15:30 Beijing time on a trading day: show the previous available trading day's Top 8.
- At or after 15:30: show today's Top 8 when today's snapshot exists.
- On weekends or holidays: show the most recent available trading day's Top 8.

The Node API must be running somewhere reachable by the app. The APK cannot execute `npm`, `node`, or `python3` commands itself. To point a native build at a deployed API, set the URL during the build:

`VITE_API_BASE_URL=https://api.example.com npm run cap:build`

For local browser development, leave `VITE_API_BASE_URL` empty so requests use the local Express server.

## Android Studio release build

1. Install Android Studio with Android SDK Platform 36, Android SDK Build-Tools, and a Java 21 JDK. In Android Studio, set Gradle JDK to Java 21 under **Settings > Build, Execution, Deployment > Build Tools > Gradle**.
2. Run `npm install` and `npm run cap:build` from the project root.
3. Run `npm run cap:open`, or open the `android/` folder directly in Android Studio.
4. Let Gradle sync finish, then select the `app` module.
5. For a signed package, choose **Build > Generate Signed Bundle / APK**, create or select a keystore, choose `release`, and generate either an AAB for Google Play or an APK for direct installation.

The generated files are under `android/app/build/outputs/bundle/release/` for AAB and `android/app/build/outputs/apk/release/` for APK.

## Notes

- The app intentionally removes intraday trading, mock portfolio management, and real-time buy/sell matching logic.
- The core scoring precision remains intact; only the active workflow is narrowed to post-market Top 8 recommendation generation.
- Cloudflare is only needed when exposing the API publicly: proxy the API over HTTPS, keep the Node/Python service running server-side, and set `VITE_API_BASE_URL` to that public API origin. No Cloudflare setting is needed for a local Android build.
- The local API listens on port `3008` by default. Override it with `PORT=3008` or another available port.

## Public access with Cloudflare Tunnel

The recommended production layout is `Android APK -> Cloudflare HTTPS -> cloudflared -> Node API :3008`. The Python data job and Node API stay on the server; do not deploy this API as a static Cloudflare Pages site.

1. Add a domain to Cloudflare and make its nameservers point to Cloudflare.
2. On the machine running this project, install `cloudflared` and authenticate:
   `cloudflared tunnel login`
3. Create a named tunnel:
   `cloudflared tunnel create limitup-api`
4. Create `~/.cloudflared/config.yml`:

   ```yaml
   tunnel: YOUR_TUNNEL_UUID
   credentials-file: /Users/YOUR_USER/.cloudflared/YOUR_TUNNEL_UUID.json
   ingress:
     - hostname: api.example.com
       service: http://localhost:3008
     - service: http_status:404
   ```

5. Route the hostname and run the tunnel:
   `cloudflared tunnel route dns limitup-api api.example.com`
   `cloudflared tunnel run limitup-api`
6. Keep the Node API running on the server with `npm run start` (use `launchd`, `systemd`, or Docker for automatic restart).
7. Allow the Capacitor origin in the API process and build the APK with the public API origin:
   `CORS_ORIGINS=https://localhost npm run start`
   `VITE_API_BASE_URL=https://api.example.com npm run cap:build`

Cloudflare Tunnel automatically provides HTTPS, so the Android app should use `https://api.example.com`. No inbound firewall rule for port `3008` is needed. The API server's `3008` port only needs to be reachable locally by `cloudflared`.

## Serverless Cloudflare Worker

For a deployment with no always-on computer, use the new `worker/` project instead of the Tunnel setup above. It replaces the Node API with a Worker, stores snapshots in KV, and runs the selection job from a Cloudflare Cron trigger. Create two KV namespaces, put their IDs in `worker/wrangler.toml`, then deploy:

`cd worker && npx wrangler kv namespace create SNAPSHOTS`

`cd worker && npx wrangler kv namespace create SNAPSHOTS --preview`

Replace both placeholder IDs in `worker/wrangler.toml`, then run:

`npm run worker:deploy`

Build the Android app against the Worker URL:

`VITE_API_BASE_URL=https://limitup-api.YOUR_SUBDOMAIN.workers.dev npm run cap:build`

The Worker implementation uses the EastMoney HTTP endpoint and preserves the Python hard filters, percentile ranking, factor weights, and Top 8 sorting. Its market-wide sentiment fields are explicitly marked `partial_market_overview` until a licensed market overview data source is configured; it does not invent those values.
