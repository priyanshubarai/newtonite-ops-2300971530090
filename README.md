# Newtonite Operations Under Pressure

An internal operational work-management application designed to replace fragmented coordination through chat, spreadsheets, email, and direct conversations. It enables teams to create, assign, track, discuss, approve, resolve, and close operational work while maintaining a complete audit trail of all decisions and changes.

## Project Overview

Newtonite Operations Under Pressure helps users understand:
- What work exists and why
- Current status and priority
- Current ownership
- Historical changes and decisions
- What requires attention next

### Supported Work Item Types
- Incident
- Customer issue
- Payment investigation
- Compliance request
- Task

### Expected Scale
- Thousands of registered users
- Hundreds to a few thousand simultaneous users
- Multiple teams
- Tens of thousands of active work items
- Large and continuously growing activity history

## Approved Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React + TypeScript | User interface |
| Frontend State Management | TanStack Query | Server state fetching, caching, and synchronization |
| Backend | Node.js + Express + TypeScript | REST API server |
| Database | PostgreSQL (hosted on Neon) | Source of truth for all business data |
| ORM | Drizzle ORM | Type-safe schema definitions and queries |
| Migration Tooling | Drizzle Kit | Database schema migrations |
| Testing | Vitest + Supertest | Unit and integration testing |
| Local Development | Docker Compose | Local environment orchestration |

**Constraints:** Prisma is prohibited. Architecture is a modular monolith.

### Database Provider (Neon)

PostgreSQL is hosted on **Neon**. The `DATABASE_URL` environment variable supplies the Neon connection string.

- **Runtime driver:** `drizzle-orm/neon-serverless` (Neon WebSocket `Pool` via `@neondatabase/serverless`). Chosen because the later work-item, idempotency, activity-history, and outbox modules require **interactive transactions**. The `neon-http` driver is *not* used because it does not support them.
- **Migration connection:** Drizzle Kit connects directly to Neon over the standard PostgreSQL wire protocol using the same `DATABASE_URL`.
- **Limitation:** Neon's serverless WebSocket pool requires a `WebSocket` constructor in Node.js; the app sets `neonConfig.webSocketConstructor = ws` at startup.

## Key Features

### Dashboard (Operational Views)
1. **Assigned to Me** - Work items assigned to the authenticated user
2. **Unassigned Urgent** - Urgent priority unassigned work items (team-scoped)
3. **Awaiting My Approval** - Work items awaiting approval for authorized Leads (team-scoped)

All views support server-side search, filtering, deterministic ordering, and cursor pagination - with no loading of full datasets into memory.

### Roles & Permissions (Team-Scoped)
| Action | Viewer | Member | Lead | Admin |
|---|---|---|---|---|
| View permitted team items | Yes | Yes | Yes | Yes |
| Create work items | No | Yes | Yes | Yes |
| Edit permitted item fields | No | Yes | Yes | Yes |
| Claim unassigned work | No | Yes | Yes | Yes |
| Approve workflow step | No | No | Yes | Yes |
| Manage team membership | No | No | No | Yes |

*All permissions are scoped to teams. Server-side enforcement is mandatory - hiding UI controls is not an authorization mechanism.*

### Workflow
`Open → In Progress → Awaiting Approval → Resolved → Closed`

- Server enforces allowed transitions
- Only Leads authorized for the item's team may perform approval actions
- Clients cannot bypass by submitting arbitrary status values
- Reopening Closed items is out of scope

### Collaboration & Audit
- Comments on work items
- Append-only activity history (status, assignee, priority changes with before/after values)
- Business mutations and activity events committed in the same PostgreSQL transaction
- Optimistic concurrency via versioning (409 on stale updates)
- Atomic claim (exactly one winner on concurrent attempts; 409 on conflict)
- Idempotency keys for retry-sensitive operations
- Transactional outbox for reliable async processing (bounded retries, idempotent handlers)

## Documentation

- [Assignment Checklist](docs/ASSIGNMENT_CHECKLIST.md) - Complete requirements tracking
- [Architecture](docs/ARCHITECTURE.md) - System design, data model, API inventory, diagrams
- [Implementation Roadmap](docs/IMPLEMENTATION_ROADMAP.md) - 9-phase implementation plan with timeline
- [Engineering Decisions](ENGINEERING_DECISIONS.md) - Five final engineering decisions with rationale

## Current Implementation Status

**Status:** Backend foundation (Phase 1), database schema and seed (Phase 2), authentication + team-scoped authorization (Phase 3), the core work-item API — list, create, detail, update (Phase 4) — and the critical-mutation layer — atomic claim, workflow transitions, optimistic concurrency, idempotency, and transactional activity + outbox (Phase 5) — are implemented and verified. Phase 6 (integration, security, and regression verification) audited Phases 1–5 against the running database and API, fixed two API error-handling defects, and added a focused verification suite that passes against real PostgreSQL. Phase 7 built the React operations dashboard on top of that API: login and session handling, the authenticated shell, a server-filtered and server-paginated work-item list, detail, create and edit forms, and the claim and workflow-transition actions with explicit conflict handling. Phase 8 added the transactional-outbox **worker**: a separate process that claims pending jobs with `FOR UPDATE SKIP LOCKED`, validates and acknowledges them, retries transient failures with bounded exponential backoff, dead-letters permanent failures, recovers abandoned claims, and shuts down gracefully. Not yet built: submission hardening (Phase 9).

See the [Assignment Checklist](docs/ASSIGNMENT_CHECKLIST.md) for detailed status of all requirements.

## Development Setup

*The commands below were executed and verified during Phase 6 against the configured Neon database (install → migrate → seed → test → typecheck → build). No credentials are committed; supply your own `backend/.env`.*

### Prerequisites
- Node.js (LTS)
- A Neon PostgreSQL database (connection string supplied by the developer)
- Docker and Docker Compose (optional; no local PostgreSQL is required — see `docker-compose.yml`)

### Environment Setup
```bash
# Clone repository
git clone <repository-url>
cd newtonite-assignment

# Install dependencies (backend)
cd backend && npm install

# Install dependencies (frontend)
cd frontend && npm install

# Configure the database connection and auth secret
cp backend/.env.example backend/.env
# Edit backend/.env and set:
#   DATABASE_URL - your Neon connection string
#   JWT_SECRET   - a strong random secret (>= 32 chars) used to sign auth tokens
# Both are gitignored; never commit them.
# Generate a JWT_SECRET with:
#   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### Database Operations (against Neon)
```bash
cd backend

# Generate migrations (writes SQL files to src/db/migrations)
npm run db:generate

