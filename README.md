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

**Status:** Backend foundation (Phase 1), database schema and seed (Phase 2), authentication + team-scoped authorization (Phase 3), and the core work-item API — list, create, detail, update (Phase 4) — are implemented and verified. The frontend is scaffolded but product screens are not yet built.

See the [Assignment Checklist](docs/ASSIGNMENT_CHECKLIST.md) for detailed status of all requirements.

## Development Setup (Planned)

*The following setup instructions will be finalized during implementation phases. No working commands, credentials, or deployments are assumed in this documentation.*

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
npm run test:run     # vitest (no test files until Phase 6)
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

> **Note on test layers:** `src/auth/policy.test.ts` is a pure unit test (no database). `src/auth/auth.integration.test.ts` and `src/items/items.integration.test.ts` run against the configured Neon database and create/clean up their own throwaway fixtures — they never mutate the seeded demo dataset.

## Work-Item API (implemented — Phase 4)

Phase 4 adds the first work-item endpoints: listing, creation, detail, and partial update. All require authentication (see Phase 3) and every query is scoped to the caller's team memberships.

### Endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /items` | Required | List work items visible to the caller, with filtering, search, sorting, and pagination. |
| `POST /items` | Required | Create a work item in a team the caller can write to. |
| `GET /items/:id` | Required | Fetch one work item. |
| `PATCH /items/:id` | Required | Update permitted fields of one work item. |

### Team scoping

The caller only ever sees items from teams they are a member of. `GET /items` filters by the caller's team ids; `GET /items/:id` and `PATCH /items/:id` load the item first and authorize against the item's **real** team id from the database (never a client-supplied one).

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
| `page` | `1` | Integer ≥ 1. |
| `pageSize` | `20` | Integer 1–100. Values above the cap are **rejected with `400`**, not silently clamped. |
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

A subset of `title`, `description`, `type`, `priority`, `dueAt`, `assigneeId`. The body must contain at least one of these; an empty body or any protected field is rejected with `400`. This endpoint never changes `status`, `version`, `teamId`, or `createdBy`.

### Error semantics

| Status | When |
|---|---|
| `400` | Invalid body/query: bad enum values, malformed UUIDs **in the body**, unknown or protected fields, empty PATCH, out-of-range pagination, cross-team assignee. |
| `401` | Missing or invalid bearer token. |
| `403` | Authenticated member whose role lacks the action (e.g. a Viewer creating or editing). |
| `404` | Item missing, item belongs to a non-member team, or the `:id` is malformed (fail-closed). |

### Phase 4 scope notes

- **No activity/audit events are written yet.** Recording `ITEM_CREATED` and field-change events atomically with the mutation is Phase 5. The route → service → repository layering already isolates where the transactional write will go.
- **No optimistic concurrency yet.** `version` is read and returned but never incremented or checked — `PATCH` is last-write-wins in Phase 4. `repository.updateWorkItem` is the single extension point for Phase 5's conditional `WHERE id = ? AND version = ?` returning `409`.
- The claim endpoint, status-transition endpoint, comments, activity history, and idempotency handling are **out of Phase 4 scope**.
- The existing `work_items` indexes (`wi_team_status_updated_idx`, `wi_team_priority_status_updated_idx`, `wi_assignee_status_updated_idx`, plus the single-column indexes) already cover the team-scoped filter/sort access patterns; **no new index was required**.

## Critical Testing Requirements

The following behaviors must be verified with real PostgreSQL integration tests:
1. **Concurrent claim** - Exactly one succeeds; loser gets 409
2. **Stale update** - Rejected with 409; newer data intact
3. **Idempotency** - Duplicate requests produce one logical operation
4. **Workflow enforcement** - Invalid transitions/unauthorized approvals fail
5. **Resource authorization** - Cross-team access denied
6. **Audit atomicity** - Failed activity insert rolls back mutation

## Known Limitations (To Be Documented)

Known limitations will be documented during Phase 9 (Submission Hardening). Current known constraints from specification:
- User registration is out of scope (seeded demo users only)
- Reopening Closed items is out of scope
- No Redis, dedicated search engine, read replicas, or partitioning in initial build
- WebSockets, SSO, email delivery, file attachments are not part of initial implementation
- Transactional outbox worker is conditional (P1) and may be minimal/skipped if timeline constrained

## Submission Information

- **Submission Deadline:** Monday, 19 October 2026, 10:00 AM
- **Target Submission:** Monday, 19 October 2026, 9:30 AM (30-minute buffer)
- **Repository Access:** Public repository access (to be confirmed at submission)

### Fresh-Clone Verification (Planned)
Fresh-clone verification steps will be documented in Phase 9 to ensure reproducible setup from a clean checkout.

## License

This project is for assessment purposes as specified in the assignment.
