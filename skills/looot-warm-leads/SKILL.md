---
name: looot-warm-leads
description: Find warm B2B leads from LinkedIn intent signals (people engaging with competitor, creator or topic posts, new roles, hiring, funding), rank them with an explainable score, find verified emails and draft first messages, using the looot-warm-leads CLI. Use when asked for warm leads, intent leads, or an open-source alternative to Gojiberry.
---

# looot-warm-leads

Runs the looot-warm-leads CLI from a clone of https://github.com/loootai/looot-warm-leads.

1. Set the sources and ICP in `config/warm.config.json` (see `examples/sources.example.json`). Ask the user for competitors, creators, keywords and their ICP. Check with `npm run warm -- config`.
2. Quote first, no charge: `npm run warm -- run --dry-run`. Show the user the total and the per-step table. Ask before spending.
3. Real run, needs `LOOOT_TOKEN` (the user creates it in their looot settings under Agent tokens, scopes runs.execute, catalog.read, runs.read, usage.read, and funds the balance; setup is in the README under "What you need"): `npm run warm -- run --max-spend <usd> --since-last`. Exit code 2 means refused (quote above the cap, no token, no sources). Do not raise the cap on your own.
4. Read `out/new-<date>.md` and report the top leads with their score and the reasons. Name the provider and the evidence link behind each reason.
5. For leads the user picks, quote the email lookup: `npm run warm -- email --ids <id,id> --dry-run`, show it, then run without `--dry-run`.
6. Export: `npm run warm -- export --format instantly` (verified emails only) or `--format csv`.
7. If the summary shows pending calls, run the same command again the same day. Finished calls replay at no charge.

LinkedIn sending (optional, through the user's own Unipile account; setup steps are in the README under "Unipile setup"): you may queue drafts with `npm run warm -- outbox queue --ids <id>`. Never run `outbox approve` or `outbox tick --live` for the user. They review the text in the Outbox page or with `outbox list`, then approve it themselves. Tell them that sending volume is their responsibility under LinkedIn's terms.

To try it without a key: `npm run warm -- run --demo`.

No paid run has been verified against real provider responses. Say so when you report results. Weights and thresholds are in the config; change them only when the user asks.
