# Registration abuse protection

`register-patient` enforces atomic Postgres counters before account creation, file uploads, or email delivery. All function instances share the counters:

| Scope | Limit | Window |
| --- | --- | --- |
| Hosted ingress connection IP | 30 submissions | 15 minutes |
| Normalized email | 5 submissions | 1 hour |
| Student or Employee ID number | 5 submissions | 1 hour |

IP requests count before multipart parsing. Email/ID counters count after input validation and successful CAPTCHA when enabled, so failed CAPTCHA attempts do not consume another person's identity quota. Responses include HTTP 429, `Retry-After`, and a readable wait message. Security database failures return 503; they do not bypass the checks. The hosted ingress `CF-Connecting-IP` header is used rather than caller-selected `X-Forwarded-For`. Missing ingress metadata shares an `unknown` connection bucket. Self-hosted installations must adapt this to their trusted ingress configuration.

Counters store scope-specific HMAC hashes using the server service key, never raw IP/email/ID values. Their table is private with RLS; only the service role can execute the fixed-limit RPC. A daily cron job removes counters expired for more than one day. Service-key rotation resets their effective identity. Shared campus networks may reach the IP ceiling; adjust the migration's defaults if legitimate traffic requires higher capacity.

## Activate Turnstile

The integration is prepared but **CAPTCHA is inactive until real production keys are configured**. Neither dummy keys nor a local success check constitute production protection.

1. Create a **Managed** widget in [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile), allowing `campuscare-brown-two.vercel.app`.
2. In [Supabase → Edge Functions → Secrets](https://supabase.com/dashboard/project/hgmvlklvobkqhyvjnzmx/functions/secrets), add both values in one save:
   - `TURNSTILE_SITE_KEY`: the widget's public site key.
   - `TURNSTILE_SECRET_KEY`: its private secret key.
3. Reload registration. A human verification widget should appear before Submit Registration. Complete it and verify a normal registration and an expired/reused token in a controlled test.

Do not paste the secret in chat, commit it, or put it in Vercel's public frontend variables. The browser retrieves only the site key from the registration API; no frontend rebuild is needed. Supabase makes new secrets available without a function redeploy. With either value set but the other absent, registration returns 503 until configuration is complete. With both absent, only rate limiting is active.

The server calls Cloudflare Siteverify, requires `success: true`, action `campuscare_register`, and an exact allowed hostname. Cloudflare rejects expired/reused tokens. Provider failure, bad tokens, or wrong hostname/action stop account creation. The browser clears its token after every submission attempt. `TURNSTILE_HOSTNAMES` can optionally override the production hostname allowlist for additional controlled domains; do not allow local hosts in production.

## Close the alternate signup route

The public Auth settings currently report `disable_signup: false`. In Supabase **Authentication → Sign In / Providers**, turn **Allow new users to sign up** off after deploying the protected API. CampusCare's current registration uses the server Admin `createUser` endpoint, so it can continue creating pending accounts while direct public Auth signup is disabled. This dashboard setting is not exposed by the connected management tools and remains a manual activation step. Existing users can still sign in.

If email confirmation is restored later, the existing `publicClient.auth.signUp` branch must be adapted before disabling this restriction. Do not reopen unprotected public Auth signup as a shortcut. Do not enable global Auth CAPTCHA without integrating it into login/reset forms too.

These controls cover the **custom registration API**, not a full DDoS defense or identity verification.

## Validation

`npm test` includes the real handler with isolated Auth/Storage, rate-store, and Siteverify fixtures. `npm run test:browser` exercises CAPTCHA display, expiry, token submission, reset, and 429 feedback with intercepted services. `tests/registration-rate-limits.sql` checks actual database thresholds, expiry reset, and RPC permissions with random synthetic subjects. No real accounts or email messages are needed for these negative-path checks.
