# Token Radar — strategy

## What the entry is
A radar for protocols that record no token yet, ranked by the launch value a
peer-fitted model gives them, with a costed farm plan for each one. The board
covers the whole 40-protocol watchlist and ranks 158 more pre-token protocols
below the floor by the same fitted value, so the watchlist is the floor, never
the ceiling.

## The value model
A ridge regression (lambda 10) fitted at run time on the snapshot's 128
tokened protocols that carry a market cap:

```
log(mcap) ~ intercept + log(TVL) + category effects + growth + log(age)
```

- `log(TVL)` is the size term; the fitted coefficient is about 0.48.
- Category effects are dummies for the nine categories with at least five fit
  members (Lending, Dexs, Liquid Staking, Yield, CEX, RWA, Canonical Bridge,
  Basis Trading, Bridge); other categories get no effect, never a hardcoded
  name.
- Growth is the 7-day change, winsorised to -20%..+50%, divided by 100.
- Age is log(age in days + 1); a protocol with no listing date is treated as
  one year old.
- No name is ever special-cased. The same fitted function scores every row.

## Why this model, and the honest check
The model was kept only because it beats a flat baseline (the median log
market cap of the fit set) on **both** held-out tests, measured by median
absolute log-error, the robust metric for a market cap that spans orders of
magnitude:

| test | model | flat |
| --- | --- | --- |
| leave-one-out (n = 128) | 1.321 | 1.353 |
| walk-forward, train earliest 70% by listing date, test latest 30% (n = 29) | 1.174 | 1.328 |

In-sample R-squared is 0.235. By log-RMSE the model does **not** beat flat on
walk-forward (a few extreme new listings dominate the squared error), so the
entry reports the median metric and names it; it does not claim the RMSE win.

## Launch odds
A protocol's launch odds are its category's token rate, smoothed toward the
global rate (0.549) with add-10 smoothing. A category with no tokened members
sits near the global rate; a category where almost everything already has a
token scores low. Odds are a prior for how likely a launch is, never a
prediction of when.

## What counts as rankable
A protocol is rankable when it records no token **and** is not a wrapped or
staked product of one that trades. That is the watchlist's full exclusion
logic, applied to every protocol, not just the watchlist: category not in
{Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC,
CEX}; no whole word wrapped / staked / staking in the name; name does not
start with Binance / Coinbase / Bybit / Kraken / Bitget / OKX / Bitfinex /
Gemini; not versioned. Tokened protocols are set aside into a separate
live-token view, shown by market cap, never mixed into the ranking.

## Farm plans
Each row carries six steps, written from the protocol's category and chains
(a lending farm deposits and borrows; a DEX farm provides liquidity and
swaps; a bridge farm moves funds across the chains it runs on), each with a
cost and a time, plus farm economics: capital, gas for the whole plan, hours,
and gas per hour. The plan is a starting point, never a promise: a token may
never be issued, and farming costs gas and time whether or not one is.

## What the dashboard shows, and how it stays honest
- The board, ranked by implied value, sortable and filterable by category,
  chain, name, and watchlist membership.
- A detail view per protocol with the model broken into its terms (intercept,
  log TVL, category effect, growth, age, predicted log market cap) and the
  page recomputing the implied value from the same fitted coefficients, so
  the page's code and the board's data are visibly the same arithmetic.
- A live-token view, apart, by market cap.
- The model section states the fitted regression, the coefficients, and both
  held-out validation numbers with the metric named.

## Determinism
`main.ts` reads only the snapshot and this repository, uses no network and no
clock, and writes the same bytes on every run (verified by running it twice
and diffing). The snapshot is the sealed one the kit ships.
