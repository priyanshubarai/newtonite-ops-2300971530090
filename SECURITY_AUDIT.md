# Security Audit — Newtonite Operations Under Pressure

**Target:** `backend/` (Express + TypeScript) and `frontend/` (React 19 + TypeScript SPA)
**Audit date:** 2026-10-22
**Code under audit:** `31de25b` (contains the stabilisation changes listed in §8, reviewed as working-tree changes on top of `e67603f`)
**Method:** manual white-box review of every source file in `backend/src` and `frontend/src`, dependency audit (`npm audit`), live HTTP probing against the running app, and browser-driven verification of the authentication flow with Reticle.

> **Tooling note.** The autonomous scanning agent (Strix) was not used: its self-hosted CLI requires Docker, and this machine has no usable Docker engine (the `docker` CLI is installed, but `docker version` fails to reach the daemon). The published npm package could not be resolved either. Every finding below was therefore produced by manual review and then **confirmed against the running application** rather than inferred from source alone. Findings marked *Verified* carry the exact command and observed output.

---

## 1. Severity model

| Severity | Meaning |
|---|---|
| **Critical** | Unauthenticated compromise of confidentiality/integrity, credential exposure, or an authentication bypass reachable in the default configuration. |
| **High** | A real security defect with a credible attack path or a violated security contract (e.g. a session that survives an explicit sign-out). |
| **Medium** | Exploitable only under a non-default deployment condition, or a limited-impact disclosure / availability weakness. |
| **Low** | Defence-in-depth gap; no demonstrated attack path in the current design. |
| **Info** | Correct behaviour worth recording, or an observation with no security impact. |

**Status values used below:** `Fixed` (code changed and verified), `Open — accepted` (not fixed, with documented rationale and residual risk), `Open — deferred` (not fixed, with a scheduled follow-up), `Requires Architect Review` (not fixed; the disposition depends on a material architectural trade-off that this hardening pass is not authorised to take).

---

## 2. Summary

| Severity | Total | Fixed | Open / deferred |
|---|---:|---:|---:|
| Critical | 5 | 5 | 0 |
| High | 1 | 1 | 0 |
| Medium | 5 | 0 | 5 |
| Low | 6 | 0 | 6 |
| Info | 3 | — | — |
| **Total** | **20** | **6** | **11** |

**No Critical or High finding remains open.** M-01 to M-04 and the six Low findings are accepted risks with a recorded rationale. **M-05 is deferred and marked `Requires Architect Review`**: the vulnerable package is present, no reachable use of the vulnerable API was found, and the only fix is an effective-breaking upgrade of the whole data layer that needs its own regression pass and an explicit architectural decision.

### Finding index

| ID | Title | Severity | Status |
|---|---|---|---|
| C-01 | Auth credential returned in the login response body | Critical | Fixed |
| C-02 | Auth token persisted in `localStorage` (XSS-readable) | Critical | Fixed |
| C-03 | No rate limiting on `POST /auth/login` | Critical | Fixed |
| C-04 | No security response headers (no Helmet, no CSP) | Critical | Fixed |
| C-05 | `/health` publicly reachable in production | Critical | Fixed |
| H-01 | Sign-out did not invalidate the server session (cookie survived) | High | Fixed |
| M-01 | No account-level lockout — throttling is IP-only | Medium | Open — accepted |
| M-02 | Rate-limit counters are per-process and in-memory | Medium | Open — accepted |
| M-03 | `trust proxy` is not configured while `req.ip` drives throttling | Medium | Open — accepted |
| M-04 | `/health` internal-IP check trusts a client-supplied `X-Forwarded-For` | Medium | Open — accepted |
| M-05 | `drizzle-orm` in the range affected by CVE-2026-39356 | Medium | Open — Requires Architect Review |
| L-01 | CSP allows `'unsafe-inline'` for styles | Low | Open — accepted |
| L-02 | No `Permissions-Policy` header | Low | Open — accepted |
| L-03 | No password-complexity policy at the API boundary | Low | Open — accepted |
| L-04 | No server-side token revocation list | Low | Open — accepted |
| L-05 | Helmet's `xssFilter` option is a deprecated alias | Low | Open — accepted |
| L-06 | Demo accounts share one password | Low | Open — accepted |
| I-01 | JWT carries no roles or memberships | Info | — |
| I-02 | Access logs contain no headers, query strings or bodies | Info | — |
| I-03 | Outbox logs redact secrets and emit primitives only | Info | — |

