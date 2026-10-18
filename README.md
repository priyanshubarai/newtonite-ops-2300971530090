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

**Status:** Backend foundation (Phase 1), database schema and seed (Phase 2), authentication + team-scoped authorization (Phase 3), the core work-item API — list, create, detail, update (Phase 4) — and the critical-mutation layer — atomic claim, workflow transitions, optimistic concurrency, idempotency, and transactional activity + outbox (Phase 5) — are implemented and verified. Phase 6 (integration, security, and regression verification) audited Phases 1–5 against the running database and API, fixed two API error-handling defects, and added a focused verification suite that passes against real PostgreSQL. The frontend is scaffolded but product screens are not yet built.

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

Login issues a **short-lived, signed bearer token** (JWT, HS256) that the client sends on every protected request.

- `POST /auth/login` accepts `{ email, password }`, verifies the password against the stored **bcrypt** hash, and returns `{ token, tokenType: "Bearer", user }`.
- Tokens are signed with `JWT_SECRET` and expire after `JWT_EXPIRES_IN` seconds (default 900 = 15 minutes).
- The token carries only the user id in its `sub` claim. **Roles and memberships are never embedded in the token** — they are loaded from PostgreSQL on every request, so a role change or membership revocation takes effect immediately without waiting for the token to expire.
- Send the token as: `Authorization: Bearer <token>`.

Every login failure — unknown email, wrong password, or a deactivated account — returns the same generic `401 { "error": "Invalid email or password" }`, so account existence is never disclosed. Malformed input returns `400`.

### Endpoints added

| Endpoint | Auth | Description |
|---|---|---|
| `POST /auth/login` | None | Exchange email + password for a bearer token. |
| `GET /auth/me` | Required | Return the authenticated user's safe fields plus their team memberships and roles. |

### Required environment variables

Set in `backend/.env` (gitignored). See `backend/.env.example` for blank placeholders.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string. |
| `JWT_SECRET` | Yes | Signing secret for auth tokens (min 32 chars). Never commit a real value. |
| `JWT_EXPIRES_IN` | No | Token lifetime in seconds (default `900`). |

### Demo login (development-only)

The seed creates 10 users that all share one password. In `backend/.env`, set `DEMO_PASSWORD` (defaults to `newtonite-demo`) before running `npm run seed`. Then:

```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"avery@newtonite.dev","password":"newtonite-demo"}'
```

*These credentials are for local development only — do not reuse them anywhere real.*

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
- No frontend login screen yet (backend only).
- Tokens are stateless; a compromised `JWT_SECRET` requires rotating the secret. Keep it strong and private.

### Running the Application

```bash
# Start backend (dev)
cd backend && npm run dev
# Start frontend (dev)
cd frontend && npm run dev
```

### Testing

```bash
cd backend

# Run all tests (Vitest). Requires DATABASE_URL + JWT_SECRET in backend/.env.
npm run test:run

# Type checking
cd backend && npx tsc --noEmit
cd ../frontend && npx tsc --noEmit

# Database (Drizzle)
cd ../backend && npm run db:generate
cd ../backend && npm run db:migrate
```

> **Note on test layers:** `src/auth/policy.test.ts` is a pure unit test (no database). `src/auth/auth.integration.test.ts`, `src/items/items.integration.test.ts`, `src/items/mutations.integration.test.ts`, and `src/verification.integration.test.ts` run against the configured Neon database and create/clean up their own throwaway fixtures — they never mutate the seeded demo dataset. The mutation suite also exercises genuine concurrency (overlapping requests) and reads the committed rows/activity/outbox back to prove the guarantees hold. The Phase 6 verification suite covers API error handling (malformed/oversized bodies), the full unauthenticated-token matrix on the items API, live membership/role changes, cross-team isolation, the pagination contract, input validation, idempotency guards, and live migration state.

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
- There is **no outbox worker** in this phase: jobs are durably enqueued only; delivery is future work.

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
- **No outbox worker / notification delivery.** Jobs are enqueued only. This is a deliberate deferral, not a correctness gap in the mutation path.
- **No idempotency purge job.** `expires_at` is a retention hint; cleanup is future work.
- **Claimability** is defined as `OPEN` or `IN_PROGRESS` over the existing status model (no new statuses); `AWAITING_APPROVAL`/`RESOLVED`/`CLOSED` are not claimable.
- **`ITEM_UPDATED` enum value** was added by additive migration `0001_yummy_the_captain.sql` (`ALTER TYPE ... ADD VALUE`) so a title/description/type/dueAt change has an accurate event type. No historical audit rows were rewritten.
- **Comments and activity-history read endpoints** remain out of scope (the `comments`/`activity_events` tables exist; only writes are implemented).
- The existing `work_items` indexes (`wi_team_status_updated_idx`, `wi_team_priority_status_updated_idx`, `wi_assignee_status_updated_idx`, plus the single-column indexes) already cover the team-scoped filter/sort access patterns; **no new index was required**.

