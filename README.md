# PaperBet

Independent, mobile-first virtual-money sportsbook. No Little Big Arcade source, assets, database, or deployment is used. No real deposits, withdrawals, purchases, or prizes.

## Current delivery status

Implemented runnable Node 24 application with a persistent SQLite ledger, background settlement, key-free ESPN public-feed adapter, optional The Odds API adapter, single moneylines, journals, session resets, stats, JSON exports and PWA shell. **Not deployed.** Live ESPN NFL scoreboard accessibility and published moneyline fields were checked through web research; end-to-end runtime access, coverage across all leagues, mobile Safari and Home Screen installation remain unverified. No real-world bet was placed or settled during development. Automated fixtures are restricted to tests and never loaded by the production application.

## Run

Requires Node.js 24 or later. No npm dependencies or installation required.

1. Configure a stable random `SESSION_SECRET` of at least 32 characters in your server's secret manager. Keep it unchanged across restarts.
2. Optionally configure a strong `ADMIN_TOKEN` for reconciliation.
3. Run `npm start`. The app listens on port 3000 (override `PORT`).
4. Open the server through HTTPS for secure cookies and iPhone PWA installation. For local development only, use http://localhost:3000 with NODE_ENV unset.

Default `DATA_PROVIDER=espn` needs **no API key, paid account, or data subscription**. It still makes server-side HTTP requests to a public feed. It is not an offline data source.

`npm test` runs deterministic ledger, adapter, and API-handler integration tests. `npm run build` packages the standalone production server into `dist/`. JavaScript syntax checks can be run with `node --check` on source files. See `.env.example` for configuration names. The server does not load .env files automatically; Node's `--env-file` option or a hosting secret manager can supply them.

## Key-free real data

Default source: ESPN public scoreboard and event-summary feeds at `site.api.espn.com`. Genuine published moneyline prices are read from `competitions[].odds[].moneyline.{home,away,draw}.close.odds`; spread and total fields are never converted into moneylines. The adapter accepts only complete two-way or soccer three-way quotes for scheduled future events. It records the published bookmaker and stable ESPN event and team identifiers. No betting links or provider branding assets are copied into the app.

On October 31, 2026 the NFL feed exposed upcoming fixtures with DraftKings moneylines. Availability in other configured leagues is not guaranteed. Missing moneylines, missing soccer draws, unavailable feeds, and changed schemas result in an unavailable screen rather than generated prices.

**Important source limitations:** ESPN's public endpoints are undocumented and have no contracted SLA or guaranteed redistribution permission. Public access is not a commercial data license; review applicable terms before public distribution. The feed's price fields do not certify a sportsbook publication timestamp. PaperBet reports **retrieval time**, re-fetches quotes immediately before placement, rejects HTTP cache ages above 120 seconds, and requires acceptance of price changes. This cannot certify that a bookmaker's own price has updated recently. A documented licensed provider is needed if strict source-timestamp guarantees or commercial reliability are required. No claim is made that the key-free feed meets those guarantees.

Official public source inspected: https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard

Extensible league mappings cover NFL, NCAAF, NBA, NCAAB, MLB, NHL, Premier League, Champions League, La Liga, Bundesliga, Serie A, Ligue 1 and MLS. Configuration means the adapter can query a league; it is not a promise that moneylines are available. Event dates display in the device's local timezone.

An optional documented provider adapter is retained for `DATA_PROVIDER=odds-api`, requiring `ODDS_API_KEY`. See https://the-odds-api.com/liveapi/guides/v4/ . Its docs specify stable matching event IDs and a three-day completed-score window. Coverage is limited to selected sports. An active sport listing does not prove scores access or account entitlement. Verify current pricing and terms directly; this build does not assume free access. The paid adapter defaults to one region and moneyline only. Cached browsing reduces requests, but each accepted-bet verification bypasses the cache.

## Ledger and sessions

Amounts are integer USD cents. Fractional-cent payouts round once to the nearest cent. Stakes debit on acceptance; winning total returns credit once; losses pay zero; confirmed voids refund the stake. Accepted decimal odds are immutable and American odds are derived for display. A unique per-user request ID and immediate SQLite transactions prevent double-tap deductions and repeated settlement payouts. Single bets have an immutable market JSON snapshot with team/outcome IDs and period rules, leaving space for future bet legs.

Balances, sessions, transactions, bets, final result snapshots and reconciliation audit records live on the server. Each browser has a signed HttpOnly SameSite session cookie, Secure in production. No account is required. Other browsers receive isolated ledgers; cross-device account sync and self-service session recovery are not implemented. Clearing cookies loses access to that anonymous ledger. Safari/PWA cookie sharing varies by installation and iOS version and must be physically verified. Export records regularly. A JSON export is a data backup, not a login credential or an automated import feature.

