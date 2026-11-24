# Token Radar

A radar for protocols that record no token yet, ranked by the launch value a
peer-fitted model gives them, with a costed farm plan for each one. Built for
the make.fun bounty `token-radar-01`.

## Run it

```sh
node main.ts --input <snapshot.json> --output <dir>
```

Node 22 or later, standard library only, no network. The output directory
gets `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`.
Run it twice and the bytes are identical.

## What is inside

- `main.ts` — the entrypoint: reads the snapshot, fits the model, writes the
  board, the dashboard data and the dossier.
- `lib/model.ts` — the model and the board. A ridge regression (lambda 10)
  fitted at run time on the snapshot's tokened peers: log market cap on log
  TVL, category effects, 7-day growth and age. Validated leave-one-out and
  walk-forward against a flat baseline; the numbers are in `STRATEGY.md` and
  on the dashboard itself.
- `dashboard/` — a plain page (no framework, no network): the ranked board,
  a filter, a per-protocol detail view with the model broken into its terms
  and a costed farm plan, and a live-token view apart.
- `screenshots/` — the board, a detail view and a filtered view.
- `STRATEGY.md` — the strategy: the model, the honest validation numbers,
  the exclusion logic and the farm plans.

## Source

Snapshot: DefiLlama protocols, fetched 2026-11-14. The entry's own claim is
that a protocol records no token, never that it has none — and that a token
may never be issued.

## License

MIT. See `LICENSE`.