## Phase 6 Verification (Integration, Security, Regression)

Phase 6 audited Phases 1–5 against the running application and the live Neon database (not mocks), then fixed genuine defects and added regression coverage. Full results are in the Phase 6 completion report; the summary:

- **Defects found and fixed** (minimal, in-design changes):
  1. A **malformed JSON body returned `500`** instead of `400`. The central error handler only recognised `ApiError`, so body-parser failures fell through to the generic server-error branch. Fixed in `src/app.ts` by mapping a middleware error that carries its own 4xx status (malformed JSON → `400`, oversized body → `413`) to that status with a generic, non-leaky message.
  2. An **out-of-range `page` returned `500`**. `page` had no upper bound, so a huge value produced an `OFFSET` such as `2e+21` that PostgreSQL rejects (`22P02 invalid input syntax for type bigint`). Fixed in `src/items/validation.ts` by capping `page` at `Number.MAX_SAFE_INTEGER` (which keeps `page × pageSize` within a bigint), rejecting absurd values with `400` rather than failing at the database.
- **Verification (all executed against real PostgreSQL, all passing):** authentication boundaries (missing/malformed/expired/forged tokens → `401`); login non-disclosure; response hygiene (no SQL, stack traces, or secrets in error bodies); live membership revocation and role promotion/demotion honoured on the next request; cross-team isolation across every mutation endpoint (`404`); the pagination contract incl. the preserved `pageSize > 100 → 400` rule; `PATCH`/create input validation; idempotency guards (over-long key rejected, validation failures not cached and key not consumed); and the live migration state (the `ITEM_UPDATED` enum value is applied and the two migrations are recorded).
- **Known limitation confirmed, not fixed here:** there is **no comments endpoint**, so the checklist's "cannot comment on another team's item" case has no matching route to exercise; item-level cross-team isolation is instead verified against every existing mutation endpoint. See the Phase 6 report.

## Critical Testing Requirements

The following behaviors are covered by real PostgreSQL integration tests in `src/items/mutations.integration.test.ts` and `src/verification.integration.test.ts` (run with `npm run test:run` in `backend/`). Concurrency cases use genuinely overlapping requests, not sequential calls:

1. **Concurrent claim** — exactly one succeeds; the loser gets `409 ALREADY_ASSIGNED` and writes no audit/outbox rows.
2. **Stale update** — rejected with `409 STALE_VERSION`; the stored row, activity history, and outbox are untouched.
3. **Idempotency** — duplicate and concurrent duplicate requests produce one logical operation; key reuse with a different payload is `409 IDEMPOTENCY_KEY_REUSED`.
4. **Workflow enforcement** — invalid transitions and unauthorized approvals fail; only the item's own-team Lead/Admin can approve.
5. **Resource authorization** — cross-team access is denied (`404`); a role held in another team grants nothing.
6. **Audit atomicity** — a failing activity/outbox insert rolls back the item mutation in the same transaction.

## Known Limitations (To Be Documented)

Known limitations will be documented during Phase 9 (Submission Hardening). Current known constraints from specification:
- User registration is out of scope (seeded demo users only)
- Reopening Closed items is out of scope
- No Redis, dedicated search engine, read replicas, or partitioning in initial build
- WebSockets, SSO, email delivery, file attachments are not part of initial implementation
- Transactional outbox **insertion** is implemented (jobs are written in the same transaction as the mutation); the outbox **worker** that would deliver/process jobs is not implemented in Phase 5.
- Idempotency records have no automated purge yet (`expires_at` is a retention hint).

## Submission Information

- **Submission Deadline:** Monday, 19 October 2026, 10:00 AM
- **Target Submission:** Monday, 19 October 2026, 9:30 AM (30-minute buffer)
- **Repository Access:** Public repository access (to be confirmed at submission)

### Fresh-Clone / Setup Reproducibility (verified in Phase 6)

- **Migrations:** the local Drizzle journal (`src/db/migrations/meta/_journal.json`, 2 entries) matches the live database: `drizzle.__drizzle_migrations` holds exactly 2 applied migrations whose recorded timestamps equal the journal's `when` values, and the additive `ITEM_UPDATED` enum value is present in `activity_event_type` with all prior values preserved. Local and remote migration state agree — no discrepancy and no history rewrite.
- **Seed:** `npm run seed` is idempotent (deterministic UUIDs + `onConflictDoUpdate`, no deletes). Two consecutive runs produced identical totals (`users: 10`, `work_items: 2500`, plus `teams: 4`, `memberships: 14`, `comments: 200`, `activity_events: 600`) with no duplicate rows.
- **Checks:** backend typecheck, frontend typecheck, and the backend production build all completed with exit code `0`; the full backend suite (unit + integration) passed. Lint is not configured (`npm run lint` is an explicit stub in both packages), and there are no frontend test files.

## License

This project is for assessment purposes as specified in the assignment.
