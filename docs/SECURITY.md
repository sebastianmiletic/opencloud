# OpenCloud security operations

OpenCloud ships a Supabase publishable/legacy anon credential because browser and desktop clients
cannot keep client credentials secret. Database grants and Row Level Security are the security
boundary. Never ship a Supabase secret or service-role credential.

## Required production setup

1. Add `TMDB_BEARER_TOKEN`, `OMDB_API_KEY`, `SUPABASE_URL`, and `SUPABASE_ANON_KEY` as GitHub
   Actions secrets. Do not commit a populated `.env` file.
2. Apply all Supabase migrations, then push the Auth configuration so the
   `private.before_user_created` hook is active. Verify the hook rejects `@example.com`, missing
   installation IDs, and a sixth account on one installation.

   ```sh
   npx supabase login
   npx supabase link
   npx supabase db push
   npx supabase config push
   ```

   Authenticate in your own terminal. Never paste the access token or database password into chat,
   logs, source files, or command history.
3. Before enabling it in production, integrate Cloudflare Turnstile or hCaptcha with signup, then
   enable the matching provider under Supabase Authentication > Bot and Abuse Protection. CAPTCHA
   is the primary bot control; installation IDs are only an additional speed bump because client
   IDs can be reset.
4. Keep Supabase Auth rate limits enabled and review Authentication audit logs and Security Advisor
   findings regularly.
5. If any elevated credential is ever exposed, rotate it immediately. Removing it from the latest
   Git commit does not remove it from Git history or already-downloaded builds.

## Account cleanup

Migration `202609050001_signup_abuse_protection.sql` deletes only accounts whose normalized email
domain is exactly `example.com`. Existing foreign keys cascade deletion of those accounts' app data.
The cleanup records only an affected-account count in `private.security_cleanup_log`; it stores no
email addresses or credentials.

## Limits

No public desktop application is literally unhackable or unbottable. The enforced controls are
defense in depth: least-privilege RLS, a server-side signup hook, exact-domain blocking, a five-account
installation limit, serialized registration checks, stronger new passwords, restricted native-shell
navigation, denied runtime permissions, CAPTCHA, and platform rate limits.
