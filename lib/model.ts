// The token radar's model, radar-2: a comparable-multiple model.
//
// The board ranks every pre-token protocol the snapshot can rank: the whole 40-slug watchlist
// (the floor, never a ceiling) plus every other pre-token protocol below the floor that is not an
// exchange, a versioned pool or a wrapped product. A protocol is pre-token when its record carries
// no token at all: no market cap, no CoinGecko id, no symbol. Protocols whose token already trades
// are kept apart and shown with the market's own market cap, never mixed into the ranking. And a
// wrapped, staked or bridged product of a token that already trades is set aside too, by the
// watchlist's own rule: the snapshot records no market cap for WBTC, Binance staked ETH or USDT0,
// yet each is Bitcoin, ETH or USDT in another form, not a protocol waiting on a launch of its own.
//
// Implied value is derived from the snapshot's own figures, never from a hand-kept list of names:
//
//   multiple   = the category's FDV/TVL multiple, measured from the snapshot itself
//   growth     = clamp(change_7d, -50, 100) per cent
//   growthMult = 1 + (growth / 100) x 0.6
//   maturity   = 0.7 + min(age_days, 1460) / 1460 x 0.5   (age unknown: 365 days)
//   chains     = 1 + 0.04 x min(chains - 1, 4)
//   implied    = max(1, round(tvl_usd x multiple x growthMult x maturity x chains))
//
// The multiple is the model's heart. For each category, take the median of mcap_usd / tvl_usd over
// the snapshot's own token-bearing protocols in that category, then shrink it toward the global
// median with a prior weight of 3, so a category with one or two traded tokens does not swing the
// ranking on a single ratio; a category with no traded token at all takes the global median. The
// result is clamped to [0.01, 3.0]. No protocol name is ever special-cased: the same four functions
// score every row, and the dashboard shows each category's measured multiple beside its count.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max: number;
  prior_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  min_category_n: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_days: 1460,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_max: 4,
  prior_weight: 3,
  multiple_floor: 0.01,
  multiple_cap: 3.0,
  min_category_n: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

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
  model: {
    category_multiple: number;
    category_n: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row: an array, not an object, to keep data.js small. */
export type RadarRow = [
  rank: number,
  slug: string,
  name: string,
  category: string | null,
  chains: string[],
  tvl_usd: number,
  change_7d: number | null,
  age_days: number | null,
  implied_value_usd: number,
  category_multiple: number,
  growth_multiplier: number,
  maturity_multiplier: number,
  chain_multiplier: number,
];

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export type LiveRow = [
  slug: string,
  name: string,
  category: string | null,
  chains: string[],
  tvl_usd: number,
  mcap_usd: number | null,
  change_7d: number | null,
];

/** One category's measured multiple, for the dashboard's model table. */
export type CategoryMultiple = [category: string, multiple: number, n: number];

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  category_multiples: CategoryMultiple[];
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

/** The median of a sorted-by-value list; the list is sorted in place, so pass a copy. */
export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  return values.length % 2 === 1 ? values[mid]! : (values[mid - 1]! + values[mid]!) / 2;
}

/**
 * The FDV/TVL multiples the snapshot itself measures: the global median over every token-bearing
 * protocol, and one shrunk multiple per category that has at least `min_category_n` traded tokens.
 * A category with fewer traded tokens, or none, takes the global median. Every multiple is clamped
 * to [multiple_floor, multiple_cap] so one thin category cannot dominate the ranking. A market cap
 * of zero is no traded value — the token is dead, not cheap — so a zero ratio is left out of the
 * medians rather than dragging them down with worthless tokens.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, { multiple: number; n: number }> } {
  const byCat = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Other';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [ratio]);
    else list.push(ratio);
  }
  const globalRaw = median(all);
  const global = Math.min(model.multiple_cap, Math.max(model.multiple_floor, globalRaw));
  const byCategory = new Map<string, { multiple: number; n: number }>();
  for (const [cat, ratios] of byCat) {
    const n = ratios.length;
    if (n < model.min_category_n) continue;
    const catMedian = median([...ratios]);
    const shrunk = (n * catMedian + model.prior_weight * globalRaw) / (n + model.prior_weight);
    byCategory.set(cat, { multiple: Math.min(model.multiple_cap, Math.max(model.multiple_floor, shrunk)), n });
  }
  return { global, byCategory };
}

/** A protocol's category multiple: its category's measured multiple, or the global median. */
export function multipleFor(category: string | null, multiples: { global: number; byCategory: Map<string, { multiple: number; n: number }> }): { multiple: number; n: number } {
  const hit = category === null ? undefined : multiples.byCategory.get(category);
  if (hit !== undefined) return hit;
  return { multiple: multiples.global, n: 0 };
}