---

## 3. Verified controls

These were checked directly and are **not** findings. They are recorded so a later reviewer knows they were tested, not skipped.

| Control | Evidence |
|---|---|
| Passwords hashed with bcrypt (`bcryptjs.compare`), never stored or logged in plaintext | `backend/src/auth/password.ts` |
| JWT algorithm pinned to HS256, so an `alg: none` or asymmetric token cannot be accepted | `backend/src/auth/tokens.ts` (`ALLOWED_ALGORITHMS = ["HS256"]`); a hand-crafted `alg:none` token was rejected with `401` in live probing |
| `JWT_SECRET` required from the environment, minimum 32 characters, never hardcoded | `backend/src/config/env.ts` |
| `.env` is git-ignored and untracked; only `.env.example` placeholders are committed | `git ls-files` lists no `.env`; `.gitignore` excludes `.env*` |
| Roles and memberships resolved from PostgreSQL on **every** request, never read from the token | `backend/src/auth/middleware.ts` → `findUserById`; `backend/src/items/service.ts` → `getTeamRole` |
| All `/items` routes require authentication; per-item authorisation uses the item's **real** team id from the database | `backend/src/items/routes.ts` (10 × `requireAuth`), `backend/src/auth/authorize.ts` |
| Cross-team access returns `404`, not `403`, so team membership cannot be enumerated | `backend/src/auth/authorize.ts`; covered by `auth.integration.test.ts` |
| Every SQL statement goes through Drizzle's parameterised builder — no user value is concatenated into SQL | `backend/src/items/repository.ts` (header comment); `sql` templates bind values |
| Sort columns come from a closed literal map of Drizzle column objects, never from a client string | `backend/src/items/repository.ts` (`SORT_COLUMNS`), `backend/src/items/validation.ts` (`z.enum(SORT_FIELDS)`) |
| `LIKE`/`ILIKE` metacharacters in free-text search are escaped | `backend/src/items/repository.ts` (`escapeLikePattern`) |
| Client-supplied `status`, `teamId`, `version` are rejected on write; `expectedVersion` is required | `backend/src/items/validation.ts` (`updateItemSchema`) |
| Every mutation, its activity event, its outbox job and its idempotency record commit in one transaction | `backend/src/common/idempotency.ts`, `backend/src/items/service.ts` |
| Login never discloses which credential failed (identical `401` body for unknown email, wrong password, inactive account) | `backend/src/auth/routes.ts` (`GENERIC_LOGIN_ERROR`); `auth.integration.test.ts` |
| Client-side API layer never logs tokens or credentials | `frontend/src/api/client.ts` |
| Client-side rendering escapes by default; no `dangerouslySetInnerHTML` anywhere | grep over `frontend/src` returned no matches |
| Frontend `npm audit --omit=dev` reports 0 vulnerabilities | `npm audit` output |

---

## 4. Critical findings (all fixed)

### C-01 — Auth credential returned in the login response body

**Severity:** Critical · **Status:** Fixed (in `e67603f`) · **Type:** CWE-522 (Insufficiently Protected Credentials)

**Finding.** `POST /auth/login` returned `{ token, tokenType: "Bearer", user }`. The bearer token was therefore present in the JSON response body, where any script running on the page — including one injected through a DOM XSS — could read it.

**Location.** `backend/src/auth/routes.ts` (login handler).

**Evidence (live, after the fix).** The response body observed in the browser network log and reproduced over HTTP is:

```json
{"tokenType":"Bearer","user":{"id":"…","email":"…","name":"…"}}
```

No token value is present. The token is delivered only as a `Set-Cookie` header.

**Remediation.** The login handler signs the token and writes it to an `HttpOnly` cookie; the JSON body returns only `tokenType` and the safe user profile. The frontend was migrated to cookie-based authentication in the same change.

**Verification.** Browser network capture of `POST /api/auth/login` → `200` with the body above; `grep` over `frontend/src` finds no consumer of a `token` field.

---

### C-02 — Auth token persisted in `localStorage` (XSS-readable)

**Severity:** Critical · **Status:** Fixed (in `e67603f`) · **Type:** CWE-922 (Insecure Storage of Sensitive Information)

