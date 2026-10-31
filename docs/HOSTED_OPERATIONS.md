# PaperBet hosted operations

## Independent deployment

URL: https://paperbet-parks.diladiop.chatgpt.site

Project: `appgprj_6ae649c281f88191908046279dd1e693`. Owner-private Sites access; normal visitors sign in with ChatGPT. This is independent of Little Big Arcade. Do not reuse an arcade project, database or source tree. Do not make this Site public without securing the service updater separately.

Worker source is `worker/index.js`, durable ledger adapter `worker/d1-store.js`. The original UI, domain math and ESPN adapter are reused, not replaced with a mock. `scripts/build-worker.js` embeds the existing public assets and bundles only dependency-free Worker-compatible code. Node/SQLite remains an optional deployment target.

D1 batches are transactional. Placement is one statement with database triggers that validate ownership, active session and funds, debit balance and insert the stake ledger atomically. A unique user/request key makes retries idempotent. Conditional final updates plus settlement triggers prevent duplicate payouts across Workers. A database lease serializes background checks; expired leases recover after crashes. No browser/localStorage bankroll is authoritative. Migrations are committed in `drizzle/`; never edit an applied migration.

Hosted visitors use the platform's Site-scoped identity, preserving ledgers across page reloads and sign-in sessions. Authorized service probes without visitor identity use the existing style of signed HttpOnly/Secure/SameSite browser cookie. SESSION_SECRET is configured as a hosted secret, not committed. Physical Safari/PWA sign-in sharing still needs device testing. Exports are records, not an automatic restore facility. Hosted administrative reconciliation is deliberately unavailable; exceptional results remain unresolved. The original Node edition retains its audited administrator reconciliation implementation.

## Background settlement

The stateless Worker does not keep a Node interval alive and no native Worker cron is claimed. A separate Sites cloud task is intended to run hourly, calling `settle_paperbet`, then reading `paperbet_health`. Both MCP tools are provided by this private Site. It fetches actual ESPN summaries; it accepts no client-supplied result. No browser needs to be open. Configuration/observed run details are recorded in the delivery report after deployment.

Each call checks at most 20 due events, four concurrent network requests, selecting least-recently-checked events first. Run again if health reports remaining eligible work. Checks retry on the next task run after outage. `checkedAt`, error and remaining work are persisted in D1 and shown in Settings. A lease expires after two minutes if interrupted. Scheduled tasks may run late or fail; neither scheduler nor public feed provides a guaranteed SLA. A stale health timestamp must be investigated; visiting the page is not the scheduler. Repeated or missing finals never generate a loss or a fabricated void.

The private service endpoint `POST /api/admin/settle` is an alternative to the MCP tool. It is protected by Sites' owner-private dispatch boundary, not an embedded/public bearer secret. The service caller obtains its current token from Sites and sends it only as `OAI-Sites-Authorization` to this Site. Do not persist tokens in prompts, files, logs or source. MCP has the same owner-private boundary and exposes no user-balance edit or result override.

## Source and limits

ESPN's public endpoint has no key, contracted availability, source-price timestamp guarantee or redistribution license implied by accessibility. Markets are shown only when actual complete published moneyline outcomes exist. Soccer requires an explicit draw price. Prices are rechecked before acceptance; changes require a new explicit action. Retrieval timestamps are not bookmaker freshness guarantees. Date coverage is today through seven days ahead, fetched by UTC day; unavailable daily pages fail the whole league rather than silently claiming full coverage.

The checked coverage table is a momentary observation, not a promise of future markets. Sports-season and bookmaker coverage vary. Actual NBA summary parsing is independently observed. Soccer extra-time ambiguity and exceptional abandonment/rescheduling rules stay unresolved. No real money, prizes or bookmaker access are involved.

## Parlay ledger

Migration 0002 adds per-leg records without changing previous wagers or balances. Placement batches parent plus legs under one transaction and one existing debit trigger. Settlement stores each actual final against its original event and period, then conditionally pays the parent once. The hourly updater handles both singles and leg IDs; interruption recovery aggregates ready tickets on the next run. Combined virtual odds multiply the published singles; no same-game pricing is inferred. The optional Node edition remains single-only.

## Checks and deployment

Run `npm test` for original Node tests and new D1/Worker tests using real SQLite with a D1-shaped async adapter. These are deterministic fixtures confined to tests, not proof of real scheduled future outcomes. Build `npm run build:worker`; syntax-check `dist/server/index.js`. Publish the pushed source and archive through Sites. Production D1/migration/feed/request behavior is checked separately after deployment.

Do not seed production test fixtures or change event clocks to manufacture a settled live bet. A real accepted future-event practice bet cannot be certified as paid correctly until the genuine event finishes. Physical iPhone Safari/Add to Home Screen, touch keyboard, OAuth persistence and long-term scheduler uptime remain separately disclosed checks.
