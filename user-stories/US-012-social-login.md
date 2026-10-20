# US-012 — Social login (Epic 6: Accounts)

**As a** user,  
**I want to** sign in with my Google or GitHub account  
**so that** I don't need to create and remember another password.

## Acceptance criteria

### Sign in
- The login (US-011) and registration (US-013) pages show **Continue with Google** and **Continue with GitHub** buttons
- Clicking a button sends the user to that provider's consent screen, then back to the app
- A returning user (provider account already linked) is logged in and redirected to the page they started from (or home)
- A new user (no account with that provider account or email) gets an account created from the provider profile — first name and email — and is logged in
- The session is the same as password login (US-011): `HttpOnly` cookie, 30-day expiry, logout works the same way
- Only a provider-verified email is accepted; a provider account without a verified email is refused with: "Your Google account has no verified email address."

### Existing accounts
- If an account with the same email already exists but isn't linked to this provider, the user is **not** logged in automatically. They see: "An account with this email already exists. Log in with your password to link Google." Linking happens after that password login
- A logged-in user can link Google and GitHub from their account page, and see which providers are linked
- A user who has both a password and linked providers can log in either way

### Security
- The sign-in flow uses OAuth 2.0 Authorization Code with PKCE
- A random `state` value is checked on return; a missing or mismatched `state` aborts sign-in
- Provider access tokens are not stored after sign-in; only the provider's user ID and email are kept
- The return URL after sign-in must be a path on this site; external URLs are ignored and the user goes home

### Negative / edge cases
- Cancelling on the provider's consent screen returns to `/login` with: "Sign-in was cancelled."
- A provider error or timeout returns to `/login` with: "Couldn't sign in with Google. Please try again." and nothing is created
- Reusing an old or already-used sign-in link (replayed callback) is rejected
- A provider account already linked to a different user can't be linked again; the user sees: "This Google account is linked to another user."
- If a provider isn't configured (no client ID), its button is hidden instead of failing on click

## Example

**New user via Google**

1. User opens `/login` and clicks **Continue with Google**
2. Approves on Google's consent screen
3. Returns to `/` — nav shows "Philip"; an account now exists for `philip@gmail.com`

**Email already registered with a password**

> An account with this email already exists. Log in with your password to link Google.

**Cancelled**

> Sign-in was cancelled.

## Implementation

- Frontend:
  - provider buttons on `/login` and `/register`
  - "Linked accounts" section on the account page
- Backend:
  - `GET /api/auth/oauth/providers` — returns the configured providers, e.g. `["google", "github"]`
  - `GET /api/auth/oauth/{provider}/start` — creates `state` and a PKCE verifier (stored in Redis, 10-minute expiry) and redirects to the provider
  - `GET /api/auth/oauth/{provider}/callback` — validates `state`, exchanges the code, reads the verified email and profile, then logs in, creates or asks to link the account, and redirects
  - `POST /api/auth/oauth/{provider}/link` — links the provider to the logged-in user (after the callback)
  - `DELETE /api/auth/oauth/{provider}/link` — unlinks it, only if the user still has another way to log in (a password or another provider)
- Database:
  - new table `user_identities`: `id`, `user_id` → `users.id`, `provider`, `provider_user_id`, `email`, `created_at`; unique on (`provider`, `provider_user_id`)
  - `users.password_hash` becomes nullable, for accounts created through a provider; password login (US-011) rejects accounts without a password using the same generic error
- Configuration:
  ```
  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
  GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET
  OAUTH_REDIRECT_BASE_URL   = http://localhost:3100
  OAUTH_STATE_TTL_MINS      = 10
  ```

## Out of scope

- Other providers (Apple, Microsoft, Facebook) — the provider list is designed to extend
- Setting a password on a social-only account (needs password reset first)
- Importing anything from the provider beyond name and email
