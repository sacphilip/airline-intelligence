# US-011 — User login (Epic 6: Accounts)

**As a** registered user,  
**I want to** log in with my email and password  
**so that** my preferences and saved searches are available across devices.

## Acceptance criteria

### Authentication
- Login form accepts an email address and a password
- Submitting valid credentials creates a session and redirects to the last visited page (or home if none)
- Submitting an incorrect email or password shows a single generic error: "Incorrect email or password" (no hint as to which field is wrong)
- The login form is rate-limited: 5 failed attempts in 10 minutes locks the account for 15 minutes and shows: "Too many attempts. Try again in 15 minutes."
- Passwords are never returned or logged; only a session token is issued

### Session
- Session persists across browser refreshes (stored in an `HttpOnly` cookie)
- Session expires after 30 days of inactivity
- Logging out clears the session cookie and invalidates the server-side session
- Concurrent sessions on multiple devices are allowed

### Navigation
- A "Log in" button is visible in the top-right nav when the user is not authenticated
- When logged in, the nav shows the user's first name (or email prefix) and a "Log out" option
- Unauthenticated users can use all read-only features; login is only required for personalised features (saved searches, preferences)

### Validation
- Email field: must be a valid email format; shown inline on blur
- Password field: required, no minimum length enforced at login (only at registration)
- Both fields show accessible error labels (linked via `aria-describedby`)

### Negative / edge cases
- Submitting the form with an empty field highlights the empty field and focuses it
- Navigating directly to a protected page while unauthenticated redirects to `/login?next=<original-path>` and resumes after login
- A locked account shows the lockout message regardless of password correctness

## Example

**Happy path**

1. User opens `/login`
2. Enters `alice@example.com` / `••••••••`
3. Clicks **Log in**
4. Redirected to `/` — nav shows "Alice"

**Wrong password**

> Incorrect email or password.

**Locked out**

> Too many attempts. Try again in 15 minutes.

## Implementation

- Frontend: `/login` page — email + password form, error banner, loading state
- Backend:
  - `POST /api/auth/login` — validates credentials, issues a signed `HttpOnly` session cookie
  - `POST /api/auth/logout` — invalidates session server-side and clears cookie
  - `GET /api/auth/me` — returns `{ id, firstName, email }` for the current session (used to populate the nav)
- Session store: Redis (`SESSION_TTL_DAYS = 30`)
- Rate limiting: per-IP and per-email, backed by Redis; config:
  ```
  AUTH_MAX_ATTEMPTS  = 5
  AUTH_LOCKOUT_MINS  = 15
  AUTH_WINDOW_MINS   = 10
  ```
- Passwords stored as bcrypt hashes (`BCRYPT_ROUNDS = 12`)
- No OAuth in this story; social login is US-012