Starting a new session archives the old session. Open bets in old sessions continue to settle there. Current bankroll is available balance; open stakes are not treated as losses in performance metrics. ROI divides settled net profit by settled stakes and excludes voids. Win rate excludes void and unsettled bets. Filters apply to performance; bankroll history shows the full selected session and is labeled accordingly.

## Settlement and recovery

The Node process checks eligible open/live/unresolved bets every five minutes and on startup. It runs without an open browser, **provided the host keeps the process running**. Only bets whose scheduled start has arrived are polled. ESPN event summaries are queried by stable provider event ID, including older events for outage recovery. Missing finals remain unresolved. Canceled, suspended, postponed and abandoned states do not automatically imply refunds: an administrator must verify the market's applicable void policy. Scheduling time alone never settles a bet.

Market definitions: NBA/NCAAB/NFL/NCAAF include overtime, NHL includes overtime/shootout, MLB includes extra innings; NFL ties void. Other unexpected two-way ties remain unresolved. Soccer uses regulation plus stoppage time and excludes extra time/penalties. When explicit period scores are present, only periods 1 and 2 count. Champions League or extra-time events without sufficiently explicit regulation scoring remain unresolved. Displayed bookmaker rules can differ in exceptional circumstances (shortened baseball, abandonment, rescheduling, etc.); those require reconciliation. Generic final data does not establish every bookmaker exception. This MVP is not a complete bookmaker rules engine.

The optional Odds API adapter uses its completed scores with a three-day lookback and stores observed results. Five-minute checks cost up to 576 credits/day per continuously pending league when completed-score requests cost two credits, before odds browsing. A small free quota is unlikely to support continuous multi-league use. If the host is down beyond the retention window, reconcile older unresolved bets using an independently verified source. Never assume missing scores mean a loss.

Run a single continuously active instance over one persistent SQLite volume. An external scheduler can also call `POST /api/admin/settle` with `Authorization: Bearer <ADMIN_TOKEN>` and `Content-Type: application/json` and body `{}`. This triggers checks; it never supplies a simulated outcome.

`POST /api/admin/reconcile` requires the same admin token and a JSON body containing `requestId` (16–100 word/hyphen characters), `reason`, `source` and a verified `result`. The result includes `id` (the accepted event ID), `sport_key`, `period`, `status`, `completed`, `authoritative` and two `scores` entries with names and integer scores. A verified void instead requires `status: "canceled"`, `"abandoned"` or `"voided"`, `authoritative: true` and `voidConfirmed: true`. Only an administrator should certify these fields after consulting the actual source. The request ID deduplicates reconciliation; audit logs preserve old/new results and reason. Corrections append ledger deltas rather than rewriting past transactions. If reversing an already-spent payout would make the session negative, reconciliation is blocked for manual review instead of violating bankroll constraints.

## Standalone HTTPS deployment

Use an always-on Node/Docker host with a persistent volume (for example a small VPS behind Caddy, or a container platform supporting persistent disks). Hosting fees depend on the chosen service; no free-hosting promise is made.

- Build the included Dockerfile or deploy `dist/` with `node server.js`.
- Mount durable storage at `/data` and set `DATABASE_PATH=/data/paperbet.sqlite`.
- Set `NODE_ENV=production`, stable `SESSION_SECRET`, optional `ADMIN_TOKEN`, and `DATA_PROVIDER=espn`.
- Put the app behind HTTPS. Keep the origin header and forwarded protocol accurate through a trusted proxy.
- Use one replica, enable automatic restarts, and disable sleeping. A sleeping free web host does not provide dependable settlement.
- Restrict admin access at the reverse proxy as well as by bearer token; rate-limit requests at the proxy for public deployment.
- Back up SQLite consistently using SQLite's online backup facility; do not copy an active main database file while ignoring its WAL. Encrypt backups and test restoration. Preserve the session secret.
- Check `/api/state` for settlement health. Alert on missed checks and unresolved bets. Monitor public feed availability/schema changes.

The available Sites hosting integration targets Cloudflare Workers; this standalone Node/SQLite server is not a compatible Worker artifact. No unrelated Site was created or replaced. A separate compatible Node host or a port to Worker/D1 is required before a deployment URL can be supplied.

## Verification limits

Automated tests cover mathematical payouts, persistence after DB reopen, win/loss/void processing, missing/postponed finals, soccer draw/period rules, NFL ties, stale price rejection, provider outage, request deduplication, odds changes, isolation, reset sessions, reconciliation and key-free feed parsing. API integration tests exercise real request handlers in-process so they run in environments restricting listening ports. Background settlement is invoked independently of any browser.

No live-provider end-to-end bet or actual result settlement was claimed. Mobile Safari rendering, touch behavior, physical iPhone Home Screen install, cookie persistence between Safari/PWA contexts, HTTPS delivery and production scheduled uptime require deployment/device checks. Service workers cache only the application shell, never account APIs or prices; betting requires connectivity. Charts expose focusable points, but physical touch interaction needs verification.
