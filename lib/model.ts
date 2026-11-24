// Token Radar's model: a peer-fitted valuation, computed from the sealed snapshot.
//
// The board ranks every pre-token protocol the house's rule does not exclude:
// the watchlist (the floor, never the ceiling) plus the pre-token protocols below
// it, by one fitted number — the market cap the protocol's token would carry if
// its record stayed as it is. The number is fitted, never listed: a ridge
// regression of log market cap on log TVL, category, seven-day growth and tenure,
// fitted at run time on the snapshot's own tokened protocols that carry a market
// cap. No protocol name is ever special-cased; the same fitted function scores
// every row, and the program validates it at run time with two held-out checks
// (leave-one-out and walk-forward) against a flat baseline, reporting both.
//
//   log(mcap) ~ b0 + b1*log(tvl) + sum(category effects) + b_g*growth + b_a*log(age+1)
//
// The fit set is the snapshot's tokened protocols with a market cap above zero.
// Categories with fewer than five fit members share the baseline (no dummy).
// Growth is winsorised to [-20, +50] per cent so one wild week cannot move a
// value; age is log days since listing, unknown age counting as 365 days.
// The ridge penalty (lambda 10) shrinks the category effects toward zero; the
// intercept is never penalised. Everything is deterministic: the same snapshot
// bytes give the same coefficients, the same board and the same outputs.

/** One protocol of the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  launch_odds: number;
  model: {
    predicted_log_mcap: number;
    log_tvl: number;
    category_effect: number;
    growth_effect: number;
    age_effect: number;
    age_days: number | null;
  };
  farm_economics: { capital_usd: number; gas_usd: number; hours: number; usd_per_hour: number };
  farm_steps: string[];
}

/** The dashboard's compact view of one row (farm plan included, so page and board agree). */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  launch_odds: number;
  on_watchlist: boolean;
  predicted_log_mcap: number;
  log_tvl: number;
  category_effect: number;
  growth_effect: number;
  age_effect: number;
  farm_economics: { capital_usd: number; gas_usd: number; hours: number; usd_per_hour: number };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One held-out check: the model's median absolute log-error against the flat baseline's. */
export interface HeldOut {
  model: number;
  flat: number;
  n_test: number;
}

/** The fitted model, as the dashboard states it. */
export interface ModelReport {
  version: string;
  kind: string;
  lambda: number;
  n_fit: number;
  features: string[];
  coefficients: number[];
  top_categories: string[];
  loo: HeldOut;
  walk_forward: HeldOut;
  in_sample_r2: number;
  global_token_rate: number;
}

/** Everything the dashboard renders, from the snapshot. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelReport;
  watchlist: string[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export const MODEL_VERSION = 'radar-ridge-1';
export const RIDGE_LAMBDA = 10;
export const LIVE_ROWS = 24;
const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a protocol must not begin with (the watchlist's rule). */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
/** Categories the watchlist's rule keeps out: wrapped, staked and bridged products. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank: pre-token, and passing the
 * watchlist's own exclusion rule — no wrapped, staked or bridged product, no
 * versioned pool, no exchange's own product. The watchlist is the floor; this
 * rule is what keeps the early rows the same kind of subject.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  for (const e of EXCHANGES) if (p.name.startsWith(e)) return false;
  return true;
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** Growth in per cent, winsorised so one wild week cannot move a value. */
function growthPct(p: SnapshotProtocol): number {
  return Math.min(50, Math.max(-20, finite(p.change_7d, 0)));
}

/** Age in days for the model; unknown age counts as a year. */
function ageForModel(p: SnapshotProtocol, asOf: string): number {
  const age = ageDays(asOf, p.listed_at);
  return age === null ? 365 : age;
}

/** Categories with at least five members in the fit set, most members first. */
function topCategories(fit: SnapshotProtocol[]): string[] {
  const counts = new Map<string, number>();
  for (const p of fit) {
    if (p.category !== null) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 5)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([c]) => c);
}

/**
 * One protocol's feature row: [1, log TVL, category dummies, growth/100,
 * log(age+1)]. The feature names are the model's own vocabulary.
 */
export function featureRow(p: SnapshotProtocol, topCats: string[], asOf: string): number[] {
  const row: number[] = [1, Math.log(Math.max(1, p.tvl_usd))];
  for (const c of topCats) row.push(p.category === c ? 1 : 0);
  row.push(growthPct(p) / 100);
  row.push(Math.log(ageForModel(p, asOf) + 1));
  return row;
}

export function featureNames(topCats: string[]): string[] {
  return ['intercept', 'log_tvl', ...topCats.map((c) => `cat:${c}`), 'growth', 'log_age'];
}

