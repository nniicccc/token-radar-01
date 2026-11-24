// Token Radar's plain dashboard. It reads window.RADAR (written beside dashboard/
// by main.ts) and renders the ranked board, a filterable table, a per-protocol
// detail view with the model's own inputs and the protocol's farm plan, and the
// live-token view. No network: every byte it shows is in data.js.
//
// The page recomputes a row's implied value from the snapshot figures and the
// fitted coefficients the data carries, and checks the number board.json
// carries, so the page's code and the board's data are visibly the same
// arithmetic. The model is a ridge regression fitted at run time on the
// snapshot's tokened peers; see the model box on the page for its terms.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlistOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The model in one function: the same arithmetic main.ts ran. Coefficients and
  // the category list come from the data, so the page never hardcodes the fit.
  function featuresOf(row) {
    var m = DATA.model;
    var f = [1, Math.log(Math.max(1, row.tvl_usd))];
    for (var i = 0; i < m.top_categories.length; i++) f.push(row.category === m.top_categories[i] ? 1 : 0);
    var g = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    f.push(Math.min(50, Math.max(-20, g)) / 100);
    var age = row.age_days === null || row.age_days === undefined ? 365 : row.age_days;
    f.push(Math.log(age + 1));
    return f;
  }
  function impliedOf(row) {
    var m = DATA.model;
    var f = featuresOf(row);
    var log = 0;
    for (var i = 0; i < f.length; i++) log += f[i] * m.coefficients[i];
    return Math.max(1, Math.round(Math.exp(log)));
  }

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    }
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = 1; });
    return Object.keys(seen).sort();
  }
  function chains() {
    var seen = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { seen[c] = 1; }); });
    return Object.keys(seen).sort();
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !DATA.watchlistSlugs[r.slug]) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sortedRows(rows) {
    var key = state.sort;
    var dir = state.dir;
    var val = function (r) {
      if (key === 'implied') return r.implied_value_usd;
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
      if (key === 'age') return r.age_days === null ? -Infinity : r.age_days;
      if (key === 'odds') return r.launch_odds;
      return r.rank;
    };
    return rows.slice().sort(function (a, b) {
      var d = (val(a) - val(b)) * dir;
      return d !== 0 ? d : (a.slug < b.slug ? -1 : 1);
    });
  }

  function oddsClass(o) { return o >= 0.5 ? 'odds hot' : o <= 0.25 ? 'odds cold' : 'odds'; }

  function renderBoard() {
    var rows = sortedRows(filteredRows());
    var wrap = el('div', { class: 'wrap' });

    var hero = el('header', { class: 'hero' });
    hero.appendChild(el('h1', { text: 'Token Radar: the next launches, ranked by what they would be worth' }));
    hero.appendChild(el('p', { class: 'lede', text: 'Every protocol DefiLlama tracks that records no token yet, ranked by the launch value a peer-fitted model gives it — and what to do to farm each one before it launches.' }));
    wrap.appendChild(hero);

    var stats = el('div', { class: 'stats' });
    [['Protocols in snapshot', DATA.rows.length + ' ranked · ' + DATA.watchlist_size + ' on the watchlist'],
     ['Snapshot', DATA.as_of],
     ['Board rows', String(DATA.board_size) + ' (' + DATA.early_size + ' below the floor)'],
     ['Model', DATA.model.version + ' · ' + DATA.model.n_fit + ' peers fitted']].forEach(function (s) {
      var d = el('div', { class: 'stat' });
      d.appendChild(el('b', { text: s[0] === 'Protocols in snapshot' ? DATA.board_size : s[1] }));
      d.appendChild(el('span', { text: s[0] }));
      stats.appendChild(d);
    });
    wrap.appendChild(stats);

    var m = DATA.model;
    var model = el('section', { class: 'model' });
    model.appendChild(el('h2', { text: 'How the value is fitted — and how it was checked' }));
    model.appendChild(el('p', {}, 'Implied value is <code>exp(b0 + b1·log TVL + category effects + b_g·growth + b_a·log age)</code>, a ridge regression (λ = ' + m.lambda + ') fitted at run time on the snapshot\u2019s ' + m.n_fit + ' tokened protocols that carry a market cap. No name is ever special-cased: the same fitted function scores every row.'));
    model.appendChild(el('p', {}, 'Held-out checks, median absolute log-error — leave-one-out <b>' + m.loo.model + ' vs flat ' + m.loo.flat + '</b> (n = ' + m.loo.n_test + '); walk-forward, trained on the earliest 70% by listing date and tested on the latest 30%, <b>' + m.walk_forward.model + ' vs flat ' + m.walk_forward.flat + '</b> (n = ' + m.walk_forward.n_test + '). In-sample R² ' + m.in_sample_r2 + '. The model beats the flat baseline (median log market cap) on both held-out checks.'));
    model.appendChild(el('p', {}, 'The watchlist is the floor, never the ceiling: the board covers all ' + DATA.watchlist_size + ' of its protocols and ranks ' + DATA.early_size + ' more pre-token protocols below the floor by the same fitted value. A protocol is said to <i>record</i> no token, never to have none.'));
    wrap.appendChild(model);

    var tabs = el('div', { class: 'tabs' });
    [['pre-token', 'Pre-token board (' + DATA.board_size + ')'], ['live', 'Live tokens (' + DATA.live_size + ')']].forEach(function (t) {
      var b = el('button', { text: t[1] });
      b.setAttribute('aria-pressed', state.tab === t[0] ? 'true' : 'false');
      b.addEventListener('click', function () { state.tab = t[0]; state.selected = null; render(); });
      tabs.appendChild(b);
    });
    wrap.appendChild(tabs);

    if (state.tab === 'live') { wrap.appendChild(renderLive()); wrap.appendChild(footerEl()); app.replaceChildren(wrap); return; }

    var ctl = el('div', { class: 'controls' });
    var search = el('input', { type: 'search', placeholder: 'Search name or slug…', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; renderTableOnly(); });
    ctl.appendChild(search);
    var catSel = el('select', { 'aria-label': 'Filter by category' });
    catSel.appendChild(el('option', { value: 'all', text: 'All categories' }));
    categories().forEach(function (c) { catSel.appendChild(el('option', { value: c, text: c })); });
    catSel.value = state.category;
    catSel.addEventListener('change', function () { state.category = catSel.value; render(); });
    ctl.appendChild(catSel);
    var chainSel = el('select', { 'aria-label': 'Filter by chain' });
    chainSel.appendChild(el('option', { value: 'all', text: 'All chains' }));
    chains().forEach(function (c) { chainSel.appendChild(el('option', { value: c, text: c })); });
    chainSel.value = state.chain;
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; render(); });
    ctl.appendChild(chainSel);
    var sortSel = el('select', { 'aria-label': 'Sort by' });
    [['implied', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7-day growth'], ['age', 'Sort: age'], ['odds', 'Sort: launch odds']].forEach(function (s) {
      sortSel.appendChild(el('option', { value: s[0], text: s[1] }));
    });
    sortSel.value = state.sort;
    sortSel.addEventListener('change', function () { state.sort = sortSel.value; render(); });
    ctl.appendChild(sortSel);
    var wl = el('label', { class: 'chk' });
    var wlBox = el('input', { type: 'checkbox' });
    wlBox.checked = state.watchlistOnly;
    wlBox.addEventListener('change', function () { state.watchlistOnly = wlBox.checked; render(); });
    wl.appendChild(wlBox);
    wl.appendChild(document.createTextNode('Watchlist only'));
    ctl.appendChild(wl);
    wrap.appendChild(ctl);

    wrap.appendChild(el('p', { class: 'count', text: rows.length + ' of ' + DATA.board_size + ' protocols shown · click a row for its model breakdown and farm plan' }));
    wrap.appendChild(tableEl(rows));
    var detailHost = el('div', { id: 'detail-host' });
    wrap.appendChild(detailHost);
    wrap.appendChild(noteEl());
    wrap.appendChild(footerEl());
    app.replaceChildren(wrap);
    app.setAttribute('aria-busy', 'false');
    if (state.selected) showDetail(state.selected);
  }

  function tableEl(rows) {
    var table = el('table', { class: 'board' });
    var thead = el('thead');
    var hr = el('tr');
    [['#', 'rank', ''], ['Protocol', 'name', ''], ['Category', 'category', ''], ['Chains', 'chains', ''],
     ['TVL', 'tvl', 'num'], ['7d', 'growth', 'num'], ['Age', 'age', 'num'],
     ['Implied value', 'implied', 'num'], ['Launch odds', 'odds', 'num']].forEach(function (c) {
      var th = el('th', { text: c[0] });
      if (c[2]) th.className = c[2];
      if (c[1] === state.sort) th.setAttribute('aria-sort', state.dir === -1 ? 'descending' : 'ascending');
      th.addEventListener('click', function () {
        if (state.sort === c[1]) state.dir = -state.dir;
        else { state.sort = c[1]; state.dir = c[1] === 'name' || c[1] === 'category' ? 1 : -1; }
        render();
      });
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    if (rows.length === 0) {
      var tr = el('tr');
      tr.appendChild(el('td', { colspan: '9', class: 'empty', text: 'Nothing matches this filter.' }));
      tbody.appendChild(tr);
    }
    rows.forEach(function (r) {
      var tr = el('tr');
      if (state.selected === r.slug) tr.className = 'sel';
      tr.appendChild(el('td', { class: 'num', text: String(r.rank) }));
      var name = el('td', { class: 'name' });
      name.innerHTML = '<b>' + esc(r.name) + '</b>' + (DATA.watchlistSlugs[r.slug] ? '<span class="wl">WATCHLIST</span>' : '') + '<span>' + esc(r.slug) + '</span>';
      tr.appendChild(name);
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { text: (r.chains || []).slice(0, 3).join(', ') || '—' }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var g = el('td', { class: 'num' });
      g.innerHTML = '<span class="' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</span>';
      tr.appendChild(g);
      tr.appendChild(el('td', { class: 'num', text: fmtAge(r.age_days) }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) }));
      var o = el('td', { class: 'num' });
      o.innerHTML = '<span class="' + oddsClass(r.launch_odds) + '">' + Math.round(r.launch_odds * 100) + '%</span>';
      tr.appendChild(o);
      tr.addEventListener('click', function () { state.selected = r.slug; showDetail(r.slug); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function renderLive() {
    var div = el('div');
    div.appendChild(el('p', { class: 'count', text: 'Protocols whose token already trades, by market cap — the market\u2019s own values, never a model\u2019s. They are the peers the model was fitted on, shown apart so the board never mixes them into the ranking.' }));
    var table = el('table', { class: 'board' });
    var thead = el('thead');
    var hr = el('tr');
    ['Protocol', 'Category', 'Chains', 'TVL', '7d', 'Market cap'].forEach(function (h, i) {
      var th = el('th', { text: h });
      if (i >= 3) th.className = 'num';
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var tr = el('tr');
      tr.style.cursor = 'default';
      var name = el('td', { class: 'name' });
      name.innerHTML = '<b>' + esc(r.name) + '</b><span>' + esc(r.slug) + '</span>';
      tr.appendChild(name);
      tr.appendChild(el('td', { text: r.category || '—' }));
      tr.appendChild(el('td', { text: (r.chains || []).slice(0, 3).join(', ') || '—' }));
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }));
      var g = el('td', { class: 'num' });
      g.innerHTML = '<span class="' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down') + '">' + fmtPct(r.change_7d) + '</span>';
      tr.appendChild(g);
      tr.appendChild(el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    div.appendChild(table);
    return div;
  }

  function showDetail(slug) {
    var host = document.getElementById('detail-host');
    if (!host) return;
    var r = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { r = DATA.rows[i]; break; }
    if (!r) { host.replaceChildren(); return; }
    var recomputed = impliedOf(r);
    // The page recomputes from coefficients rounded to six decimals, so it
    // agrees with the board to far below the displayed precision; a 0.1%
    // relative tolerance is the honest check for "the same number".
    var agrees = Math.abs(recomputed - r.implied_value_usd) <= Math.max(1, r.implied_value_usd * 0.001);
    var d = el('section', { class: 'detail' });
    d.appendChild(el('h2', {}, esc(r.name) + ' <span style="color:var(--muted);font-size:15px">#' + r.rank + ' · ' + esc(r.slug) + '</span>'));
    d.appendChild(el('p', { class: 'sub', text: (r.category || 'Uncategorised') + ' · ' + (r.chains || []).join(', ') + ' · TVL ' + fmtUsd(r.tvl_usd) + ' · 7d ' + fmtPct(r.change_7d) + ' · listed ' + fmtAge(r.age_days) + ' ago · ' + (DATA.watchlistSlugs[r.slug] ? 'on the watchlist' : 'below the watchlist floor') + ' · records no token' }));
    var head = el('p', {}, 'Implied launch value <b style="font-size:20px">' + fmtUsd(r.implied_value_usd) + '</b> · launch odds <b>' + Math.round(r.launch_odds * 100) + '%</b> (category token rate, smoothed).');
    d.appendChild(head);
    d.appendChild(el('h3', { text: 'How the value is made up' }));
    var terms = el('table', { class: 'terms' });
    [['Intercept', DATA.model.coefficients[0].toFixed(4)],
     ['log TVL (' + Math.log(Math.max(1, r.tvl_usd)).toFixed(2) + ' × ' + DATA.model.coefficients[1].toFixed(4) + ')', r.log_tvl.toFixed(3)],
     ['Category effect (' + (r.category || 'none') + ')', r.category_effect.toFixed(3)],
     ['Growth effect', r.growth_effect.toFixed(3)],
     ['Age effect', r.age_effect.toFixed(3)],
     ['Predicted log market cap', r.predicted_log_mcap.toFixed(3)],
     ['Page recompute from the same coefficients', fmtUsd(recomputed) + (agrees ? ' — agrees with the board' : ' (board: ' + fmtUsd(r.implied_value_usd) + ')')]].forEach(function (t) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: t[0] }));
      tr.appendChild(el('td', { text: t[1] }));
      terms.appendChild(tr);
    });
    d.appendChild(terms);
    d.appendChild(el('h3', { text: 'Farm plan — costed' }));
    var econ = el('div', { class: 'econ' });
    var fe = r.farm_economics;
    [['Capital', '$' + fe.capital_usd], ['Gas, whole plan', '$' + fe.gas_usd], ['Your time', fe.hours + ' h'], ['Gas per hour', '$' + fe.usd_per_hour + '/h']].forEach(function (e) {
      var box = el('div', {});
      box.innerHTML = esc(e[0]) + ': <b>' + esc(e[1]) + '</b>';
      econ.appendChild(box);
    });
    d.appendChild(econ);
    var ol = el('ol', { class: 'farm' });
    r.farm_steps.forEach(function (s) { ol.appendChild(el('li', { text: s })); });
    d.appendChild(ol);
    d.appendChild(el('p', { class: 'note', text: 'This is the entry\u2019s own claim, never make.fun\u2019s: a token may never be issued, and farming costs gas and time whether or not one is. Never pay to claim an airdrop.' }));
    host.replaceChildren(d);
    d.scrollIntoView({ block: 'nearest' });
  }

  function noteEl() {
    return el('p', { class: 'note', text: 'Source: DefiLlama protocols, fetched ' + DATA.as_of + '. Implied values are conditional: what a token would be worth if the protocol\u2019s record stayed as it is. The board never predicts whether or when a token is issued.' });
  }
  function footerEl() {
    return el('footer', { text: 'Token Radar · snapshot ' + DATA.as_of + ' · model ' + DATA.model.version + ' · ' + DATA.source });
  }
  function renderTableOnly() { renderBoard(); }
  function render() { renderBoard(); }

  DATA.watchlistSlugs = {};
  (DATA.watchlist || []).forEach(function (s) { DATA.watchlistSlugs[s] = true; });

  // Deep links for screenshots: #row=<slug> opens a detail, #cat=<category> filters.
  (function () {
    var hash = window.location.hash.replace(/^#/, '');
    var parts = hash ? hash.split('&') : [];
    parts.forEach(function (part) {
      var kv = part.split('=');
      if (kv[0] === 'row' && kv[1]) state.selected = decodeURIComponent(kv[1]);
      if (kv[0] === 'cat' && kv[1]) state.category = decodeURIComponent(kv[1]);
      if (kv[0] === 'tab' && kv[1]) state.tab = kv[1];
    });
  })();

  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.selected) { state.selected = null; render(); }
  });
})();