/** The four multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: { global: number; byCategory: Map<string, { multiple: number; n: number }> },
  model: ModelConstants = MODEL,
): { implied: number; categoryMultiple: number; categoryN: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { multiple, n } = multipleFor(protocol.category, multiples);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainCount = Math.max(protocol.chains.length, 1);
  const chainMult = 1 + model.chain_step * Math.min(chainCount - 1, model.chain_max);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult));
  return { implied, categoryMultiple: multiple, categoryN: n, growthPct, growthMult, maturityMult, chainMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** The categories the watchlist rule keeps out: a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A name carrying a whole word wrapped, staked or staking is a product of another token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** An exchange's own product begins with the exchange's name. */
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a protocol is a wrapped, staked or bridged product of a token that already trades: the
 * watchlist's own rule, applied to the whole board instead of only the watchlist. The snapshot
 * records no market cap for WBTC, Binance staked ETH or USDT0, so "records no token" alone would
 * rank them at the top — yet each is Bitcoin, ETH or USDT in another form, not a protocol waiting
 * on a launch of its own. No name is listed: the rule reads category and name the way the
 * watchlist does.
 */
export function isWrappedProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && WRAPPED_PRODUCT_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return true;
  return false;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not a wrapped product, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && !isWrappedProduct(p) && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What one transaction costs on a chain, in dollars, from the chain's usual fee level. */
export function gasUsd(chain: string): number {
  const c = chain.toLowerCase();
  if (c === 'solana') return 0.05;
  if (c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'blast' || c === 'mode' || c === 'zksync' || c === 'scroll' || c === 'linea') return 0.4;
  if (c === 'bsc' || c === 'bnb chain' || c === 'polygon' || c === 'avalanche') return 0.25;
  if (c === 'ethereum') return 8;
  return 1.5;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 500;
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 540) return 60;
  return 45;
}

/** The farm family a category belongs to: one verb set per way a protocol earns its users. */
export type FarmFamily =
  | 'lend'
  | 'dex'
  | 'yield'
  | 'bridge'
  | 'stake'
  | 'perps'
  | 'predict'
  | 'rwa'
  | 'stable'
  | 'insurance'
  | 'indexes'
  | 'payments'
  | 'other';

export function familyFor(category: string | null): FarmFamily {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'lend';
  if (c.includes('dex') || c.includes('liquidity manager')) return 'dex';
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm') || c.includes('allocator') || c.includes('curator')) return 'yield';
  if (c.includes('bridge')) return 'bridge';
  if (c.includes('stak') || c.includes('restak')) return 'stake';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis trading') || c.includes('options')) return 'perps';
  if (c.includes('prediction')) return 'predict';
  if (c.includes('rwa')) return 'rwa';
  if (c.includes('stable')) return 'stable';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('index')) return 'indexes';
  if (c.includes('payment') || c.includes('card issuer')) return 'payments';
  return 'other';
}

