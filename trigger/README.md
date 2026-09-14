# trigger

Cloudflare Worker that wakes up this repo's `refresh.yml` GitHub Actions workflow
on a reliable schedule (Cloudflare Cron Triggers), because GitHub's own
`schedule:` trigger is best-effort and was firing hours late (or not at all)
on this low-traffic repo.

Deploy: `npx wrangler deploy` from this directory.

Secrets (set once via `npx wrangler secret put <NAME>`, never committed):
- `GH_PAT` — a GitHub fine-grained PAT scoped only to this repository, with
  "Actions: Read and write" permission. Its only job is calling
  `POST /repos/AriannaG763/koala-margin-dashboard/actions/workflows/refresh.yml/dispatches`.
- `TEST_SECRET` — a random string; hitting this worker's URL with
  `?secret=<TEST_SECRET>` manually triggers the same dispatch, for testing
  outside the cron schedule.
