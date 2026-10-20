# US-013 — User registration (Epic 6: Accounts)

**As a** new visitor,  
**I want to** create an account with my email and a password  
**so that** I can log in and use personalised features (saved searches, preferences).

## Acceptance criteria

### Registration
- A registration form accepts first name, email address, password and password confirmation
- Submitting valid details creates the account, logs the user in (same session as US-011) and redirects to the last visited page (or home if none)
- The email is stored lower-cased and trimmed, so `Alice@Example.com ` and `alice@example.com` are the same account
- Registering with an email that already has an account shows: "An account with this email already exists." with links to **Log in** and to social login (US-012); no account is created or changed
- Passwords are stored only as bcrypt hashes and are never returned or logged

### Password rules
- Minimum 8 characters
- Maximum 72 bytes (bcrypt's limit), counted in UTF-8 so non-ASCII characters are handled correctly
- Must not be the same as the email address
- Password and confirmation must match
- Rules are listed under the field before the user types, and each unmet rule is shown inline on blur

### Validation
- First name: required, 1–100 characters, surrounding whitespace trimmed
- Email: required, valid email format, at most 254 characters; shown inline on blur
- All fields show accessible error labels (linked via `aria-describedby`)
- Submitting with an empty or invalid field highlights the first invalid field and focuses it
- The server validates every rule independently of the frontend and returns field-level errors

### Abuse protection
- Registration is rate-limited per IP: 5 accounts per hour; further attempts show: "Too many sign-ups from this network. Try again later."
- The submit button is disabled while a request is in flight, so a double click creates one account

### Navigation
- The login page (US-011) links to registration: "New here? Create an account"
- The registration page links back: "Already have an account? Log in"
- A logged-in user who opens `/register` is redirected to home

### Negative / edge cases
- Mismatched password and confirmation shows: "Passwords don't match." and creates nothing
- A password of 7 characters, or more than 72 bytes, is rejected with the matching rule highlighted
- Two simultaneous registrations with the same email create exactly one account; the other gets the "already exists" message
- If the server is unreachable, an error banner says: "Couldn't create your account. Please try again." and the form keeps what was typed (except passwords)

## Example

**Happy path**

1. User opens `/register`
2. Enters `Philip` / `philip@example.com` / `••••••••••` / `••••••••••`
3. Clicks **Create account**
4. Redirected to `/` — nav shows "Philip"

**Email already registered**

> An account with this email already exists. Log in instead?

**Weak password**

> Use at least 8 characters.

## Implementation

- Frontend: `/register` page — first name, email, password and confirmation fields, rules checklist, error banner, loading state
- Backend:
  - `POST /api/auth/register` — body `{ firstName, email, password }`; validates, creates the user, issues the same `HttpOnly` session cookie as login; returns `201 { id, firstName, email }`
  - `409` when the email exists, `400` with field errors for invalid input, `429` when rate-limited
- Uniqueness is enforced by the existing unique constraint on `users.email`; a constraint violation maps to `409` (covers the simultaneous-registration case)
- Passwords hashed with bcrypt (`BCRYPT_ROUNDS = 12`, as US-011)
- Rate limiting backed by Redis:
  ```
  REGISTER_MAX_PER_IP   = 5
  REGISTER_WINDOW_MINS  = 60
  ```

## Out of scope

- Email verification (a follow-up story); accounts are usable immediately
- Password reset / forgotten password
- Social sign-up — see US-012 (an account can be created by signing in with a provider)