# Apply migrations to the Neon database referenced by DATABASE_URL
npm run db:migrate
```

> Drizzle Kit reads `DATABASE_URL` from `backend/.env`. The `db:push` script is **not** a substitute for the versioned migration workflow and should not be used to bypass migrations.

### Seeding (verified — Phase 2)

Seeding runs against the same Neon database via `DATABASE_URL`:

```bash
cd backend
npm run seed
```

The seed is **repeatable**: it uses deterministic UUIDs and upserts, so re-running it does not create duplicate teams, users, memberships, work items, comments, or activity events. It seeds 4 teams, 10 users, memberships covering all four roles (with several users in multiple teams), 2,500 work items across all types/priorities/statuses (for pagination testing), plus 200 comments and 600 activity events.

**Demo accounts (development-only):** each seeded user shares one password, set via `DEMO_PASSWORD` (defaults to `newtonite-demo`) during seeding. Passwords are stored as bcrypt hashes — never plaintext. *Do not reuse this password anywhere real.*

**Verified Phase 2 commands:**
```bash
cd backend
npx tsc --noEmit     # typecheck
npm run db:generate  # generate migrations
npm run db:migrate   # apply migrations to Neon
npm run seed         # seed demo data (idempotent)
npm run test:run     # vitest (unit + real-PostgreSQL integration suites; see Testing)
```

## Authentication & Authorization (implemented — Phase 3)

### How authentication works

Login sets a **signed session token** (JWT, HS256) in an **HttpOnly cookie**. The browser stores the credential; JavaScript never sees it, and every subsequent request re-sends it automatically.

- `POST /auth/login` accepts `{ email, password }`, verifies the password against the stored **bcrypt** hash, and returns `{ tokenType: "Bearer", user }` — **no token value is present in the response body**.
- The token is delivered only as a cookie: `Set-Cookie: auth_token=<jwt>; Max-Age=<JWT_EXPIRES_IN>; Path=/; HttpOnly; SameSite=Strict` (plus `Secure` when `NODE_ENV=production`).
- The client sends it with `credentials: "include"` on every request to the API. It does **not** attach an `Authorization` header, and it does **not** store the token in `localStorage`/`sessionStorage` — the only thing it persists is a boolean session flag (`newtonite_has_session`) used to decide whether to render the authenticated shell.
- Tokens are signed with `JWT_SECRET` and expire after `JWT_EXPIRES_IN` seconds (default 900 = 15 minutes).
- The token carries only the user id in its `sub` claim. **Roles and memberships are never embedded in the token** — they are loaded from PostgreSQL on every request, so a role change or membership revocation takes effect immediately without waiting for the token to expire.
- `POST /auth/logout` clears the cookie. The frontend calls it on sign-out, so the credential is removed from the browser rather than only hidden.
- The backend also accepts the token in an `Authorization: Bearer <token>` header for non-browser clients; the cookie is checked first.

Every login failure — unknown email, wrong password, or a deactivated account — returns the same generic `401 { "error": "Invalid email or password" }`, so account existence is never disclosed. Malformed input returns `400`.

### CSRF posture

The session cookie is `SameSite=Strict`, so the browser does not attach it to cross-site requests; combined with the same-origin `/api` prefix (no CORS preflight is involved for same-origin calls) this is the primary CSRF defence. There is no separate CSRF token. `SameSite=Strict` also means a cookie is not sent on a top-level navigation arriving from another site, so a cold cross-site link into the app shows the login screen rather than silently reusing the session.

### Security headers and rate limiting

`backend/src/app.ts` mounts `helmet@8.3.0` with an explicit Content-Security-Policy (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`), HSTS (1 year, `includeSubDomains`, `preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and no `X-Powered-By`.

Two rate limiters guard the API, both keyed on the client address and both configurable by environment variable:

| Limiter | Default | Response |
|---|---|---|
| `POST /auth/login` | 5 attempts / 60 s, then a 15-minute block | `429` with `Retry-After` |
| All API routes | 100 requests / 60 s | `429` with `Retry-After` |

In production, `GET /health` is restricted to internal client addresses (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) and answers `403` to anything else.

The full security review — every finding, its severity, the evidence behind it, and the residual risks that are still open — is in [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md).

### Endpoints added

| Endpoint | Auth | Description |
|---|---|---|
| `POST /auth/login` | None | Exchange email + password for a session cookie. |
| `GET /auth/me` | Required | Return the authenticated user's safe fields plus their team memberships and roles. |
| `POST /auth/logout` | None | Clear the session cookie. Succeeds whether or not a session is present. |

### Required environment variables

Set in `backend/.env` (gitignored). See `backend/.env.example` for blank placeholders.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string. |
| `JWT_SECRET` | Yes | Signing secret for auth tokens (min 32 chars). Never commit a real value. |
| `JWT_EXPIRES_IN` | No | Token lifetime in seconds (default `900`); also the cookie `Max-Age`. |
| `DEMO_PASSWORD` | No | Password for all seeded demo users; defaults to `newtonite-demo`. Development only. |
| `LOGIN_RATE_LIMIT_POINTS` | No | Login attempts allowed per window (default `5`). |
| `LOGIN_RATE_LIMIT_DURATION` | No | Login rate-limit window in seconds (default `60`). |
| `LOGIN_RATE_LIMIT_BLOCK_DURATION` | No | Login block duration in seconds after the limit is hit (default `900`). |
| `API_RATE_LIMIT_POINTS` | No | General API requests allowed per window (default `100`). |
| `API_RATE_LIMIT_DURATION` | No | General API rate-limit window in seconds (default `60`). |
| `OUTBOX_BATCH_SIZE` | No | Outbox worker batch size (default `10`). |
| `OUTBOX_POLL_INTERVAL_MS` | No | Outbox worker poll interval (ms, default `2000`). |
| `OUTBOX_BACKOFF_BASE_MS` | No | Outbox retry backoff base (ms, default `5000`). |
| `OUTBOX_BACKOFF_MAX_MS` | No | Outbox retry backoff ceiling (ms, default `300000`). |
| `OUTBOX_LEASE_TIMEOUT_MS` | No | Outbox lease timeout (ms, default `60000`). |
| `VITE_API_URL` | No (frontend) | Same-origin `/api` recommended; set to full URL only when cross-origin. |

### Demo login (development-only)

**Demo login (development-only):** any seeded email shares the same password. Set `DEMO_PASSWORD` in `backend/.env` before running `npm run seed` (the seed defaults to `newtonite-demo` if the variable is not set). Example: `avery@newtonite.dev` / `newtonite-demo`. These are development-only credentials and must never be used in production.

### Seeded Demo Users (10 users)

All seeded users share the same password (`newtonite-demo` by default, configurable via `DEMO_PASSWORD`). The seed creates 4 teams and 10 users with deterministic UUIDs, covering all four roles (Viewer, Member, Lead, Admin) across multiple teams. Several users belong to multiple teams.

| Email | Name | Team(s) & Role(s) |
|-------|------|-------------------|
| `avery@newtonite.dev` | Avery Chen | Payments (Admin), Platform (Admin) |
| `blake@newtonite.dev` | Blake Rivera | Payments (Lead), Support (Member) |
| `casey@newtonite.dev` | Casey Morgan | Support (Lead) |
| `devon@newtonite.dev` | Devon Park | Compliance (Lead) |
| `emery@newtonite.dev` | Emery Sutton | Platform (Lead) |
| `finley@newtonite.dev` | Finley Brooks | Payments (Member), Compliance (Member) |
| `gray@newtonite.dev` | Gray Nakamura | Support (Member) |
| `harper@newtonite.dev` | Harper Diaz | Compliance (Member), Platform (Member) |
| `indigo@newtonite.dev` | Indigo Frost | Payments (Viewer) |
| `juniper@newtonite.dev` | Juniper Wells | Support (Viewer) |

**Password (all users):** `newtonite-demo` (default, configurable via `DEMO_PASSWORD` env var)

> **Security note:** These are development-only credentials. Passwords are stored as bcrypt hashes — never plaintext. Do not reuse this password anywhere real. The seed is idempotent and uses deterministic UUIDs, so re-running `npm run seed` will not create duplicates.

### Team-scoped role model

Roles are assigned **per team** via team membership; a user can hold different roles in different teams. There is no global role and no "admin everywhere" bypass — every permission check resolves the user's role for one specific team.

| Operation | Viewer | Member | Lead | Admin |
|---|---:|---:|---:|---:|
| View team items | Yes | Yes | Yes | Yes |
| Create / edit / claim items | No | Yes | Yes | Yes |
| Approve workflow transitions | No | No | Yes | Yes |
| Manage team membership | No | No | No | Yes |

Authorization is enforced entirely server-side (`src/auth/policy.ts` + `src/auth/authorize.ts`). For resources tied to a team (e.g. work items), the intended flow is: authenticate → load the resource and its **real** team id from the database → resolve the caller's role for that team → check the action → proceed. A client-supplied team or role is never trusted as proof of access. A request for a team the caller does not belong to returns `404` (not `403`) to prevent cross-team enumeration.

### Current auth limitations

- No refresh tokens, OAuth/SSO, password reset, or account registration (out of scope for this phase).
- Tokens are stateless: there is no server-side revocation list, so a token that leaks stays valid until it expires. Signing out clears the browser's copy, which is the standard mitigation for a cookie session.
- Throttling is per client address, not per account. See **M-01** and **M-03** in [`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md).

