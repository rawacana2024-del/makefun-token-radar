// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable table, a per-protocol detail panel with the model's own
// inputs and the protocol's farm plan, and the live-token set the board sets aside. No network:
// every byte it shows is in data.js.
//
// Views by query: ?view=board (the board), ?view=detail&slug=<slug> (one protocol open),
// ?view=filtered&category=<cat>&chain=<chain>&q=<text> (the board, filtered). The page also
// recomputes each row's implied value from the snapshot figures, so the page's arithmetic and
// board.json's number are visibly the same.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var MODEL = DATA.model;

  // Rows arrive as compact arrays; name the positions once.
  function toRow(a) {
    return {
      rank: a[0], slug: a[1], name: a[2], category: a[3], chains: a[4], tvl_usd: a[5],
      change_7d: a[6], age_days: a[7], implied_value_usd: a[8], category_multiple: a[9],
      growth_multiplier: a[10], maturity_multiplier: a[11], chain_multiplier: a[12]
    };
  }
  function toLive(a) {
    return { slug: a[0], name: a[1], category: a[2], chains: a[3], tvl_usd: a[4], mcap_usd: a[5], change_7d: a[6] };
  }
  var ROWS = DATA.rows.map(toRow);
  var LIVE = DATA.live.map(toLive);
  var BY_SLUG = {};
  ROWS.forEach(function (r) { BY_SLUG[r.slug] = r; });

  var app = document.getElementById('board');
  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: params.get('slug') || null,
    view: params.get('view') || 'board'
  };
  if (state.view === 'filtered') state.tab = 'pre-token';
  if (state.view === 'detail' && !state.selected) state.view = 'board';

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(4); }

  // The model, recomputed in the page from the snapshot figures: the same four functions main.ts
  // runs, so a row's number here and in board.json must agree.
  function impliedOf(row) {
    var growth = Math.min(MODEL.growth_cap, Math.max(MODEL.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * MODEL.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? MODEL.unknown_age_days : row.age_days;
    var maturity = MODEL.maturity_floor + (Math.min(Math.max(age, 0), MODEL.maturity_days) / MODEL.maturity_days) * MODEL.maturity_range;
    var chainMult = 1 + MODEL.chain_step * Math.min(Math.max(row.chains.length, 1) - 1, MODEL.chain_max);
    return {
      implied: Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity * chainMult)),
      growthMult: growthMult, maturity: maturity, chainMult: chainMult, growth: growth, age: age
    };
  }

  // The farm plan is the same derivation main.ts writes to board.json: family, chain, TVL tier
  // and age decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function gasUsd(chain) {
    var c = chain.toLowerCase();
    if (c === 'solana') return 0.05;
    if (c === 'base' || c === 'arbitrum' || c === 'optimism' || c === 'blast' || c === 'mode' || c === 'zksync' || c === 'scroll' || c === 'linea') return 0.4;
    if (c === 'bsc' || c === 'bnb chain' || c === 'polygon' || c === 'avalanche') return 0.25;
    if (c === 'ethereum') return 8;
    return 1.5;
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 500;
    if (p.tvl_usd >= 1e9) return 250;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 180) return 90;
    if (age < 540) return 60;
    return 45;
  }
  function familyFor(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'lend';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'dex';
    if (c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('curator') >= 0) return 'yield';
    if (c.indexOf('bridge') >= 0) return 'bridge';
    if (c.indexOf('stak') >= 0 || c.indexOf('restak') >= 0) return 'stake';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis trading') >= 0 || c.indexOf('options') >= 0) return 'perps';
    if (c.indexOf('prediction') >= 0) return 'predict';
    if (c.indexOf('rwa') >= 0) return 'rwa';
    if (c.indexOf('stable') >= 0) return 'stable';
    if (c.indexOf('insurance') >= 0) return 'insurance';
    if (c.indexOf('index') >= 0) return 'indexes';
    if (c.indexOf('payment') >= 0 || c.indexOf('card issuer') >= 0) return 'payments';
    return 'other';
  }
  function coreAction(family, name, capital, chain) {
    switch (family) {
      case 'lend': return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + '), then borrow $20 against it and repay the borrow a week later.';
      case 'dex': return 'Add $' + capital + ' of liquidity to the busiest ' + name + ' pool on ' + chain + ' and swap $25 through it the same day.';
      case 'yield': return 'Deposit $' + capital + ' into the highest-TVL ' + name + ' vault on ' + chain + ' and let the yield compound in the vault.';
      case 'bridge': return 'Bridge $' + capital + ' of USDC into ' + chain + ' through ' + name + ', then bridge $25 back a week later to keep both directions active.';
      case 'stake': return 'Stake $' + capital + ' of the chain asset through ' + name + ' on ' + chain + ' and hold the staking receipt in the same wallet.';
      case 'perps': return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' (' + chain + ') and open one small long, then close it the same week.';
      case 'predict': return 'Fund your ' + name + ' account with $' + capital + ' on ' + chain + ' and take a position in one market that resolves within a month.';
      case 'rwa': return 'Mint $' + capital + ' of the yield-bearing asset on ' + name + ' (' + chain + ') and hold it through one distribution.';
      case 'stable': return 'Mint $' + capital + ' of the stable asset through ' + name + ' on ' + chain + ' and use it in one swap or payment.';
      case 'insurance': return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active for the full term.';
      case 'indexes': return 'Buy $' + capital + ' of the ' + name + ' index token on ' + chain + ' and hold it through one rebalance.';
      case 'payments': return 'Top up $' + capital + ' on ' + name + ' (' + chain + ') and spend $25 of it through the app or card within the first week.';
      default: return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + " and use its main feature once in the first week.";
    }
  }
  function weeklyAction(family, name, chain) {
    switch (family) {
      case 'lend': return 'Once a week, add or remove $10 of collateral on ' + name + ' so the position shows fresh activity.';
      case 'dex': return 'Once a week, swap $10 through ' + name + ' on ' + chain + " and check the pool's fee earnings.";
      case 'yield': return 'Once a week, harvest or re-deposit $10 of yield inside the ' + name + ' vault on ' + chain + '.';
      case 'bridge': return 'Once a week, bridge $10 in either direction through ' + name + ' on ' + chain + '.';
      case 'stake': return 'Once a week, claim or restake the staking rewards ' + name + ' pays on ' + chain + '.';
      case 'perps': return 'Once a week, open and close one $10 trade on ' + name + ' (' + chain + ') and keep the margin posted.';
      case 'predict': return 'Once a week, take a $10 position in a new ' + name + ' market on ' + chain + '.';
      case 'rwa': return 'Once a week, check the ' + name + ' distribution on ' + chain + ' and re-invest $10 of it.';
      case 'stable': return 'Once a week, use $10 of the stable asset in one ' + name + ' transaction on ' + chain + '.';
      case 'insurance': return 'Once a week, confirm the ' + name + ' policy on ' + chain + ' is still active and note its expiry.';
      case 'indexes': return 'Once a week, check the ' + name + ' index composition on ' + chain + ' and add $10 after a rebalance.';
      case 'payments': return 'Once a week, spend $10 through ' + name + ' on ' + chain + ' so the account stays active.';
      default: return 'Once a week, do one small action in ' + name + ' on ' + chain + ', such as a deposit, a swap or a vote.';
    }
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Keep the position open and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var family = familyFor(p.category);
    var gas = gasUsd(chain);
    var gasText = gas >= 1 ? '$' + gas : '$' + gas.toFixed(2);
    return [
      { text: 'Open a fresh wallet for this farm only, fund it with $' + (capital + 20) + ', and store its seed phrase on paper, never in a screenshot.', cost: 'about ' + gasText + ' of gas for the first transfer', time: '10 minutes' },
      { text: coreAction(family, p.name, capital, chain), cost: '$' + capital + ' of capital and about ' + gasText + ' of gas', time: '20 minutes to set up' },
      { text: weeklyAction(family, p.name, chain), cost: 'about ' + gasText + ' of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days, so the activity spans more than one snapshot of the protocol.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw anything, open the protocol's own points or rewards page from its official site and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Log the wallet, the dates and every transaction hash, then revoke the spending approvals before you unwind the position.', cost: 'about ' + gasText + ' of gas to revoke', time: '10 minutes' }
    ].map(stepText);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function writeSearch() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.selected) p.set('slug', state.selected);
    if (state.view !== 'board') p.set('view', state.view);
    var next = p.toString();
    window.history.replaceState(null, '', next ? window.location.pathname + '?' + next : window.location.pathname);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return ROWS.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', null, 'Source: ', el('b', { text: 'DefiLlama protocol index' })),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        el('p', null,
          'The watchlist is the floor: every protocol with at least ', el('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL that ', el('b', { text: 'records no token' }),
          '. The early radar adds ', el('b', { text: String(DATA.early_size) }),
          ' pre-token protocols below that floor — every rankable one in the snapshot. Implied value is the entry\u2019s own claim, never a promise, and never a prediction that a token will launch.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Early rows below the floor' }), el('b', { text: String(DATA.early_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.live_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Global FDV/TVL median' }), el('b', { text: fmtMult(DATA.global_multiple) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(ROWS.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(ROWS.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; state.view = state.q || state.category !== 'all' || state.chain !== 'all' ? 'filtered' : 'board'; writeSearch(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; state.view = state.q || state.category !== 'all' || state.chain !== 'all' ? 'filtered' : 'board'; writeSearch(); render(); });
    var chainSelect = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; state.view = state.q || state.category !== 'all' || state.chain !== 'all' ? 'filtered' : 'board'; writeSearch(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSelect),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.view = 'board'; writeSearch(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.category_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'status', text: 'records no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('multiple', 'FDV/TVL'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    LIVE.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status live', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their FDV/TVL ratios are what the model measures its multiples from.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = MODEL;
    var multRows = DATA.category_multiples.slice(0, 8).map(function (cm) {
      return el('tr', null,
        el('td', { text: cm[0] }),
        el('td', { class: 'num', text: String(cm[2]) }),
        el('td', { class: 'num', text: fmtMult(cm[1]) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row, from the snapshot\u2019s own figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'implied = round( tvl_usd \u00d7 category FDV/TVL \u00d7 growth \u00d7 maturity \u00d7 chains )' }),
        el('div', { text: 'category FDV/TVL: median mcap/tvl of the traded protocols in the category (n \u2265 3), shrunk toward the global median ' + fmtMult(DATA.global_multiple) + ' with prior weight ' + m.prior_weight + ', clamped [' + m.multiple_floor + ', ' + m.multiple_cap + ']; a category with fewer traded tokens takes the global median.' }),
        el('div', { text: 'growth = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 \u00d7 ' + m.growth_weight }),
        el('div', { text: 'maturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' \u00d7 ' + m.maturity_range + ' (age unknown: ' + m.unknown_age_days + ' days)' }),
        el('div', { text: 'chains = 1 + ' + m.chain_step + ' \u00d7 min(chains \u2212 1, ' + m.chain_max + ')' })
      ),
      el('table', { class: 'mult-table' },
        el('caption', { class: 'sub', text: 'Measured multiples: the largest categories by traded-token count. Every multiple below comes from this snapshot, not from a list.' }),
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Traded' }), el('th', { scope: 'col', text: 'FDV/TVL' }))),
        el('tbody', null, multRows)
      ),
      el('p', { class: 'note', text: 'Age is the time since DefiLlama first listed the protocol — the best record of how long it has run with no token on record. The early radar is every pre-token protocol below the watchlist floor, by implied value, and the live-token protocols are set aside with their market caps shown. Wrapped, staked and bridged products of a token that already trades are set aside too, by the same rule the watchlist uses: WBTC, Binance staked ETH and USDT0 are Bitcoin, ETH and USDT in another form, not protocols waiting on a launch of their own.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; state.view = 'board'; writeSearch(); render(); });

  function openDetail(slug) {
    var row = BY_SLUG[slug];
    if (!row) return;
    state.selected = slug;
    state.view = 'detail';
    writeSearch();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var calc = impliedOf(row);
    var matches = calc.implied === row.implied_value_usd;
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Category FDV/TVL (' + (row.category || 'Other') + ')' }), el('b', { class: 'num', text: fmtMult(row.category_multiple) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Growth multiplier' }), el('b', { class: 'num', text: fmtMult(calc.growthMult) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Maturity multiplier' }), el('b', { class: 'num', text: fmtMult(calc.maturity) })),
        el('div', null, el('span', { text: 'Chain multiplier (' + row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ')' }), el('b', { class: 'num', text: fmtMult(calc.chainMult) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(calc.implied) + (matches ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and not a prediction that a token will launch.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'Snapshot: ' + DATA.source + '. "Records no token" means DefiLlama records no token for the protocol; it is not proof that none exists.' }),
      el('span', { text: 'Implied value is this entry\u2019s own claim, derived from the snapshot\u2019s figures. It is not a price, not financial advice, and not a prediction that a token will launch.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected && BY_SLUG[state.selected]) openDetail(state.selected);
  }

  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
