# Changelog

## Unreleased

- Fix: sign-in from Chrome failed with 403 "Cross-site request refused". The `Referrer-Policy: no-referrer` header makes Chrome send `Origin: null`. The same-origin check now ignores a `null` origin and falls back to `Sec-Fetch-Site`.

## 0.1.6

Spend limits, version 2. Before this, a paid run was limited by the cap per run, an in-memory rate limit and the token balance. Nothing limited spend across runs, two requests started together could both pass the cap, a key with the date in it made a repeat on a new day pay again, and a pending call was counted as $0. This covers both paid paths, the discovery run and the email lookup.

- Cap from the server only. The run and email caps come from `spend.runCapUsd` and `spend.emailCapUsd` in the config. A cap, a budget or a limit in a request body is ignored, and a test proves it.
- Period budget: a daily and a monthly amount (UTC), $10 and $50 by default, saved in `budget.json`. The signed-in owner changes it on the Cost page (`PUT /api/budget`, session and CSRF token). `WARM_DAILY_USD` and `WARM_MONTHLY_USD` set the starting values.
- Check order: the quote, the cap per run, an atomic reservation against the period budget, then the call.
- Reserve then settle: each paid call reserves its list price under a lock file before it is made, and is refused if used plus reserved plus the price would pass either budget. The reservation becomes the real cost when the call ends and goes back when looot answers with an error. A call still running keeps its reservation. The next run reads pending calls back with `GET /v1/runs/{id}` and settles them. A reservation that cannot be looked up is released after 24 hours.
- Stable keys: one key per endpoint and normalised input, plus the refresh period (`floor(time / 24 hours)`) for discovery calls. No date or clock time in the key. A finished call is stored under its key, so a repeated request is answered with no call and no charge. Email lookups keep a key of lead and step.
- An email lookup that is refused by the cap or the budget no longer marks the lead as "find_failed". The lead stays as it was and a later run tries again.
- The sidebar spend panel and the Cost page show used, reserved and remaining for today and this month. The CLI prints what is left before a run.
- README: the Spending and Securing a deployment sections describe the new limits. The token balance is still the final limit.

Migration: none. This repo has no database. The budget is a new file, `budget.json`, created in `WARM_DIR` on first use. Run one instance on a persistent disk, since the file is not shared between hosts.

## 0.1.5

Admin sign-in for every admin page and route, CSRF protection, reviewed-hash sends and server-side caps. Versions 0.1.4 and older had no admin authentication. See the v0.1.5 release notes.