### Running the Application

```bash
# Start backend (dev)
cd backend && npm run dev
# Start the outbox worker (separate process; safe to run alongside the API)
cd backend && npm run worker
# Start frontend (dev)
cd frontend && npm run dev  # http://localhost:5173 (proxies /api to backend)
```

> The worker is a **separate process** from the API — the API never starts one, so API latency is unaffected by polling. See [Transactional Outbox Worker](#transactional-outbox-worker-implemented--phase-8).

### Testing

```bash
cd backend

# Run all tests (Vitest). Requires DATABASE_URL + JWT_SECRET in backend/.env.
npm run test:run

cd ../frontend

# Run the frontend component/unit suite (jsdom; no database or server required).
npm test

# Type checking
cd ../backend && npx tsc --noEmit
cd ../frontend && npm run typecheck

# Production build (frontend)
cd ../frontend && npm run build

# Database (Drizzle)
cd ../backend && npm run db:generate
cd ../backend && npm run db:migrate
```

> **Note on test layers:** `src/auth/policy.test.ts`, `src/outbox/events.test.ts`, `src/outbox/backoff.test.ts`, and `src/outbox/logging.test.ts` are pure unit tests (no database). `src/auth/auth.integration.test.ts`, `src/items/items.integration.test.ts`, `src/items/mutations.integration.test.ts`, `src/verification.integration.test.ts`, and `src/outbox/outbox.integration.test.ts` run against the configured Neon database and create/clean up their own throwaway fixtures — they never mutate the seeded demo dataset. The mutation suite also exercises genuine concurrency (overlapping requests) and reads the committed rows/activity/outbox back to prove the guarantees hold. The Phase 6 verification suite covers API error handling (malformed/oversized bodies), the full unauthenticated-token matrix on the items API, live membership/role changes, cross-team isolation, the pagination contract, input validation, idempotency guards, and live migration state. The outbox integration suite proves **real-database claim concurrency** (`FOR UPDATE SKIP LOCKED` against a second open transaction, plus overlapping claims), lease recovery, backoff/max-attempt enforcement, duplicate delivery, shutdown, and log/persisted-error sanitisation; it claims only jobs it created, identified by a unique per-run job type.
>
> **Frontend tests** (`frontend/src/**/*.test.ts(x)`) run in jsdom and drive the real route table and the real API client against a stubbed network boundary, so URL building, auth headers, error parsing, conflict handling, and route guards are exercised rather than mocked away. They prove client behaviour only — they make no claim about backend authorization or security, which is covered by the backend integration suites above.

## Work-Item API (implemented — Phase 4, hardened in Phase 5)

Phase 4 added listing, creation, detail, and partial update. Phase 5 added atomically-claimed work, guarded workflow transitions, optimistic concurrency on every mutation, database-backed idempotency, and transactional activity + outbox writes. All require authentication (see Phase 3) and every query is scoped to the caller's team memberships.

### Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /items` | Required | List work items visible to the caller, with filtering, search, sorting, and pagination. |
| `POST /items` | Required | Create a work item in a team the caller can write to. |
| `GET /items/:id` | Required | Fetch one work item. |
| `PATCH /items/:id` | Required | Update permitted fields under optimistic concurrency. |
| `POST /items/:id/claim` | Required | Atomically claim an unassigned, claimable item for the caller. |
| `POST /items/:id/transition` | Required | Advance the item along the approved workflow. |

### Team scoping

The caller only ever sees items from teams they are a member of. `GET /items` filters by the caller's team ids; every `/:id` endpoint (detail, update, claim, transition) loads the item first and authorizes against the item's **real** team id from the database (never a client-supplied one).

- No membership in the item's team → `404` (conceals existence; prevents cross-team enumeration).
- A member whose role lacks the action → `403`.
- `GET /items?teamId=<team the caller is not in>` returns an **empty page** — it does not disclose whether that team has items.

### `GET /items` query contract

| Parameter | Default | Rules |
|---|---|---|
| `teamId` | — | UUID. Must be a team the caller belongs to, otherwise an empty page. |
| `status` | — | One of `OPEN`, `IN_PROGRESS`, `AWAITING_APPROVAL`, `RESOLVED`, `CLOSED`. |
| `priority` | — | One of `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. |
| `assigneeId` | — | UUID. |
| `search` | — | Case-insensitive substring match over `title` and `description`; max 200 chars; `%` and `_` are matched literally (no wildcard injection). |
| `page` | `1` | Integer ≥ 1 and ≤ `Number.MAX_SAFE_INTEGER`. Omitted → `1`. Zero, negative, non-integer, or absurdly large values (which would overflow the SQL `OFFSET`) are **rejected with `400`**. |
| `pageSize` | `20` | Integer 1–100. Omitted → `20`. Values below 1, above 100, or non-integer are **rejected with `400`**, never silently clamped. |
| `sort` | `updatedAt` | Allowlisted: `createdAt`, `updatedAt`, `priority`, `dueAt`. |
| `order` | `desc` | `asc` or `desc`. |

Ordering is deterministic: the requested column/direction followed by `id` ascending as a tie-breaker, so equal sort keys never produce unstable pages. `priority` sorts by its enum order (`LOW` → `CRITICAL`).

Response:

```json
{
  "items": [ /* work-item objects */ ],
  "pagination": {
    "page": 1, "pageSize": 20, "total": 123,
    "totalPages": 7, "hasNextPage": true, "hasPrevPage": false
  }
}
```

`total` is an **exact** count computed with `COUNT(*)` over the same filters (not an estimate).

### `POST /items` body

```json
{
  "title": "…", "description": "…",
  "type": "INCIDENT", "priority": "HIGH",
  "teamId": "<uuid>", "assigneeId": "<uuid>|null", "dueAt": "<ISO-8601>|null"
}
```

- Only the fields above are accepted. Unknown/protected fields (`status`, `version`, `createdBy`, `id`, timestamps) are **rejected with `400`** rather than silently ignored.
- `createdBy` is taken from the authenticated user; `status` is set to `OPEN` and `version` to `1` by the server.
- Requires the `create_item` permission for the target team.
- If `assigneeId` is supplied it must be a member of the **same team**, otherwise `400` — cross-team assignment is never permitted.

### `PATCH /items/:id` body

```json
{
  "title": "…", "priority": "HIGH",
  "assigneeId": "<uuid>|null", "expectedVersion": 3
}
```

A subset of `title`, `description`, `type`, `priority`, `dueAt`, `assigneeId`, plus the **required** `expectedVersion` (see below). The body must contain at least one editable field; an empty body or any protected field (`status`, `version`, `teamId`, `createdBy`, `id`, timestamps) is rejected with `400`. This endpoint never changes `status`, `teamId`, or `createdBy`, and a client can never set `version`.

### Version contract (optimistic concurrency)

- Every work item has an integer `version` starting at `1`.
- Each **successful mutation that changes the item** increments the version **exactly once** (`version = version + 1`), server-side. A successful request never accepts the caller's number as the stored version.
- `PATCH` and `transition` require `expectedVersion` in the body. If it does not equal the stored version the request is rejected with **`409` `STALE_VERSION`**, with **no** change, no activity event, and no outbox job — and there is no automatic retry.
- `claim` is conditional on the item being *unassigned and claimable* rather than on a version (claim-specific behavior); it still increments the version once on success.
- A `PATCH` whose supplied values already match the stored row is a no-op: the version is checked but not incremented, and no event is written.
- All conditional writes are single SQL `UPDATE`s with the precondition in the `WHERE` clause (plus the `(scope, key)` uniqueness constraint and a transaction-scoped advisory lock for idempotency), so correctness does not depend on application-level locking or a read-then-write race.

### `POST /items/:id/claim`

- No request body.
- Preconditions: the item is **unassigned** and in a **claimable** status (`OPEN` or `IN_PROGRESS`). `AWAITING_APPROVAL`, `RESOLVED`, and `CLOSED` are not claimable.
- Requires `claim_item` (MEMBER/LEAD/ADMIN of the item's team). The assignee is always the authenticated caller — never a client-supplied id.
- Implemented as a single conditional `UPDATE ... WHERE id = ? AND assignee_id IS NULL AND status IN (...)` that also increments the version. Under a race **exactly one** claimant wins; the loser receives `409` (`ALREADY_ASSIGNED` or `NOT_CLAIMABLE`) and writes nothing.
- On success: `ASSIGNEE_CHANGED` activity event + one outbox job, committed in the same transaction.

### `POST /items/:id/transition` body

```json
{ "toStatus": "IN_PROGRESS", "expectedVersion": 1 }
```

- Allowed edges are exactly `OPEN → IN_PROGRESS → AWAITING_APPROVAL → RESOLVED → CLOSED`. Skipping a state, moving backwards, or reopening a `CLOSED` item is rejected with **`409` `INVALID_TRANSITION`**. Clients cannot set `status` through `PATCH`.
- Ordinary progression (`OPEN → IN_PROGRESS`, `IN_PROGRESS → AWAITING_APPROVAL`, `RESOLVED → CLOSED`) requires MEMBER/LEAD/ADMIN (`edit_item`).
- The approval edge `AWAITING_APPROVAL → RESOLVED` requires **LEAD/ADMIN of the item's own team** (`approve_transition`). A Viewer or Member gets `403`; a Lead/Admin who is not a member of that team gets `404`.
- A stale `expectedVersion` yields `409` `STALE_VERSION` with no side effects.
- On success: `STATUS_CHANGED` activity event + one outbox job, committed in the same transaction.

### Idempotency (`Idempotency-Key`)

The four mutation endpoints (`POST /items`, `PATCH /items/:id`, `POST /items/:id/claim`, `POST /items/:id/transition`) accept an optional `Idempotency-Key` header (max 255 chars).

- Keys are scoped to the **authenticated user + endpoint**.
- Same key + **same** payload → the original status and body are replayed; the mutation is **not** re-run.
- Same key + **different** payload → `409` `IDEMPOTENCY_KEY_REUSED`.
- Concurrent duplicates are serialized by a PostgreSQL **transaction-scoped advisory lock** taken as the first statement of the transaction, so a duplicate arriving mid-flight waits for the winner to commit and then replays — exactly one business effect. The `(scope, key)` unique index is the database-enforced backstop.
- The idempotency record is written **in the same transaction** as the item change, its activity event, and its outbox job, so they commit together (or not at all). A request is never marked successful before the business work commits.
- A failed request (validation, authorization, or conflict) rolls back the whole transaction including the idempotency record, so failures are never cached as successes and do not consume the key.
- Records carry an `expires_at` retention hint (24h). There is no automated purge in this phase.

### Activity events and the transactional outbox

- Every successful mutation writes at least one **activity event** in the same transaction: `ITEM_CREATED` (create), `PRIORITY_CHANGED`/`ASSIGNEE_CHANGED`/`ITEM_UPDATED` (per changed category on update), `ASSIGNEE_CHANGED` (claim), `STATUS_CHANGED` (transition). `metadata` carries the before/after values.
- Every successful mutation also enqueues exactly one **outbox job** (`job_type` = `work_item.created`/`updated`/`claimed`/`transitioned`; payload `{ workItemId, teamId, actorId, status, version }`), inserted in the same transaction as the mutation.
- Failed, stale, unauthorized, and losing requests produce **no** activity event and **no** outbox job.
- There is **no external delivery** from the request path: mutations only *enqueue* a job. Processing is done by the separate outbox worker process (`npm run worker`, Phase 8) — see [Transactional Outbox Worker](#transactional-outbox-worker-implemented--phase-8).

### Error semantics

| Status | When |
|---|---|
| `400` | Invalid body/query: bad enum values, malformed UUIDs **in the body**, unknown or protected fields, empty PATCH, missing/invalid `expectedVersion`, over-long `Idempotency-Key`, out-of-range pagination, cross-team assignee. |
| `401` | Missing or invalid bearer token. |
| `403` | Authenticated member whose role lacks the action (e.g. a Viewer creating/editing/claiming, or a Member approving). |
| `404` | Item missing, item belongs to a non-member team, or the `:id` is malformed (fail-closed). Also a Lead/Admin of a *different* team attempting to approve. |
| `409` | A conflict, with a stable `code`: `STALE_VERSION`, `ALREADY_ASSIGNED`, `NOT_CLAIMABLE`, `INVALID_TRANSITION`, or `IDEMPOTENCY_KEY_REUSED`. |
| `413` | Request body exceeds the JSON parser limit (`Payload too large`). |

A body that cannot be parsed as JSON is rejected with `400 { "error": "Invalid request" }`; an over-large body with `413`. These are client errors and are **never** reported as `500` (Phase 6 fix — body-parser failures previously fell through to the generic server-error handler).

Conflict responses include a machine-readable `code` alongside the human-readable `error`:

```json
{ "error": "Work item was modified by another request", "code": "STALE_VERSION" }
```

### Phase 5 scope notes and known limitations

- **Transactional guarantee.** Item mutation, version increment, activity event, outbox job, and idempotency record are committed on one connection in one transaction. There is no partial commit.
- **No external delivery.** Jobs are enqueued transactionally; a *separate* worker process (Phase 8) validates and acknowledges them. No email/webhook/integration is implemented, so nothing claims a notification was delivered — see [Transactional Outbox Worker](#transactional-outbox-worker-implemented--phase-8).
- **No idempotency purge job.** `expires_at` is a retention hint; cleanup is future work.
- **Claimability** is defined as `OPEN` or `IN_PROGRESS` over the existing status model (no new statuses); `AWAITING_APPROVAL`/`RESOLVED`/`CLOSED` are not claimable.
- **`ITEM_UPDATED` enum value** was added by additive migration `0001_yummy_the_captain.sql` (`ALTER TYPE ... ADD VALUE`) so a title/description/type/dueAt change has an accurate event type. No historical audit rows were rewritten.
- **Comments and activity-history read endpoints** (`GET /items/:id/comments`, `GET /items/:id/activity`) are implemented alongside the write endpoints, and the detail view renders both.
- The existing `work_items` indexes (`wi_team_status_updated_idx`, `wi_team_priority_status_updated_idx`, `wi_assignee_status_updated_idx`, plus the single-column indexes) already cover the team-scoped filter/sort access patterns; **no new index was required**.

## Phase 6 Verification (Integration, Security, Regression)

Phase 6 audited Phases 1–5 against the running application and the live Neon database (not mocks), then fixed genuine defects and added regression coverage. Full results are in the Phase 6 completion report; the summary:

- **Defects found and fixed** (minimal, in-design changes):
  1. A **malformed JSON body returned `500`** instead of `400`. The central error handler only recognised `ApiError`, so body-parser failures fell through to the generic server-error branch. Fixed in `src/app.ts` by mapping a middleware error that carries its own 4xx status (malformed JSON → `400`, oversized body → `413`) to that status with a generic, non-leaky message.
  2. An **out-of-range `page` returned `500`**. `page` had no upper bound, so a huge value produced an `OFFSET` such as `2e+21` that PostgreSQL rejects (`22P02 invalid input syntax for type bigint`). Fixed in `src/items/validation.ts` by capping `page` at `Number.MAX_SAFE_INTEGER` (which keeps `page × pageSize` within a bigint), rejecting absurd values with `400` rather than failing at the database.
- **Verification (all executed against real PostgreSQL, all passing):** authentication boundaries (missing/malformed/expired/forged tokens → `401`); login non-disclosure; response hygiene (no SQL, stack traces, or secrets in error bodies); live membership revocation and role promotion/demotion honoured on the next request; cross-team isolation across every mutation endpoint (`404`); the pagination contract incl. the preserved `pageSize > 100 → 400` rule; `PATCH`/create input validation; idempotency guards (over-long key rejected, validation failures not cached and key not consumed); and the live migration state (the `ITEM_UPDATED` enum value is applied and the two migrations are recorded).
- **Known limitation confirmed at the time, since closed:** there was **no comments endpoint**, so the checklist's "cannot comment on another team's item" case had no matching route to exercise; item-level cross-team isolation was instead verified against every existing mutation endpoint. Comment endpoints have since been added, and cross-team isolation on them is covered by the current suite.

## Transactional Outbox Worker (implemented — Phase 8)

Phase 8 adds the **consumer** side of the Phase 5 transactional outbox. A mutation still enqueues its job in the same transaction as the business change (that guarantee is untouched); a separate worker process then claims and processes those jobs.

### Running it

```bash
cd backend
npm run worker        # tsx src/worker.ts
```

It is a **separate process from the API** (`src/index.ts`). The API never spawns a worker and the worker never imports the Express app, so there is exactly one worker per process that runs it and API latency is unaffected by polling. `Ctrl+C` (SIGINT) or SIGTERM stops it gracefully.

### Required configuration

`DATABASE_URL` is required (same as the API) and comes from `backend/.env`. `JWT_SECRET` is also required by the shared config module even though the worker does not use it. **Every outbox setting is optional and has a default**, so the command above works with no extra configuration:

| Variable | Default | Meaning |
|---|---|---|
| `OUTBOX_BATCH_SIZE` | `10` | Maximum jobs claimed per poll. |
| `OUTBOX_POLL_INTERVAL_MS` | `2000` | Delay between polls. |
| `OUTBOX_BACKOFF_BASE_MS` | `5000` | First retry delay; doubles per attempt, with jitter. |
| `OUTBOX_BACKOFF_MAX_MS` | `300000` | Retry delay ceiling. |
| `OUTBOX_LEASE_TIMEOUT_MS` | `60000` | How long a job may stay `PROCESSING` before its claim is treated as abandoned. |

### How polling and claiming work

Each iteration does three things, in order:

1. **Recover abandoned claims.** A job left `PROCESSING` longer than `OUTBOX_LEASE_TIMEOUT_MS` is treated as abandoned (its worker crashed or lost its connection) and made eligible again. The schema has no dedicated lock columns, so the worker uses the existing `updated_at` column as the **lease timestamp** — written from the database clock (`now()`) at every state change. An abandoned job whose attempts are already exhausted goes straight to `FAILED` instead of looping.
2. **Claim a bounded batch.** `UPDATE`-to-`PROCESSING` over candidates selected with `SELECT … FOR UPDATE SKIP LOCKED` inside a short transaction. Eligibility is `status = 'PENDING'` **and** `attempt_count < max_attempts` **and** `next_attempt_at <= now()` **and** a supported `job_type`. A second worker running concurrently skips locked rows, so two claims return **disjoint** sets — proven against real PostgreSQL, not mocks.
3. **Process and record.** Each claimed job is handled *outside* the claim transaction, so no database lock is ever held across handler work.

The claim transaction contains only the two statements above. Claiming consumes one attempt, so a job that repeatedly crashes its worker is still bounded by `max_attempts`.

**Only the four `work_item.*` types are claimed.** An unknown `job_type` is never claimed (it stays `PENDING` and is visible by querying the table) rather than being failed, so a future producer's event type is not prematurely dead-lettered.

### What the handler actually does (and does not do)

There is **no approved downstream integration** — no email, no webhook, no external service — and inventing one would mean claiming a delivery that never happened. So the handler performs the real, verifiable internal work a consumer of these events must do before acknowledging them:

1. confirm the event type is supported;
2. validate the payload against the Phase 5 contract `{ workItemId, teamId, actorId, status, version }`;
3. load the referenced work item and confirm it exists;
4. confirm the event's `teamId` matches the work item's team (a structural invariant — the producer builds the payload from the row it just wrote).

The outcome recorded is **"processed/validated"**, never "delivered". The handler is idempotent by construction (steps 1–4 are reads and validations), so replaying a delivery has no effect. Extending the worker to a real consumer means adding a branch to `src/outbox/handler.ts`; the claiming, retry, and lease machinery does not change.

`status` and `version` in the payload are the *event-time snapshot*: they are validated structurally but deliberately **not** compared with the current row, because the work item legitimately advances after the event is enqueued.

### Retry, backoff, and failure policy

| Failure | Behaviour |
|---|---|
| **Transient** (e.g. the database was briefly unavailable) | Back to `PENDING` with `next_attempt_at = now() + backoff`. Backoff is bounded exponential ("equal jitter": `min(base × 2^(n−1), max)`, jittered down to no less than half), so it never degenerates into a tight loop. |
| **Permanent** (unknown type, malformed payload, missing work item, team mismatch) | `FAILED` immediately, regardless of remaining attempts — a malformed event can never be retried forever. |
| **Attempts exhausted** | `FAILED` on the attempt that reaches `max_attempts` (per-row, default 10). |

### How failed jobs are represented

A terminal job is `status = 'FAILED'` with `processed_at` set and a **redacted, length-bounded** `last_error` (category + message, e.g. `INVALID_PAYLOAD: payload failed validation (workItemId: Invalid uuid)`) and its final `attempt_count`. It is never claimed again. Developer inspection:

```sql
SELECT job_type, status, attempt_count, max_attempts, processed_at, last_error
FROM outbox_jobs
WHERE status IN ('FAILED', 'PROCESSING')
ORDER BY updated_at DESC;
```

### Logs and observability

The worker writes one JSON object per line on stdout — `worker.started`, `worker.batch` (per-iteration `claimed`/`processed`/`retried`/`failed` counters), `worker.job_completed`, `worker.job_retry_scheduled`, `worker.job_failed`, `worker.leases_recovered`, `worker.job_state_lost`, `worker.iteration_failed`, and `worker.stopped`. Error messages are redacted (connection strings, passwords, bearer tokens, JWTs and long hex secrets) and log fields are restricted to primitives, so a payload object cannot be printed even by mistake. Idle polls emit no batch line by design.

### Delivery guarantee

Delivery is **at-least-once, not exactly-once**. A worker can complete the handler work and crash before marking the job `COMPLETED`; lease recovery then hands the same job to another attempt. This is inherent to doing work outside a transaction (a single transaction would hold locks across processing) and it is safe because the handler is idempotent and every state transition is guarded on `status = 'PROCESSING'`, so two workers cannot both record an outcome for the same claim.

### Testing the worker

```bash
cd backend
npm run test:run                                   # everything
npx vitest run src/outbox                          # just the outbox suites
```

`src/outbox/events.test.ts`, `src/outbox/backoff.test.ts`, and `src/outbox/logging.test.ts` are pure unit tests (no database). `src/outbox/outbox.integration.test.ts` runs against real PostgreSQL for claiming, concurrency, leases, retries, attempt limits, duplicate delivery, shutdown, and log sanitisation. See [Testing](#testing).

### Phase 8 known limitations

- **No external delivery and no failed-job alerting.** A `FAILED` job is visible only by querying the table or reading the worker log; no alerting or metrics platform is implemented (and none was in scope).
- **No outbox purge.** Completed/failed rows are retained; no retention job exists.
- **Abandoned-claim recovery uses `updated_at` as the lease timestamp**, because the schema has no dedicated lock column. Adding one would give a more explicit lease but requires a migration, which was deliberately avoided.
- **Graceful signal handling is wired but not OS-verified on Windows**, where a programmatic `SIGTERM` terminates the process instead of being delivered. The shutdown *mechanism* (stop claiming, finish the in-flight job, close the pool) is covered by the integration suite.
- **One worker per process.** There is no leader election or scheduler; running the same command twice is safe (claims are disjoint) but both processes poll independently.

## Frontend (implemented — Phase 7)

The frontend is a React 19 + TypeScript single-page app that consumes only the endpoints that already exist. It adds **no new API routes and no backend changes of its own**.

**Stack and structure**

- `react-router-dom` v7 for routing, `@tanstack/react-query` v5 for server state, plain CSS (`src/styles.css`) with design tokens. No UI component framework was introduced.
- Layers: `src/api/` (typed client + per-resource modules + DTOs), `src/auth/` (session-flag store, session provider, route guard), `src/lib/` (constants, formatting, permissions, shared form logic), `src/components/` (presentational), `src/pages/` (routes), `src/test/` (harness, fixtures).

**API access**

- Every request goes through one typed client, `src/api/client.ts`: it sends the session cookie (`credentials: "include"`), builds the query string (dropping empty values), sends `Idempotency-Key`, parses the backend's `{ error, code, details }` error shape into an `ApiError`, and never logs tokens or credentials. It attaches **no** `Authorization` header — the credential is the `HttpOnly` cookie, which JavaScript cannot read.
- Base URL comes from `VITE_API_URL`, defaulting to the same-origin `/api` prefix. In development, `vite.config.ts` proxies `/api/*` to `http://localhost:3000` and strips the prefix, so the browser never makes a cross-origin request and **no backend CORS change was needed**.

**Session handling**

- `POST /auth/login` sets the `HttpOnly` session cookie and returns no token. The client keeps only a boolean session flag in `localStorage` (`newtonite_has_session`); the credential itself is never readable by script. Identity and memberships come from `GET /auth/me` (the router mounts it under `/auth`).
- Because the credential is a cookie, **a page refresh keeps the user signed in**: the browser re-sends the cookie, `GET /auth/me` succeeds, and the shell renders again.
- Login failures are deliberately generic ("Invalid email or password.") and identical for unknown email, wrong password, and disabled account, so account existence is never revealed.
- A `401` on an authenticated request clears the session flag and the query cache and returns the user to `/login`; a failed login (`auth: false`) never triggers that path.
- Sign-out calls `POST /auth/logout` so the server clears the cookie, then clears the session flag and the query cache locally. The local state is cleared even if the request fails, so a network error can never leave the user in a signed-in state they asked to leave.

**Routes**

| Route | Screen |
|---|---|
| `/login` | Login form |
| `/` | redirect → `/overview` |
| `/overview` | Dashboard: metric cards and recent work |
| `/items` | Work-item list (server-side filters + pagination) |
| `/assigned` | **Assigned to Me** view (server preset `assigned`) |
| `/attention` | **Unassigned Urgent** view (server preset `unassigned_urgent`) |
| `/approval` | **Awaiting My Approval** view (server preset `awaiting_approval`) |
| `/teams/:teamId` | One team's work, with the same three presets available |
| `/items/new` | Create form |
| `/items/:id` | Detail with claim, workflow-transition, comments and activity timeline |
| `/items/:id/edit` | Edit form |
| `*` | Not-found |

Everything except `/login` sits behind the route guard and the authenticated shell (skip link, header, primary nav, identity, sign-out).

**Dashboard views**

The three named views are real server-side presets, not client-side filters. `GET /items` accepts a `preset` parameter — `assigned`, `unassigned_urgent`, `awaiting_approval` — and the backend applies the corresponding filter:

- `assigned` — items whose `assignee_id` is the calling user (the service layer substitutes the authenticated user id; a client-supplied `assigneeId` cannot widen it).
- `unassigned_urgent` — `assignee_id IS NULL AND priority IN ('HIGH','CRITICAL')`.
- `awaiting_approval` — `status = 'AWAITING_APPROVAL'`, **and only for a caller who holds `LEAD` or `ADMIN` in at least one team**. A caller without that role receives an empty page, so the restriction is enforced by the server, not by hiding a button.

**Server state, filtering, and pagination**

- Query keys: `["me"]`, `["items", filters]`, `["item", id]`, `["activity", id]`, `["comments", id]`. Create invalidates `["items"]`; update/claim/transition write the returned item into `["item", id]` and invalidate `["items"]`; posting a comment invalidates `["comments", id]` and `["activity", id]` so the timeline stays in step with the discussion.
- The list is server-filtered and server-paginated — the browser never downloads the collection. `teamId`, `status`, `priority`, `assigneeId`, `search`, `sort`, and `order` map 1:1 onto the documented `GET /items` contract. Page size is offered as 10/20/50/100, so a value above the API maximum of 100 can never be submitted.
- Changing any filter resets to page 1; free-text filters are debounced (300 ms) and folded into the query atomically so a burst of keystrokes produces one request; an `AbortSignal` cancels superseded requests; `keepPreviousData` avoids a blank table while paging. A partially typed assignee id is shown as a validation hint and is **never sent** as an invalid query parameter.

**Concurrency and conflict UX**

- Edit submits the `version` read from the server as `expectedVersion`. It is never a form field and cannot be set by the user.
- `409 STALE_VERSION` is surfaced as an explicit conflict with a **Reload latest version** action. Reloading refreshes the version **without discarding the user's unsaved edits**, then tells the user the latest version was loaded; nothing is silently retried or overwritten.
- `409 IDEMPOTENCY_KEY_REUSED` and other conflict codes are handled distinctly from stale-version conflicts.
- Idempotency keys are generated per payload fingerprint (`useStableIdempotencyKey`), so a retry of the *same* logical request reuses its key and an edited payload gets a new one.
- Claim is not optimistic. A 409 from a lost claim race (or a transition that is no longer valid) is treated as recoverable: the item is re-fetched and the outcome explained.

**Claim and workflow**

- The transition control is derived from the approved linear workflow (`OPEN → IN_PROGRESS → AWAITING_APPROVAL → RESOLVED → CLOSED`); only the single next step is ever offered, and reopening is impossible.
- The transition out of `AWAITING_APPROVAL` is offered only to `LEAD`/`ADMIN` **in the item's own team**; other roles see a plain explanation instead of a control. Role checks are a convenience only — the backend re-authorizes every request.
- Status is deliberately absent from the general edit form; it changes only through the transition action.
- The API defines no destructive action (there is no delete), so no confirmation flow was added.

**Accessibility**

Semantic landmarks and one `h1` per screen, a skip link, labelled controls, `aria-invalid`/`aria-describedby` wiring for field errors, visible focus outlines, `aria-live` regions for results and messages, and loading/empty/error/retry states throughout. Status and priority are always conveyed by text (priority adds a non-colour severity mark), never by colour alone. Animations are reduced under `prefers-reduced-motion`.

**Tests**

`frontend npm test` runs **137 tests in 12 files** (jsdom). They drive the real route table, the real API client, and the real session provider against a stubbed network boundary, covering: auth header/query/error mapping and the 401-vs-failed-login distinction (including the negative case — a sessionless `401` must *not* trigger the sign-out path); login validation, generic failure messaging, session handoff, and keyboard submission; redirect when unauthenticated, loading, rejected-token and failing-session states, and sign-out — including that sign-out **calls the server** and that a failing logout request still signs the user out locally; list rendering, empty/error/retry, paging, filter-driven page reset, page-size bounds, and role-gated create; create validation, payload shape, backend field errors, double-submit prevention, and idempotency-key reuse/regeneration; edit prefill, `expectedVersion` submission, the stale-version conflict with edit preservation, and permission gating; detail rendering, claim success and lost-race recovery, transition submission with the current version, approval gating by role, invalid/stale/forbidden transition handling, comments and the activity timeline, and closed-item terminal state; the three dashboard views and the shell's per-team preset links. There is also a unit suite for the shared form validation/payload mapping. **These are client-behaviour tests; they do not prove backend security.**

### Phase 7 scope notes and known limitations

- **No user/team-member directory endpoint**, so the assignee is entered as a user UUID, with an "Assign to me" shortcut for the common case. Filtering by assignee likewise takes a UUID.
- **Pagination is offset-based, not cursor-based**, matching what the API actually implements (`page`/`pageSize` with an exact total).
- The three dashboard views and the comments/activity surfaces that were outstanding in earlier phases are now implemented against the server-side `preset` parameter and the `GET /items/:id/comments` / `GET /items/:id/activity` endpoints.

```
# Run the frontend suite and checks
cd frontend
npm test            # 137 tests, 12 files
npm run typecheck   # tsc --noEmit
npm run build       # tsc && vite build
npm run lint        # stub: "lint: not configured"
```

## Critical Testing Requirements

The following behaviors are covered by real PostgreSQL integration tests in `src/items/mutations.integration.test.ts` and `src/verification.integration.test.ts` (run with `npm run test:run` in `backend/`). Concurrency cases use genuinely overlapping requests, not sequential calls:

1. **Concurrent claim** — exactly one succeeds; the loser gets `409 ALREADY_ASSIGNED` and writes no audit/outbox rows.
2. **Stale update** — rejected with `409 STALE_VERSION`; the stored row, activity history, and outbox are untouched.
3. **Idempotency** — duplicate and concurrent duplicate requests produce one logical operation; key reuse with a different payload is `409 IDEMPOTENCY_KEY_REUSED`.
4. **Workflow enforcement** — invalid transitions and unauthorized approvals fail; only the item's own-team Lead/Admin can approve.
5. **Resource authorization** — cross-team access is denied (`404`); a role held in another team grants nothing.
6. **Audit atomicity** — a failing activity/outbox insert rolls back the item mutation in the same transaction.

## Known Limitations

Scope constraints carried from the specification, followed by the limitations of what is actually built.

**Out of scope by specification**
- User registration is out of scope (seeded demo users only)
- Reopening Closed items is out of scope
- No Redis, dedicated search engine, read replicas, or partitioning in the initial build
- WebSockets, SSO, email delivery, and file attachments are not part of the initial implementation

**Limitations of the implementation**
- **The outbox worker delivers nothing externally.** Transactional outbox *insertion* (Phase 5) and a *worker* (Phase 8) are implemented: jobs are written in the same transaction as the mutation, and a separate process claims, validates, and acknowledges them with bounded retries. There is still **no external delivery** (no email/webhook/integration), and **no failed-job alerting** — a `FAILED` job is visible only by querying the table or grepping the worker log (see *[Transactional Outbox Worker](#transactional-outbox-worker-implemented--phase-8)*).
- Idempotency records have no automated purge yet (`expires_at` is a retention hint).
- There is no user/team-member directory endpoint, so assigning work requires a user UUID.
- **Pagination is offset-based, not cursor-based**, matching what the API implements (`page`/`pageSize` with an exact `total`).
- **The session credential lives in an `HttpOnly` cookie, so a page refresh keeps the user signed in.** Tokens are stateless and there is no server-side revocation list, so a leaked token remains valid until it expires; signing out clears the browser's copy (see *Authentication & Authorization* and `SECURITY_AUDIT.md`).
- **Login throttling is per client address, not per account**, and the rate-limit counters live in the backend process's memory. Behind a reverse proxy every client would share one bucket, because `trust proxy` is not configured. See `SECURITY_AUDIT.md` M-01, M-02 and M-03.
- **`drizzle-orm` is behind a published security advisory** (GHSA-gpj5-g38j-94v9). The vulnerable code path is not reachable in this codebase, and the fix requires a breaking major-version upgrade; the reasoning and the follow-up are recorded in `SECURITY_AUDIT.md` M-05.

## Submission Information

- **Submission Deadline:** Monday, 19 October 2026, 10:00 AM
- **Target Submission:** Monday, 19 October 2026, 9:30 AM (30-minute buffer)
- **Repository Access:** Public repository access (to be confirmed at submission)

### Fresh-Clone / Setup Reproducibility (verified in Phase 6)

- **Migrations:** the local Drizzle journal (`src/db/migrations/meta/_journal.json`, 2 entries) matches the live database: `drizzle.__drizzle_migrations` holds exactly 2 applied migrations whose recorded timestamps equal the journal's `when` values, and the additive `ITEM_UPDATED` enum value is present in `activity_event_type` with all prior values preserved. Local and remote migration state agree — no discrepancy and no history rewrite.
- **Seed:** `npm run seed` is idempotent (deterministic UUIDs + `onConflictDoUpdate`, no deletes). Two consecutive runs produced identical totals (`users: 10`, `work_items: 2500`, plus `teams: 4`, `memberships: 14`, `comments: 200`, `activity_events: 600`) with no duplicate rows.
- **Checks (re-run 2026-10-22):** backend typecheck, frontend typecheck, backend production build, and frontend production build all completed with exit code `0`; the full backend suite (**209 tests, 9 files**) and the full frontend suite (**137 tests, 12 files**) passed. Lint is not configured (`npm run lint` is an explicit stub in both packages). The frontend test suite requires the `jsdom`, `@testing-library/react`, `@testing-library/dom`, `@testing-library/user-event`, and `@testing-library/jest-dom` dev dependencies.

## License

This project is for assessment purposes as specified in the assignment.