/** The family's core action: deposit the capital and use the protocol's own feature once. */
function coreAction(family: FarmFamily, name: string, capital: number, chain: string): string {
  switch (family) {
    case 'lend':
      return `Lend $${capital} of USDC on ${name} (${chain}), then borrow $20 against it and repay the borrow a week later.`;
    case 'dex':
      return `Add $${capital} of liquidity to the busiest ${name} pool on ${chain} and swap $25 through it the same day.`;
    case 'yield':
      return `Deposit $${capital} into the highest-TVL ${name} vault on ${chain} and let the yield compound in the vault.`;
    case 'bridge':
      return `Bridge $${capital} of USDC into ${chain} through ${name}, then bridge $25 back a week later to keep both directions active.`;
    case 'stake':
      return `Stake $${capital} of the chain asset through ${name} on ${chain} and hold the staking receipt in the same wallet.`;
    case 'perps':
      return `Deposit $${capital} of USDC as margin on ${name} (${chain}) and open one small long, then close it the same week.`;
    case 'predict':
      return `Fund your ${name} account with $${capital} on ${chain} and take a position in one market that resolves within a month.`;
    case 'rwa':
      return `Mint $${capital} of the yield-bearing asset on ${name} (${chain}) and hold it through one distribution.`;
    case 'stable':
      return `Mint $${capital} of the stable asset through ${name} on ${chain} and use it in one swap or payment.`;
    case 'insurance':
      return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full term.`;
    case 'indexes':
      return `Buy $${capital} of the ${name} index token on ${chain} and hold it through one rebalance.`;
    case 'payments':
      return `Top up $${capital} on ${name} (${chain}) and spend $25 of it through the app or card within the first week.`;
    default:
      return `Deposit $${capital} of USDC into ${name} on ${chain} and use its main feature once in the first week.`;
  }
}

/** The family's weekly recurring action: the habit that keeps the wallet counted. */
function weeklyAction(family: FarmFamily, name: string, chain: string): string {
  switch (family) {
    case 'lend':
      return `Once a week, add or remove $10 of collateral on ${name} so the position shows fresh activity.`;
    case 'dex':
      return `Once a week, swap $10 through ${name} on ${chain} and check the pool's fee earnings.`;
    case 'yield':
      return `Once a week, harvest or re-deposit $10 of yield inside the ${name} vault on ${chain}.`;
    case 'bridge':
      return `Once a week, bridge $10 in either direction through ${name} on ${chain}.`;
    case 'stake':
      return `Once a week, claim or restake the staking rewards ${name} pays on ${chain}.`;
    case 'perps':
      return `Once a week, open and close one $10 trade on ${name} (${chain}) and keep the margin posted.`;
    case 'predict':
      return `Once a week, take a $10 position in a new ${name} market on ${chain}.`;
    case 'rwa':
      return `Once a week, check the ${name} distribution on ${chain} and re-invest $10 of it.`;
    case 'stable':
      return `Once a week, use $10 of the stable asset in one ${name} transaction on ${chain}.`;
    case 'insurance':
      return `Once a week, confirm the ${name} policy on ${chain} is still active and note its expiry.`;
    case 'indexes':
      return `Once a week, check the ${name} index composition on ${chain} and add $10 after a rebalance.`;
    case 'payments':
      return `Once a week, spend $10 through ${name} on ${chain} so the account stays active.`;
    default:
      return `Once a week, do one small action in ${name} on ${chain}, such as a deposit, a swap or a vote.`;
  }
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category family, primary chain, TVL tier, age), never from a
 * hand-written list of names. Gas is priced per chain, so the same family costs differently on
 * Ethereum than on Solana or Base.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const family = familyFor(p.category);
  const gas = gasUsd(chain);
  const gasText = gas >= 1 ? `$${gas}` : `$${gas.toFixed(2)}`;
  return [
    {
      text: `Open a fresh wallet for this farm only, fund it with $${capital + 20}, and store its seed phrase on paper, never in a screenshot.`,
      cost: `about ${gasText} of gas for the first transfer`,
      time: '10 minutes',
    },
    {
      text: coreAction(family, p.name, capital, chain),
      cost: `$${capital} of capital and about ${gasText} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: weeklyAction(family, p.name, chain),
      cost: `about ${gasText} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days, so the activity spans more than one snapshot of the protocol.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw anything, open the protocol's own points or rewards page from its official site and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction hash, then revoke the spending approvals before you unwind the position.`,
      cost: `about ${gasText} of gas to revoke`,
      time: '10 minutes',
    },
  ];
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = categoryMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not just the largest. A protocol
  // below the floor is no worse a subject than one on it, and the board ranks all of them.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
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
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      // Full precision, not rounded: the page recomputes the row from these numbers, so a
      // rounded multiple would make the page's number differ from the board's by dollars.
      category_multiple: s.v.categoryMultiple,
      category_n: s.v.categoryN,
      growth_pct: s.v.growthPct,
      growth_multiplier: s.v.growthMult,
      maturity_multiplier: s.v.maturityMult,
      chain_multiplier: s.v.chainMult,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => [p.slug, p.name, p.category, p.chains, p.tvl_usd, p.mcap_usd, p.change_7d] as LiveRow);
}

/** A board row's compact form for data.js: an array, so the dashboard stays small. */
export function radarRow(row: BoardRow): RadarRow {
  return [
    row.rank,
    row.slug,
    row.name,
    row.category,
    row.chains,
    row.tvl_usd,
    row.change_7d,
    row.age_days,
    row.implied_value_usd,
    row.model.category_multiple,
    row.model.growth_multiplier,
    row.model.maturity_multiplier,
    row.model.chain_multiplier,
  ];
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const multiples = categoryMultiples(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const categoryTable: CategoryMultiple[] = [...multiples.byCategory.entries()]
    .map(([category, v]): CategoryMultiple => [category, round4(v.multiple), v.n])
    .sort((a, b) => b[2] - a[2] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(multiples.global),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    category_multiples: categoryTable,
    rows: board.map(radarRow),
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
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