**Finding.** The pre-fix frontend token store persisted the bearer token in `localStorage` under a fixed key, hydrating it synchronously at module load. Any script able to execute in the page origin could read it, and it survived a browser restart.

**Location (before).** `frontend/src/auth/tokenStore.ts` — *"Persistent bearer-token store using localStorage … localStorage is accessible via XSS"*.

**Evidence (live, after the fix).** Browser storage inspection of a signed-in session:

```json
{"local":{"newtonite_has_session":"true"},"cookies":{}}
```

The JS-visible cookie jar is **empty** — the auth cookie is `HttpOnly`, so JavaScript cannot read it — and the only thing in `localStorage` is a boolean session flag, never a credential.

**Remediation.** The token now lives only in the `HttpOnly` `auth_token` cookie. `frontend/src/auth/tokenStore.ts` tracks a boolean session flag; `frontend/src/api/client.ts` sends `credentials: "include"` and attaches **no** `Authorization` header.

**Verification.** The `Authorization` header is asserted absent in `frontend/src/api/client.test.ts`; the storage dump above was taken from a live, authenticated browser session.

---

### C-03 — No rate limiting on `POST /auth/login`

**Severity:** Critical · **Status:** Fixed (in `e67603f`) · **Type:** CWE-307 (Improper Restriction of Excessive Authentication Attempts)

**Finding.** The pre-fix `app.ts` contained no rate limiting of any kind, so the login endpoint accepted an unlimited number of credential attempts — unlimited online password guessing against any seeded account.

**Location.** `backend/src/app.ts` (pre-fix: `app.get("/health", healthCheck)` was the only guard, and there was no limiter on the auth path).

**Evidence (live, after the fix).** Seven consecutive bad-password attempts from one client address:

```
attempt 1: HTTP 401
attempt 2: HTTP 401
attempt 3: HTTP 401
attempt 4: HTTP 401
attempt 5: HTTP 401
attempt 6: HTTP 429  Retry-After=900
attempt 7: HTTP 429  Retry-After=900
```

**Remediation.** A `RateLimiterMemory` limiter is mounted on `/auth/login` with 5 attempts per 60 s and a 15-minute block, plus a general API limiter (100 requests / 60 s) on every request. Both are configurable by environment variable (`LOGIN_RATE_LIMIT_POINTS`, `LOGIN_RATE_LIMIT_DURATION`, `LOGIN_RATE_LIMIT_BLOCK_DURATION`, `API_RATE_LIMIT_POINTS`, `API_RATE_LIMIT_DURATION`).

**Verification.** The trace above. The backend suite raises these limits via `backend/vitest.config.ts` so the limiter never masks a functional failure.

---

### C-04 — No security response headers (no Helmet, no CSP)

**Severity:** Critical · **Status:** Fixed (in `e67603f`) · **Type:** CWE-1021 / CWE-693 (Improper Restriction of Rendered UI Layers or Frames)

**Finding.** The pre-fix app returned no security headers at all: no `Content-Security-Policy`, no `Strict-Transport-Security`, no `X-Content-Type-Options`, no `X-Frame-Options`, and `X-Powered-By: Express` disclosed the stack.

**Location.** `backend/src/app.ts`.

**Evidence (live, after the fix).** Raw response headers from `GET /health`:

```
Content-Security-Policy: default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'none';img-src 'self' data: https:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' 'unsafe-inline';upgrade-insecure-requests;connect-src 'self'
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
X-DNS-Prefetch-Control: off
X-Download-Options: noopen
X-Permitted-Cross-Domain-Policies: none
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Origin-Agent-Cluster: ?1
```

`X-Powered-By` is absent.

**Remediation.** `helmet@8.3.0` is mounted before the routes with an explicit CSP (`script-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`), HSTS at one year with subdomains and preload, `frameguard: deny`, `noSniff`, and `referrerPolicy: strict-origin-when-cross-origin`.

---

### C-05 — `/health` publicly reachable in production

**Severity:** Critical · **Status:** Fixed (in `e67603f`) · **Type:** CWE-200 (Exposure of Sensitive Information)

**Finding.** The pre-fix app registered `app.get("/health", healthCheck)` with no restriction, so in production the endpoint was reachable by any internet client and reported database reachability to anyone.

**Location.** `backend/src/app.ts`.