/** Solve A x = b by Gaussian elimination with partial pivoting (A small and dense). */
function solveLinear(aIn: number[][], bIn: number[]): number[] {
  const n = bIn.length;
  const a = aIn.map((row) => [...row]);
  const b = [...bIn];
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    if (piv !== col) {
      [a[col], a[piv]] = [a[piv]!, a[col]!];
      [b[col], b[piv]] = [b[piv]!, b[col]!];
    }
    const diag = a[col]![col]!;
    if (diag === 0) throw new Error('ridge solve: singular matrix');
    for (let r = col + 1; r < n; r++) {
      const f = a[r]![col]! / diag;
      for (let c = col; c < n; c++) a[r]![c]! -= f * a[col]![c]!;
      b[r]! -= f * b[col]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r]!;
    for (let c = r + 1; c < n; c++) s -= a[r]![c]! * x[c]!;
    x[r] = s / a[r]![r]!;
  }
  return x;
}

/** Ridge fit of log mcap on the feature rows; the intercept is never penalised. */
function ridgeFit(X: number[][], y: number[], lambda: number): number[] {
  const k = X[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty = new Array<number>(k).fill(0);
  for (let i = 0; i < X.length; i++) {
    const row = X[i]!;
    for (let a = 0; a < k; a++) {
      xty[a]! += row[a]! * y[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += row[a]! * row[b]!;
    }
  }
  for (let d = 1; d < k; d++) xtx[d]![d]! += lambda;
  return solveLinear(xtx, xty);
}

/** Median of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Median absolute log-error of predictions against truth. */
function medianAbsLogError(yTrue: number[], yPred: number[]): number {
  return median(yTrue.map((t, i) => Math.abs(t - yPred[i]!)));
}

/**
 * Fit the ridge model on the snapshot's tokened protocols with a market cap,
 * and validate it with two held-out checks against a flat baseline (the median
 * log market cap): leave-one-out, and walk-forward (train on the earliest 70%
 * by listing date, test on the latest 30%). Returns the coefficients and both
 * checks, all computed from this snapshot at run time.
 */
export function fitModel(snapshot: Snapshot): { beta: number[]; topCats: string[]; report: ModelReport } {
  const fit = snapshot.protocols.filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0);
  if (fit.length < 20) throw new SnapshotError(`only ${fit.length} tokened protocols carry a market cap to fit on`);
  const topCats = topCategories(fit);
  const X = fit.map((p) => featureRow(p, topCats, snapshot.as_of));
  const y = fit.map((p) => Math.log(p.mcap_usd!));
  const beta = ridgeFit(X, y, RIDGE_LAMBDA);
  const pred = X.map((row) => row.reduce((s, v, i) => s + v * beta[i]!, 0));
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssRes = y.reduce((s, t, i) => s + (t - pred[i]!) ** 2, 0);
  const ssTot = y.reduce((s, t) => s + (t - yMean) ** 2, 0);
  const r2 = 1 - ssRes / ssTot;
  const flat = median(y);

  // Leave-one-out: refit without each protocol in turn.
  const looErr: number[] = [];
  const looFlatErr: number[] = [];
  for (let i = 0; i < fit.length; i++) {
    const Xi = X.filter((_, j) => j !== i);
    const yi = y.filter((_, j) => j !== i);
    const bi = ridgeFit(Xi, yi, RIDGE_LAMBDA);
    const pi = X[i]!.reduce((s, v, k) => s + v * bi[k]!, 0);
    looErr.push(Math.abs(y[i]! - pi));
    looFlatErr.push(Math.abs(y[i]! - flat));
  }
  // Walk-forward: earliest 70% by listing date train, latest 30% test.
  const dated = fit
    .map((p, i) => ({ i, age: ageDays(snapshot.as_of, p.listed_at) }))
    .filter((d) => d.age !== null)
    .sort((a, b) => b.age! - a.age!);
  const nTrain = Math.floor(dated.length * 0.7);
  const trainIdx = dated.slice(0, nTrain).map((d) => d.i);
  const testIdx = dated.slice(nTrain).map((d) => d.i);
  const Xtr = trainIdx.map((i) => X[i]!);
  const ytr = trainIdx.map((i) => y[i]!);
  const bWf = ridgeFit(Xtr, ytr, RIDGE_LAMBDA);
  const flatWf = median(ytr);
  const wfErr = testIdx.map((i) => Math.abs(y[i]! - X[i]!.reduce((s, v, k) => s + v * bWf[k]!, 0)));
  const wfFlatErr = testIdx.map((i) => Math.abs(y[i]! - flatWf));

  const report: ModelReport = {
    version: MODEL_VERSION,
    kind: 'ridge log-log OLS on the snapshot tokened peers (lambda 10), fitted at run time',
    lambda: RIDGE_LAMBDA,
    n_fit: fit.length,
    features: featureNames(topCats),
    // Six decimals, so the page's recompute from these stays far below the
    // displayed precision (four decimals left a visible few-dollar gap).
    coefficients: beta.map((b) => Math.round(b * 1e6) / 1e6),
    top_categories: topCats,
    loo: { model: Math.round(median(looErr) * 1000) / 1000, flat: Math.round(median(looFlatErr) * 1000) / 1000, n_test: fit.length },
    walk_forward: { model: Math.round(median(wfErr) * 1000) / 1000, flat: Math.round(median(wfFlatErr) * 1000) / 1000, n_test: testIdx.length },
    in_sample_r2: Math.round(r2 * 1000) / 1000,
    global_token_rate: 0, // filled by buildRadar
  };
  return { beta, topCats, report };
}

/** The fitted log market cap of one protocol, and its term-by-term breakdown. */
export function predictLog(p: SnapshotProtocol, beta: number[], topCats: string[], asOf: string): { log: number; logTvl: number; catEffect: number; growthEffect: number; ageEffect: number } {
  const feats = featureRow(p, topCats, asOf);
  const log = feats.reduce((s, v, i) => s + v * beta[i]!, 0);
  const catIdx = 2 + topCats.indexOf(p.category ?? '');
  return {
    log,
    logTvl: beta[1]! * feats[1]!,
    catEffect: catIdx >= 2 && p.category !== null && topCats.includes(p.category) ? beta[catIdx]! : 0,
    growthEffect: beta[beta.length - 2]! * feats[feats.length - 2]!,
    ageEffect: beta[beta.length - 1]! * feats[feats.length - 1]!,
  };
}

/** A protocol's implied launch value in whole dollars, at least $1. */
export function impliedValue(p: SnapshotProtocol, beta: number[], topCats: string[], asOf: string): number {
  return Math.max(1, Math.round(Math.exp(predictLog(p, beta, topCats, asOf).log)));
}

/** Launch odds: the protocol's category token rate, smoothed toward the global rate. */
export function launchOdds(p: SnapshotProtocol, snapshot: Snapshot): number {
  let total = 0;
  let tokened = 0;
  let catTotal = 0;
  let catTokened = 0;
  for (const q of snapshot.protocols) {
    total++;
    if (!isPreToken(q)) tokened++;
    if (p.category !== null && q.category === p.category) {
      catTotal++;
      if (!isPreToken(q)) catTokened++;
    }
  }
  const global = total === 0 ? 0.5 : tokened / total;
  if (p.category === null || catTotal === 0) return Math.round(global * 100) / 100;
  return Math.round(((catTokened + 10 * global) / (catTotal + 10)) * 100) / 100;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Lend $${capital} of USDC into ${name} on ${chain} and leave the loan open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave it in.`;
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Post $${capital} of USDC as margin on ${name} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} and take one market position.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy live.`;
  if (c.includes('chain')) return `Bridge $${capital} to the chain ${name} runs and use one of its native apps each week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** A step as one string: its action, then its cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page for its points.`;
  return s;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = capital >= 150 ? 8 : 4;
  return [
    { text: `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`, cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: action, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: `Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`, cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`, cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
    { text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`, cost: 'nothing but the log', time: '5 minutes' },
  ];
}

/** The farm's economics: capital, gas, hours and the implied dollars per hour. */
export function farmEconomics(p: SnapshotProtocol, age: number | null): { capital_usd: number; gas_usd: number; hours: number; usd_per_hour: number } {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = (capital >= 150 ? 8 : 4) + 3 + Math.ceil(hold / 7) * 2;
  const hours = Math.round((15 + 10 + 5 + Math.ceil(hold / 7) * 10) / 6) / 10;
  return { capital_usd: capital, gas_usd: gas, hours, usd_per_hour: Math.round((gas / Math.max(hours, 0.1)) * 100) / 100 };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; model: ModelReport } {
  const { beta, topCats, report } = fitModel(snapshot);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const pred = predictLog(p, beta, topCats, snapshot.as_of);
    const age = ageDays(snapshot.as_of, p.listed_at);
    return { p, pred, age };
  });
  scored.sort((a, b) => b.pred.log - a.pred.log || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: Math.max(1, Math.round(Math.exp(s.pred.log))),
    launch_odds: launchOdds(s.p, snapshot),
    model: {
      predicted_log_mcap: Math.round(s.pred.log * 1000) / 1000,
      log_tvl: Math.round(s.pred.logTvl * 1000) / 1000,
      category_effect: Math.round(s.pred.catEffect * 1000) / 1000,
      growth_effect: Math.round(s.pred.growthEffect * 1000) / 1000,
      age_effect: Math.round(s.pred.ageEffect * 1000) / 1000,
      age_days: s.age,
    },
    farm_economics: farmEconomics(s.p, s.age),
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
  let total = 0;
  let tokened = 0;
  for (const q of snapshot.protocols) {
    total++;
    if (!isPreToken(q)) tokened++;
  }
  report.global_token_rate = total === 0 ? 0.5 : Math.round((tokened / total) * 1000) / 1000;
  return { board, model: report };
}

/** A board row's compact form for data.js, with the farm plan included. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    launch_odds: row.launch_odds,
    on_watchlist: watchlist.has(row.slug),
    predicted_log_mcap: row.model.predicted_log_mcap,
    log_tvl: row.model.log_tvl,
    category_effect: row.model.category_effect,
    growth_effect: row.model.growth_effect,
    age_effect: row.model.age_effect,
    farm_economics: row.farm_economics,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, model } = buildBoard(snapshot);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    watchlist: snapshot.watchlist,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map((r) => radarRow(r, new Set(snapshot.watchlist))),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