**Evidence (live, after the fix).** In production the handler returns `403 { "error": "Forbidden" }` for a client address that is not `127.0.0.1`, `::1`, or `::ffff:127.0.0.1`. (The restriction is bypassable in a specific way — see **M-04** — but the endpoint's disclosure surface is small: it returns only `{"status":"ok","database":"healthy"}`.)

**Remediation.** The route now checks `NODE_ENV === "production"` and the client address before delegating to `healthCheck`.

---

## 5. High findings

### H-01 — Sign-out did not invalidate the server session (the auth cookie survived)

**Severity:** High · **Status:** **Fixed in this cycle** · **Type:** CWE-613 (Insufficient Session Expiration)

This was the **one outstanding High finding** in the code as it stood at the start of this cycle, and it is a regression introduced by the move to cookie-based authentication.

**Finding.** After the token moved into an `HttpOnly` cookie, the frontend had **no call to `POST /auth/logout` anywhere** — `grep -r "auth/logout" frontend/src` returned no matches, and `git log --all -S "auth/logout" -- frontend/src` shows the endpoint was never called in any commit. The backend already exposed `POST /auth/logout` (it clears the cookie), but the client never called it.

Consequently, clicking **Sign out** cleared only client-held state (the session flag and the React Query cache). The `auth_token` cookie **remained in the browser**, remained valid, and remained usable for its full lifetime (up to `JWT_EXPIRES_IN`, 24 h by default in the schema; the local dev `.env` uses 900 s).

Two things made this worse than the previous design:

- The old design kept the token in `localStorage`, so the old "logout" at least *deleted the credential from the browser* (even though the stateless token stayed server-valid).
- The new design moved the credential into a cookie that **JavaScript cannot delete**. Clearing client state no longer removed the credential at all.

**Impact.** A user who signs out on a shared or compromised machine believes the session has ended, while a valid credential is still sitting in the browser's cookie store and still authenticates server-side. A token that leaks (disk, extension, log, another tab) is not invalidated by signing out. This violates the ordinary user expectation of "Sign out" and is exactly the condition CWE-613 describes.

**Evidence — before the fix.** The browser network log for the sign-out action contains **no request at all** from the sign-out click (only the font requests, `/api/auth/me` and `/api/items` from the preceding session). The frontend source contains no code path that can reach the logout endpoint.

**Remediation.** Three changes:

1. `frontend/src/api/auth.ts` — new `logout()` calling `POST /auth/logout` with `auth: false` (the endpoint clears the cookie, it does not need the token, and a `401` here must not be mistaken for an expired session).
2. `frontend/src/auth/AuthContext.tsx` — `signOut()` now issues that request (best-effort) **before** clearing local state. The local session is cleared regardless of whether the server call succeeds, so a network failure can never trap a user in a signed-in state.
3. The backend already clears the cookie correctly; a regression test now pins its exact attributes so the browser really deletes the original cookie.

**Evidence — after the fix (live, in the running app).**

```
before: sign-out click → no network request
after:  sign-out click → POST /api/auth/logout 200
```

Reticle verdict for the sign-out journey: `verified: "yes"` — *"Signing out ends the session on the SERVER as well as in the browser: the app calls POST /auth/logout so the HttpOnly auth cookie is cleared, rather than leaving a valid credential behind."*

The server's clearing header, captured over HTTP:

```
Set-Cookie: auth_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict
```

The clearing cookie repeats the original cookie's attributes (`Path`, `HttpOnly`, `SameSite`), which is required for the browser to replace rather than shadow the original.

**Regression tests added.**

| Test | Location |
|---|---|
| "ends the server session on sign-out so the auth cookie is cleared" — asserts exactly one `POST /auth/logout` request | `frontend/src/auth/session.test.tsx` |
| "still signs the user out locally when the logout request fails" — a `500` from logout must not trap the user | `frontend/src/auth/session.test.tsx` |
| "POST /auth/logout clears the auth cookie so the browser deletes it" — asserts the empty value, the past expiry, and the matching attributes | `backend/src/auth/auth.integration.test.ts` |
| "succeeds without a session so sign-out is never blocked" | `backend/src/auth/auth.integration.test.ts` |

---

## 6. Medium findings

### M-01 — No account-level lockout; throttling is IP-only

**Severity:** Medium · **Status:** Open — accepted

**Finding.** Both limiters key on the client address. An attacker who rotates source addresses can make unlimited password guesses against a single known account, and the 15-minute block is per address rather than per account.

**Why it is not fixed.** Account-level lockout requires either a persistent failure counter per account (a schema change and migration) or a shared store. The specification for this build explicitly excludes Redis and other new infrastructure, and the assignment's schema set is fixed. The current control still stops the single-source brute-force case, which is the realistic one against a seeded demo dataset.

**Residual risk.** Medium. A distributed credential-stuffing run against a single account is not throttled. **Follow-up:** if the schema is ever reopened, add an `auth_attempts` counter per account with a decaying window and a temporary account lock.

---

### M-02 — Rate-limit counters are per-process and in-memory

**Severity:** Medium · **Status:** Open — accepted

**Finding.** `RateLimiterMemory` keeps counters in the Node process. A deployment with N instances allows N × the configured limit, and every restart resets the counters.

**Why it is not fixed.** A shared store (Redis, or a PostgreSQL-backed counter) is outside the approved stack for this build.

**Residual risk.** Medium in a multi-instance deployment; negligible for the single-process setup the assignment describes.

---

### M-03 — `trust proxy` is not configured while `req.ip` drives throttling

**Severity:** Medium · **Status:** Open — accepted

**Finding.** Express' `trust proxy` setting is never configured (`grep "trust proxy" backend/src` → no matches), so `req.ip` is the TCP peer address. Behind a reverse proxy or load balancer every client therefore shares **one** rate-limit bucket: the whole site would be limited to 5 logins per minute collectively, and a single misbehaving client could lock out every user.

**Why it is not fixed.** The correct value depends on the deployment topology, which the repository cannot know. Enabling `trust proxy` without knowing the number of proxy hops would make the limit *less* accurate, not more.

**Residual risk.** Medium — availability, not confidentiality. **Follow-up:** document `app.set("trust proxy", <hops>)` in the deployment guide for any hosted deployment, and confirm the hop count with the platform.

---

### M-04 — `/health` internal-IP check trusts a client-supplied `X-Forwarded-For`

**Severity:** Medium · **Status:** Open — accepted

**Finding.** The production guard reads `req.headers["x-forwarded-for"]` directly, while `trust proxy` is **off** (M-03). Express therefore does not sanitise the header, and any client can send `X-Forwarded-For: 127.0.0.1` and satisfy the internal-address check, reaching `/health` in production.

**Why the severity is Medium rather than Critical.** The endpoint's disclosure surface is a single field pair — `{"status":"ok","database":"healthy"}`. It exposes no credentials, no version, no hostnames, no connection string, and no topology. The pre-fix exposure (C-05) was rated Critical because the endpoint was entirely open; the residual bypass is a partial re-open of a low-value endpoint.

**Residual risk.** Low-to-medium information disclosure about database reachability. **Follow-up:** resolve together with M-03 — read the client address through Express (`req.ip`) with `trust proxy` configured from the environment, rather than from a raw header.

---

### M-05 — `drizzle-orm` in the range affected by CVE-2026-39356

**Severity:** Medium in this application (advisory severity: High / CVSS 3.1 7.5) · **Status:** Open — Requires Architect Review

**Advisory.** `npm audit --omit=dev` in `backend/` reports one high-severity advisory:

| Field | Value |
|---|---|
| Advisory | GHSA-gpj5-g38j-94v9 |
| CVE | CVE-2026-39356 |
| Title | Drizzle ORM has SQL injection via improperly escaped SQL identifiers |
| Published | 2026-04-08 |
| Advisory severity | High — CVSS 3.1 7.5 (`AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N`) |
| Vulnerable ranges | `< 0.45.2` and `>= 1.0.0-beta.2, < 1.0.0-beta.20` |
| Installed | `drizzle-orm@0.36.4` (inside the first range) |
| First patched | `0.45.2`; `npm audit fix` targets `0.45.4` |
| Related tooling | `drizzle-kit@0.28.1`; current line is `0.31.x` |

**What the flaw is.** In affected versions the dialect `escapeName()` helpers wrapped an identifier in quotes/backticks without first doubling a delimiter embedded in the value. An application that passes attacker-controlled text into APIs that build identifiers or aliases — `sql.identifier()`, dynamic `.as()` aliases, dynamic report builders, CTE names — can therefore break out of the quoted identifier and inject SQL. The advisory states that applications using only static schema objects, or that strictly map user input through an allowlist of known column or alias names, are not affected.

**Reachability assessment.** No path from request input to identifier or alias construction was found in `backend/src`:

- `grep -E 'sql\.identifier|sql\.raw|\.as\(|escapeName' backend/src` → **no matches**. None of the APIs the advisory names is called.
- The only request-controlled value that influences query *shape* is sorting. It is resolved through a closed literal map of Drizzle column objects (`SORT_COLUMNS` in `backend/src/items/repository.ts`) after `z.enum(SORT_FIELDS)` has constrained it in `backend/src/items/validation.ts`; the value used for `ORDER BY` is always a schema object, never a string.
- `sql` tagged templates are used (`now()`, `count(*)::int`, version increments, advisory locks, outbox `CASE` expressions), but every interpolated *value* is a bound parameter and every interpolated *identifier* is a schema object imported from `db/schema`. None is built from request text.

**Why that is not recorded as "not vulnerable".** The evidence above is a source-level observation, not a runtime proof: it shows that the vulnerable code path is not reachable *through the code as it stands today*. It cannot exclude a helper added later, a future dynamic sort/report feature, or a transitive use this review missed. The installed package remains in the affected range, so `npm audit` will keep reporting it and the exposure returns as soon as one of those APIs is introduced.

**Why it is not fixed in this pass.** Remediation is `drizzle-orm` `0.36.4 → 0.45.4` (first patched `0.45.2`), which for a `0.x` package is an effective-major change to the whole data-access layer, plus `drizzle-kit` `0.28.1 → 0.31.x` for compatibility, migration regeneration, and a full regression run against the real PostgreSQL database. That is a broad, breaking data-layer migration rather than a hardening edit; taking it inside a stabilisation pass would trade a low, code-local risk for an unquantified migration risk. **The disposition requires an architect decision.**

**Residual risk.** Low in the code as reviewed. It is not closable by configuration and cannot be marked permanently accepted while the installed version stays in the affected range.

**Architect decision required.** Choose one:

1. **Schedule the upgrade** (recommended if the project continues): bump `drizzle-orm` to `^0.45.4` and `drizzle-kit` to `^0.31.11`, run `npm run db:generate` and confirm there is no unexpected migration diff, run the full backend suite (209 tests) and a manual smoke test against the real database, then re-run `npm audit --omit=dev` and confirm it reports zero findings.
2. **Accept the residual risk explicitly** for a defined period, with the reachability evidence above as the justification and a review trigger (any new dynamic sort/report/alias feature, or the next dependency cycle).

**Interim control (applies either way).** Treat `sql.identifier()`, `sql.raw()`, dynamic `.as()` aliases and any identifier built from request text as review-blocking in `backend/src`. The existing allowlist pattern in `repository.ts` is the approved way to vary query shape from input.

---

## 7. Low and informational findings

### L-01 — CSP allows `'unsafe-inline'` for styles

`styleSrc` is `"'self' 'unsafe-inline'`. Inline styles are permitted because the app sets element styles at runtime. The script surface is unaffected: `script-src 'self'` with `script-src-attr 'none'`, so inline event handlers are blocked. **Accepted** — tightening this requires moving to nonces or a CSS-in-JS-free inline-style policy, which is a UI refactor outside the security scope.

### L-02 — No `Permissions-Policy` header

The app requests no browser device permissions, so the default allow-list is not a real risk, but the header is a cheap hardening step. **Accepted** — low value for this application.

### L-03 — No password-complexity policy at the API boundary

`POST /auth/login` verifies the supplied password against the stored bcrypt hash; no length or complexity rule is enforced for new credentials, and there is no registration endpoint in scope. **Accepted** — see L-06.

### L-04 — No server-side token revocation list

Auth tokens are stateless; a leaked token stays valid until it expires. Partly mitigated by H-01 (signing out removes the browser's copy) and by a short `JWT_EXPIRES_IN`. A deny-list would need a `jti` claim plus a per-request lookup, which trades a stateless check for a stateful one on every request. **Accepted** — documented as a known limitation of the session design.

### L-05 — Helmet's `xssFilter` option is a deprecated alias

`helmet@8.3.0` still accepts `xssFilter` as a deprecated alias for `xXssProtection`; it emits `X-XSS-Protection: 0`, which is the modern recommendation (the header is obsolete in current browsers). The option is therefore harmless but misleading. **Accepted** — cosmetic; changing it would alter the header name without changing behaviour.

### L-06 — Demo accounts share one password

All seeded demo accounts share a single password so the demo dataset can be explored. The accounts are synthetic and development-only. **Accepted** — explicitly out of scope for a production deployment; the seed records the password as a bcrypt hash only.

### I-01 — The JWT carries no roles or memberships

The token payload is `{ sub }` plus the standard `iat`/`exp`/`iss`/`aud` claims. A role change or membership revocation therefore takes effect on the very next request, with no need to wait for expiry. This is the correct design and is recorded here so it is not mistaken for a gap.

### I-02 — Access logs contain no headers, query strings or bodies

`backend/src/lib/morgan.ts` logs method, path, status, duration, content length and request id only. The `Authorization` header, the `Cookie` header, the request body and the query string are never written to a log, so credentials cannot leak through the log pipeline. `backend/src/outbox/logging.ts` applies the same discipline to the worker.

### I-03 — Outbox logs redact secrets and emit primitives only

`redactSecrets` strips connection strings, passwords, bearer tokens, JWTs and long hex secrets from error messages, and log fields are restricted to primitives, so a payload object cannot be printed even by mistake.

---

## 8. Changes made in this cycle

| File | Change | Security effect |
|---|---|---|
| `frontend/src/api/auth.ts` | Added `logout()` → `POST /auth/logout` with `auth: false`. | Closes **H-01**. The endpoint clears the cookie, so it needs no token, and a `401` here must not be mistaken for an expired session. |
| `frontend/src/auth/AuthContext.tsx` | `signOut()` now ends the server session (best-effort) as well as the client session. | Closes **H-01**. The local session is cleared whether or not the request succeeds, so a network failure cannot trap a user in a signed-in state. |
| `frontend/src/auth/session.test.tsx` | Two new regression tests for the logout contract. | Pins **H-01** so it cannot come back silently. |
| `backend/src/auth/auth.integration.test.ts` | Two new regression tests pinning the clearing-cookie contract. | Pins **H-01**'s server side. |
| `frontend/src/api/client.test.ts` | Updated to the cookie contract; added a negative test for a sessionless `401`. | Prevents the sign-out handler from firing on a failed login. |
| `backend/src/items/mutations.integration.test.ts` | Three new tests for `GET /items/:id/comments` (contents, team scoping, pagination). | Closes a coverage gap on a route that reads team-scoped data. |
| `frontend/vitest.config.ts` | `testTimeout` raised from the 5 s default to 15 s, with the reason in a comment. | **No security effect.** The suite mounts the whole app in jsdom per test (~300–400 ms of render each), so a loaded machine could kill a passing test on latency alone. No assertion was weakened and no test was skipped. |
| `SECURITY_AUDIT.md` | This file, authored in this cycle. | Records the open findings, their residual risk, and the follow-ups. |
| `README.md`, `docs/ASSIGNMENT_CHECKLIST.md`, `test-result.md` | Documentation reconciled with the code and the test results. | Records which requirements are implemented, which are tested, and which remain unverified. |

**Files deliberately not touched.** `backend/package.json` (the `drizzle-orm` version), `backend/src/app.ts` (the `trust proxy` setting), and the seeded demo dataset. Each would have needed either a breaking dependency upgrade or a deployment-specific decision; see **M-02**, **M-03**, and **M-05** for the reasoning and the follow-up for each.

---

## 9. How to re-verify

```bash
# Backend suite (unit + real-PostgreSQL integration)
cd backend && npm run test:run

# Frontend suite
cd frontend && npm test -- --run

# Security headers
curl -s -D - -o /dev/null http://localhost:3000/health

# Login response headers + body (token must NOT appear in the body)
curl -s -D - -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  --data-binary @login-body.json

# Rate limiting (6th attempt must be 429)
for i in 1 2 3 4 5 6 7; do curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" --data-binary @login-body.json; done

# Dependency audit
cd backend && npm audit --omit=dev
cd ../frontend && npm audit --omit=dev
```

The browser-level checks (cookie flags, session restoration across a reload, sign-out, rejection of an invalid session, and blocking of an unauthenticated user) were driven with Reticle against the running application and are recorded in `test-result.md`.

> The rate-limit check above will block your own client address for 15 minutes once it trips — that is the control working as designed. Restart the backend to reset the in-memory counters.
