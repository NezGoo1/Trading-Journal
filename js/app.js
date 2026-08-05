/* ============================================================
   app.js — UI controller: views, calendar, modals, data I/O
   ============================================================ */

const App = (() => {
  const state = {
    view: 'dashboard',
    calYear: null,
    calMonth: null, // 0-11
    filterText: '',
    filterResult: 'all', // all | win | loss
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cls = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : 'muted');

  /* ---------------- Boot ---------------- */
  function init() {
    const now = new Date();
    state.calYear = now.getFullYear();
    state.calMonth = now.getMonth();

    bindNav();
    bindTradeModal();
    bindGlobalModalClose();
    bindResize();

    render();
    registerSW();
    maybeShowInstallHint();
  }

  function bindNav() {
    $$('.tabbar__btn').forEach((btn) => {
      btn.addEventListener('click', () => navigate(btn.dataset.nav));
    });
    $('#addTradeBtn').addEventListener('click', () => openTradeModal());
  }

  function navigate(view) {
    state.view = view;
    $$('.tabbar__btn').forEach((b) => b.classList.toggle('tabbar__btn--active', b.dataset.nav === view));
    $$('.view').forEach((v) => v.classList.toggle('view--active', v.dataset.view === view));
    render();
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }

  let resizeTimer;
  function bindResize() {
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => render(), 180);
    });
  }

  /* ---------------- Render dispatch ---------------- */
  function render() {
    const trades = Store.getTrades();
    refreshStrategyList(trades);
    switch (state.view) {
      case 'dashboard': renderDashboard(trades); break;
      case 'calendar': renderCalendar(trades); break;
      case 'trades': renderTrades(trades); break;
      case 'analytics': renderAnalytics(trades); break;
      case 'data': renderData(trades); break;
    }
  }

  /* ================= DASHBOARD ================= */
  function renderDashboard(trades) {
    const root = $('#view-dashboard');
    const s = Calc.summary(trades);
    const settings = Store.getSettings();

    if (!trades.length) {
      root.innerHTML = '';
      root.appendChild(emptyState('Welcome to your journal 👋',
        'Log your first trade to unlock your calendar P&L, stats and analytics. Everything stays on this device.',
        'Add your first trade', () => openTradeModal(),
        'Or load sample data', () => loadSampleData()));
      return;
    }

    const dd = Calc.maxDrawdown(trades, settings.startingBalance);
    const pfDisplay = s.profitFactor === Infinity ? '∞' : Fmt.num(s.profitFactor, 2);
    const streakTxt = s.activeStreak
      ? `${s.activeStreak} ${s.activeSign > 0 ? 'win' : 'loss'}${s.activeStreak > 1 ? 's' : ''} in a row`
      : '—';

    root.innerHTML = `
      <div class="stat-grid">
        <div class="stat stat--hero">
          <div class="stat__label">Net P&amp;L</div>
          <div class="stat__value ${cls(s.net)}">${Fmt.money(s.net, { signed: true })}</div>
          <div class="stat__sub">${s.n} trade${s.n !== 1 ? 's' : ''} · ${Fmt.pct(s.winRate)} win rate · ${s.fees ? Fmt.money(s.fees) + ' fees' : 'no fees logged'}</div>
        </div>
        ${statCard('Win rate', Fmt.pct(s.winRate), `${s.wins}W / ${s.losses}L${s.scratches ? ' / ' + s.scratches + 'BE' : ''}`)}
        ${statCard('Profit factor', pfDisplay, s.profitFactor >= 1 ? 'profitable' : 'below 1.0', s.profitFactor >= 1 ? 'pos' : 'neg')}
        ${statCard('Expectancy', Fmt.money(s.expectancy, { signed: true }), 'avg / trade', cls(s.expectancy))}
        ${statCard('Avg win / loss', Fmt.num(s.payoff === Infinity ? 0 : s.payoff, 2) + 'R', `${Fmt.money(s.avgWin)} / ${Fmt.money(-s.avgLoss)}`)}
      </div>

      <div class="section-title">Equity curve</div>
      <div class="card chart-card">
        <div class="chart-card__head">
          <span class="chart-card__title">Account equity</span>
          <span class="chart-card__meta">Start ${Fmt.money(settings.startingBalance)} → ${Fmt.money(settings.startingBalance + s.net)}</span>
        </div>
        <div class="chart-wrap"><canvas id="equityChart"></canvas></div>
      </div>

      <div class="section-title">Daily P&amp;L</div>
      <div class="card chart-card">
        <div class="chart-wrap"><canvas id="dailyChart"></canvas></div>
      </div>

      <div class="section-title">Highlights</div>
      <div class="stat-grid">
        ${statCard('Best trade', Fmt.money(s.largestWin, { signed: true }), 'largest win', 'pos')}
        ${statCard('Worst trade', Fmt.money(s.largestLoss, { signed: true }), 'largest loss', 'neg')}
        ${statCard('Max drawdown', Fmt.money(-dd.maxDD), dd.maxDDPct ? Fmt.pct(dd.maxDDPct) + ' of peak' : '—', 'neg')}
        ${statCard('Current streak', streakTxt.split(' ')[0] === '—' ? '—' : streakTxt.split(' ')[0], s.activeSign > 0 ? 'winning' : (s.activeSign < 0 ? 'losing' : ''), s.activeSign > 0 ? 'pos' : (s.activeSign < 0 ? 'neg' : ''))}
      </div>
    `;

    // Charts
    const eq = Calc.equityCurve(trades, settings.startingBalance);
    const eqData = [{ label: '', value: settings.startingBalance }].concat(
      eq.map((p) => ({ label: DateUtil.shortMonth(DateUtil.parse(p.date).getMonth()) + ' ' + DateUtil.parse(p.date).getDate(), value: p.equity }))
    );
    Charts.area($('#equityChart'), eqData, { baseline: settings.startingBalance, height: 200 });

    const dayMap = Calc.byDay(trades);
    const dayData = Object.keys(dayMap).sort().map((d) => ({
      label: DateUtil.parse(d).getDate() + '/' + (DateUtil.parse(d).getMonth() + 1),
      value: dayMap[d].pnl,
    }));
    Charts.bars($('#dailyChart'), dayData, { height: 170 });
  }

  function statCard(label, value, sub, valueCls = '') {
    return `<div class="stat">
      <div class="stat__label">${esc(label)}</div>
      <div class="stat__value ${valueCls}">${value}</div>
      ${sub ? `<div class="stat__sub">${esc(sub)}</div>` : ''}
    </div>`;
  }

  /* ================= CALENDAR ================= */
  function renderCalendar(trades) {
    const root = $('#view-calendar');
    const y = state.calYear, m = state.calMonth;
    const dayMap = Calc.byDay(trades);

    // Month P&L + stats
    let monthPnl = 0, monthTrades = 0, greenDays = 0, redDays = 0;
    Object.keys(dayMap).forEach((d) => {
      const dt = DateUtil.parse(d);
      if (dt.getFullYear() === y && dt.getMonth() === m) {
        monthPnl += dayMap[d].pnl;
        monthTrades += dayMap[d].count;
        if (dayMap[d].pnl > 0) greenDays++; else if (dayMap[d].pnl < 0) redDays++;
      }
    });

    const firstDay = new Date(y, m, 1).getDay(); // 0 Sun
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const todayYMD = DateUtil.today();

    const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    let cells = dow.map((d) => `<div class="cal-dow">${d}</div>`).join('') + `<div class="cal-dow cal-dow--week">Wk</div>`;

    let dayNum = 1;
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
    let weekPnl = 0, weekHasData = false;

    for (let i = 0; i < totalCells; i++) {
      const col = i % 7;
      if (i < firstDay || dayNum > daysInMonth) {
        cells += `<div class="cal-cell cal-cell--empty"></div>`;
      } else {
        const ymd = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const info = dayMap[ymd];
        let clsList = 'cal-cell';
        let inner = `<div class="cal-cell__day">${dayNum}</div>`;
        if (info) {
          weekPnl += info.pnl; weekHasData = true;
          clsList += ' cal-cell--has ' + (info.pnl > 0 ? 'cal-cell--win' : (info.pnl < 0 ? 'cal-cell--loss' : ''));
          inner += `<div class="cal-cell__pnl ${cls(info.pnl)}">${Fmt.compactMoney(info.pnl)}</div>
                    <div class="cal-cell__count">${info.count} trade${info.count !== 1 ? 's' : ''}</div>`;
        }
        if (ymd === todayYMD) clsList += ' cal-cell--today';
        cells += `<div class="${clsList}" ${info ? `data-day="${ymd}"` : ''}>${inner}</div>`;
        dayNum++;
      }

      // End of week -> weekly total cell
      if (col === 6) {
        cells += `<div class="cal-week-cell">
          <div class="cal-week-cell__pnl ${weekHasData ? cls(weekPnl) : 'muted'}">${weekHasData ? Fmt.compactMoney(weekPnl) : '·'}</div>
          <div class="cal-week-cell__label">week</div>
        </div>`;
        weekPnl = 0; weekHasData = false;
      }
    }

    root.innerHTML = `
      <div class="cal-toolbar">
        <div class="cal-toolbar__nav">
          <button class="cal-nav-btn" id="calPrev" aria-label="Previous month">‹</button>
          <div class="cal-month">${DateUtil.monthName(m)} ${y}</div>
          <button class="cal-nav-btn" id="calNext" aria-label="Next month">›</button>
        </div>
        <div class="cal-summary">
          <div class="cal-summary__pnl ${cls(monthPnl)}">${Fmt.money(monthPnl, { signed: true })}</div>
          <div class="cal-summary__label">${monthTrades} trade${monthTrades !== 1 ? 's' : ''}</div>
        </div>
      </div>
      <div class="calendar">${cells}</div>
      <div class="stat-grid" style="margin-top:16px">
        ${statCard('Green days', String(greenDays), 'profitable sessions', 'pos')}
        ${statCard('Red days', String(redDays), 'losing sessions', 'neg')}
        ${statCard('Avg / day', monthTrades ? Fmt.money(monthPnl / Math.max(1, greenDays + redDays), { signed: true }) : '—', 'per trading day', cls(monthPnl))}
        ${statCard('Trades', String(monthTrades), 'this month')}
      </div>
      <div style="text-align:center;margin-top:14px">
        <button class="btn btn--ghost btn--sm" id="calToday">Jump to today</button>
      </div>
    `;

    $('#calPrev').addEventListener('click', () => { shiftMonth(-1); });
    $('#calNext').addEventListener('click', () => { shiftMonth(1); });
    $('#calToday').addEventListener('click', () => {
      const n = new Date(); state.calYear = n.getFullYear(); state.calMonth = n.getMonth(); renderCalendar(Store.getTrades());
    });
    $$('#view-calendar .cal-cell[data-day]').forEach((c) => {
      c.addEventListener('click', () => openDayModal(c.dataset.day));
    });
  }

  function shiftMonth(delta) {
    let m = state.calMonth + delta, y = state.calYear;
    if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
    state.calMonth = m; state.calYear = y;
    renderCalendar(Store.getTrades());
  }

  /* ================= TRADES ================= */
  function renderTrades(trades) {
    const root = $('#view-trades');
    if (!trades.length) {
      root.innerHTML = '';
      root.appendChild(emptyState('No trades yet', 'Add trades to build your history.', 'Add trade', () => openTradeModal()));
      return;
    }

    let list = Calc.sortByDate(trades, -1);
    const q = state.filterText.trim().toLowerCase();
    if (q) {
      list = list.filter((t) =>
        (t.symbol || '').toLowerCase().includes(q) ||
        (t.strategy || '').toLowerCase().includes(q) ||
        (t.notes || '').toLowerCase().includes(q) ||
        (t.tags || []).join(' ').toLowerCase().includes(q));
    }
    if (state.filterResult === 'win') list = list.filter(Calc.isWin);
    else if (state.filterResult === 'loss') list = list.filter(Calc.isLoss);

    const rowsHtml = list.map((t) => {
      const pnl = Calc.pnlOf(t);
      const meta = [
        DateUtil.prettyDate(t.date),
        t.qty ? `${Fmt.num(t.qty, 0)} @ ${t.entry ? Fmt.num(Number(t.entry), 2) : '—'}${t.exit ? '→' + Fmt.num(Number(t.exit), 2) : ''}` : null,
        t.strategy || null,
      ].filter(Boolean).join(' · ');
      const tags = (t.tags || []).slice(0, 3).map((tg) => `<span class="tag">${esc(tg)}</span>`).join('');
      return `<div class="trade-row" data-id="${t.id}">
        <div class="trade-row__badge trade-row__badge--${t.side === 'short' ? 'short' : 'long'}">${t.side === 'short' ? 'S' : 'L'}</div>
        <div class="trade-row__main">
          <div class="trade-row__sym">${esc((t.symbol || '—').toUpperCase())}</div>
          <div class="trade-row__meta">${esc(meta)}</div>
          ${tags ? `<div class="trade-row__tags">${tags}</div>` : ''}
        </div>
        <div class="trade-row__pnl">
          <div class="trade-row__pnl-val ${cls(pnl)}">${Fmt.money(pnl, { signed: true })}</div>
          ${t.r ? `<div class="trade-row__pnl-sub">${Fmt.num(Number(t.r), 1)}R</div>` : ''}
        </div>
      </div>`;
    }).join('');

    root.innerHTML = `
      <div class="trades-toolbar">
        <input type="search" id="tradeSearch" placeholder="Search symbol, strategy, tag…" value="${esc(state.filterText)}" />
        <select id="tradeResultFilter">
          <option value="all"${state.filterResult === 'all' ? ' selected' : ''}>All results</option>
          <option value="win"${state.filterResult === 'win' ? ' selected' : ''}>Winners</option>
          <option value="loss"${state.filterResult === 'loss' ? ' selected' : ''}>Losers</option>
        </select>
      </div>
      <div class="muted" style="font-size:12.5px;margin:0 2px 10px">${list.length} of ${trades.length} trades</div>
      ${rowsHtml || '<div class="empty"><div class="empty__text">No trades match your filter.</div></div>'}
    `;

    const search = $('#tradeSearch');
    search.addEventListener('input', (e) => { state.filterText = e.target.value; renderTrades(Store.getTrades()); const s = $('#tradeSearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });
    $('#tradeResultFilter').addEventListener('change', (e) => { state.filterResult = e.target.value; renderTrades(Store.getTrades()); });
    $$('#view-trades .trade-row').forEach((r) => r.addEventListener('click', () => {
      const t = Store.getTrades().find((x) => x.id === r.dataset.id);
      if (t) openTradeModal(t);
    }));
  }

  /* ================= ANALYTICS ================= */
  function renderAnalytics(trades) {
    const root = $('#view-analytics');
    if (!trades.length) {
      root.innerHTML = '';
      root.appendChild(emptyState('No analytics yet', 'Log trades to see performance breakdowns by symbol, strategy and day of week.', 'Add trade', () => openTradeModal()));
      return;
    }

    const s = Calc.summary(trades);
    const bySym = Calc.bySymbol(trades).slice(0, 8);
    const byStrat = Calc.byStrategy(trades).slice(0, 8);
    const byWd = Calc.byWeekday(trades);
    const wdNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Best / worst trades
    const sorted = [...trades].sort((a, b) => Calc.pnlOf(b) - Calc.pnlOf(a));
    const best = sorted.slice(0, 3);
    const worst = sorted.slice(-3).reverse();

    root.innerHTML = `
      <div class="section-title">P&amp;L by symbol</div>
      <div class="card">${barList(bySym.map((g) => ({ label: g.key, value: g.pnl, sub: `${g.count}× · ${Fmt.pct(g.winRate, 0)}` })))}</div>

      <div class="section-title">P&amp;L by strategy</div>
      <div class="card">${barList(byStrat.map((g) => ({ label: g.key, value: g.pnl, sub: `${g.count}× · ${Fmt.pct(g.winRate, 0)}` })))}</div>

      <div class="section-title">P&amp;L by day of week</div>
      <div class="card chart-card"><div class="chart-wrap"><canvas id="wdChart"></canvas></div></div>

      <div class="section-title">P&amp;L distribution</div>
      <div class="card chart-card"><div class="chart-wrap"><canvas id="distChart"></canvas></div></div>

      <div class="section-title">Best trades</div>
      <div class="card">${tradeMiniTable(best)}</div>

      <div class="section-title">Worst trades</div>
      <div class="card">${tradeMiniTable(worst)}</div>

      <div class="section-title">All metrics</div>
      <div class="card">${metricsTable(s)}</div>
    `;

    Charts.bars($('#wdChart'), byWd.map((b) => ({ label: wdNames[b.key], value: b.pnl })), { height: 170 });
    Charts.histogram($('#distChart'), trades.map(Calc.pnlOf), { height: 170, bins: 9 });
  }

  function barList(items) {
    if (!items.length) return '<div class="muted" style="font-size:13px">No data</div>';
    const maxAbs = Math.max(...items.map((i) => Math.abs(i.value)), 1);
    return `<div class="bars">${items.map((i) => {
      const w = (Math.abs(i.value) / maxAbs) * 50; // half-track
      const pos = i.value >= 0;
      return `<div class="bar-row">
        <div class="bar-row__label">${esc(i.label)}</div>
        <div class="bar-track"><div class="bar-center"></div>
          <div class="bar-fill ${pos ? 'bar-fill--pos' : 'bar-fill--neg'}" style="${pos ? `left:50%;width:${w}%` : `right:50%;width:${w}%`}"></div>
        </div>
        <div class="bar-row__val ${cls(i.value)}">${Fmt.money(i.value, { signed: true })}</div>
      </div>`;
    }).join('')}</div>`;
  }

  function tradeMiniTable(rows) {
    if (!rows.length) return '<div class="muted">No data</div>';
    return `<table class="mini-table"><thead><tr><th>Symbol</th><th>Date</th><th style="text-align:right">P&amp;L</th></tr></thead><tbody>${
      rows.map((t) => `<tr><td><strong>${esc((t.symbol || '—').toUpperCase())}</strong> <span class="muted">${t.side === 'short' ? 'S' : 'L'}</span></td><td class="muted">${DateUtil.prettyDate(t.date)}</td><td class="num ${cls(Calc.pnlOf(t))}">${Fmt.money(Calc.pnlOf(t), { signed: true })}</td></tr>`).join('')
    }</tbody></table>`;
  }

  function metricsTable(s) {
    const rows = [
      ['Total trades', s.n],
      ['Winners / Losers', `${s.wins} / ${s.losses}`],
      ['Win rate', Fmt.pct(s.winRate)],
      ['Net P&L', Fmt.money(s.net, { signed: true })],
      ['Gross profit', Fmt.money(s.grossProfit)],
      ['Gross loss', Fmt.money(-s.grossLoss)],
      ['Profit factor', s.profitFactor === Infinity ? '∞' : Fmt.num(s.profitFactor, 2)],
      ['Expectancy / trade', Fmt.money(s.expectancy, { signed: true })],
      ['Average win', Fmt.money(s.avgWin)],
      ['Average loss', Fmt.money(-s.avgLoss)],
      ['Payoff ratio', s.payoff === Infinity ? '∞' : Fmt.num(s.payoff, 2)],
      ['Largest win', Fmt.money(s.largestWin, { signed: true })],
      ['Largest loss', Fmt.money(s.largestLoss, { signed: true })],
      ['Best win streak', s.bestWinStreak],
      ['Worst loss streak', s.worstLossStreak],
      ['Avg R multiple', s.avgR == null ? '—' : Fmt.num(s.avgR, 2) + 'R'],
      ['Total fees', Fmt.money(s.fees)],
    ];
    return `<table class="mini-table"><tbody>${
      rows.map(([k, v]) => `<tr><td class="muted">${k}</td><td class="num">${v}</td></tr>`).join('')
    }</tbody></table>`;
  }

  /* ================= DATA / SETTINGS ================= */
  function renderData(trades) {
    const root = $('#view-data');
    const settings = Store.getSettings();
    const currencies = ['USD','EUR','GBP','JPY','CAD','AUD','INR','CHF','CNY'];

    root.innerHTML = `
      <div class="section-title">Account</div>
      <div class="card">
        <div class="data-row">
          <div class="data-row__text">
            <div class="data-row__title">Starting balance</div>
            <div class="data-row__desc">Used for equity curve &amp; drawdown</div>
          </div>
          <div class="field-inline">
            <input type="number" id="setBalance" value="${settings.startingBalance}" step="any" inputmode="decimal" />
          </div>
        </div>
        <div class="data-row">
          <div class="data-row__text">
            <div class="data-row__title">Currency</div>
            <div class="data-row__desc">Display symbol for all amounts</div>
          </div>
          <div class="field-inline">
            <select id="setCurrency" style="background:var(--bg-elev-2);border:1px solid var(--border);color:var(--text);border-radius:10px;padding:8px 10px;font-size:14px">
              ${currencies.map((c) => `<option value="${c}"${c === settings.currency ? ' selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="section-title">Backup &amp; export</div>
      <div class="card">
        <div class="data-row">
          <div class="data-row__text">
            <div class="data-row__title">Export JSON backup</div>
            <div class="data-row__desc">${trades.length} trades · full backup you can re-import</div>
          </div>
          <button class="btn btn--ghost btn--sm" id="exportJson">Export</button>
        </div>
        <div class="data-row">
          <div class="data-row__text">
            <div class="data-row__title">Export CSV</div>
            <div class="data-row__desc">Open in Excel / Google Sheets</div>
          </div>
          <button class="btn btn--ghost btn--sm" id="exportCsv">Export</button>
        </div>
      </div>

      <div class="section-title">Import</div>
      <div class="card">
        <div class="data-row">
          <div class="data-row__text">
            <div class="data-row__title">Import JSON backup</div>
            <div class="data-row__desc">Replaces current data</div>
          </div>
          <button class="btn btn--ghost btn--sm" id="importJsonBtn">Choose file</button>
        </div>
        <div class="data-row">
          <div class="data-row__text">
            <div class="data-row__title">Import CSV</div>
            <div class="data-row__desc">Columns: date, symbol, side, qty, entry, exit, fees, pnl, r, strategy, tags, notes</div>
          </div>
          <button class="btn btn--ghost btn--sm" id="importCsvBtn">Choose file</button>
        </div>
        <input type="file" id="fileInput" accept=".json,.csv,text/csv,application/json" hidden />
      </div>

      <div class="section-title">Danger zone</div>
      <div class="card">
        <div class="data-row">
          <div class="data-row__text">
            <div class="data-row__title">Load sample data</div>
            <div class="data-row__desc">Try the app with 40 example trades</div>
          </div>
          <button class="btn btn--ghost btn--sm" id="loadSample">Load</button>
        </div>
        <div class="data-row">
          <div class="data-row__text">
            <div class="data-row__title" style="color:var(--red-bright)">Delete all trades</div>
            <div class="data-row__desc">Permanent · cannot be undone</div>
          </div>
          <button class="btn btn--danger btn--ghost btn--sm" id="clearAll">Delete</button>
        </div>
      </div>

      <div class="section-title">About</div>
      <div class="card">
        <p style="margin:0;font-size:13px;color:var(--text-dim);line-height:1.6">
          <strong style="color:var(--text)">100% private.</strong> Your trades never leave this device — they're stored in your browser's local storage. Export a backup regularly.<br><br>
          <strong style="color:var(--text)">Add to Home Screen:</strong> In Safari, tap the Share button <span style="color:var(--text)">􀈂</span> → “Add to Home Screen” to use it like a native app, offline.
        </p>
      </div>
    `;

    $('#setBalance').addEventListener('change', (e) => { Store.saveSettings({ startingBalance: Number(e.target.value) || 0 }); toast('Starting balance saved'); });
    $('#setCurrency').addEventListener('change', (e) => { Store.saveSettings({ currency: e.target.value }); toast('Currency updated'); render(); });
    $('#exportJson').addEventListener('click', exportJson);
    $('#exportCsv').addEventListener('click', exportCsv);
    $('#loadSample').addEventListener('click', () => loadSampleData());
    $('#clearAll').addEventListener('click', () => {
      if (confirm('Delete ALL trades permanently? This cannot be undone.')) {
        Store.clearAll(); toast('All trades deleted'); render();
      }
    });

    const fileInput = $('#fileInput');
    $('#importJsonBtn').addEventListener('click', () => { fileInput.dataset.mode = 'json'; fileInput.click(); });
    $('#importCsvBtn').addEventListener('click', () => { fileInput.dataset.mode = 'csv'; fileInput.click(); });
    fileInput.addEventListener('change', handleImportFile);
  }

  /* ================= TRADE MODAL ================= */
  function bindTradeModal() {
    const form = $('#tradeForm');
    form.addEventListener('submit', (e) => { e.preventDefault(); saveTradeFromForm(); });
    $('#deleteTradeBtn').addEventListener('click', () => {
      const id = $('#f_id').value;
      if (id && confirm('Delete this trade?')) { Store.deleteTrade(id); closeModal($('#tradeModal')); toast('Trade deleted'); render(); }
    });
    // Auto-calc P&L from prices unless user typed a manual value
    ['f_entry','f_exit','f_qty','f_fees','f_side'].forEach((id) => {
      $('#' + id).addEventListener('input', autoCalcPnl);
    });
    $('#f_pnl').addEventListener('input', () => { $('#f_pnl').dataset.manual = '1'; $('#pnlHint').textContent = '(manual)'; });
  }

  function autoCalcPnl() {
    const pnlInput = $('#f_pnl');
    if (pnlInput.dataset.manual === '1') return;
    const entry = Number($('#f_entry').value);
    const exit = Number($('#f_exit').value);
    const qty = Number($('#f_qty').value);
    const fees = Number($('#f_fees').value) || 0;
    const side = $('#f_side').value;
    if (entry && exit && qty) {
      const gross = side === 'short' ? (entry - exit) * qty : (exit - entry) * qty;
      pnlInput.value = (gross - fees).toFixed(2);
      $('#pnlHint').textContent = '(auto)';
    }
  }

  function openTradeModal(trade) {
    const isEdit = !!trade;
    $('#modalTitle').textContent = isEdit ? 'Edit Trade' : 'Add Trade';
    $('#deleteTradeBtn').hidden = !isEdit;
    const f = {
      id: '', date: DateUtil.today(), symbol: '', side: 'long', qty: '', entry: '', exit: '',
      fees: '', pnl: '', strategy: '', r: '', tags: '', notes: '',
    };
    if (isEdit) Object.assign(f, {
      id: trade.id, date: trade.date, symbol: trade.symbol || '', side: trade.side || 'long',
      qty: trade.qty ?? '', entry: trade.entry ?? '', exit: trade.exit ?? '', fees: trade.fees ?? '',
      pnl: trade.pnl ?? '', strategy: trade.strategy || '', r: trade.r ?? '',
      tags: (trade.tags || []).join(', '), notes: trade.notes || '',
    });
    $('#f_id').value = f.id; $('#f_date').value = f.date; $('#f_symbol').value = f.symbol;
    $('#f_side').value = f.side; $('#f_qty').value = f.qty; $('#f_entry').value = f.entry;
    $('#f_exit').value = f.exit; $('#f_fees').value = f.fees; $('#f_pnl').value = f.pnl;
    $('#f_strategy').value = f.strategy; $('#f_r').value = f.r; $('#f_tags').value = f.tags;
    $('#f_notes').value = f.notes;
    // If editing a trade that has an explicit pnl differing from computed, mark manual
    $('#f_pnl').dataset.manual = (isEdit && trade.pnl != null && trade.pnl !== '') ? '1' : '';
    $('#pnlHint').textContent = $('#f_pnl').dataset.manual === '1' ? '(manual)' : '(auto)';
    openModal($('#tradeModal'));
    setTimeout(() => $('#f_symbol').focus(), 250);
  }

  function saveTradeFromForm() {
    const symbol = $('#f_symbol').value.trim();
    const date = $('#f_date').value;
    if (!symbol || !date) { toast('Symbol and date are required'); return; }
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const trade = {
      id: $('#f_id').value || undefined,
      date,
      symbol: symbol.toUpperCase(),
      side: $('#f_side').value,
      qty: num($('#f_qty').value),
      entry: num($('#f_entry').value),
      exit: num($('#f_exit').value),
      fees: num($('#f_fees').value) || 0,
      pnl: num($('#f_pnl').value),
      strategy: $('#f_strategy').value.trim(),
      r: num($('#f_r').value),
      tags: $('#f_tags').value.split(',').map((s) => s.trim()).filter(Boolean),
      notes: $('#f_notes').value.trim(),
      _seq: Date.now(),
    };
    Store.upsertTrade(trade);
    closeModal($('#tradeModal'));
    toast(trade.id ? 'Trade saved' : 'Trade added');
    render();
  }

  /* ================= DAY MODAL ================= */
  function openDayModal(ymd) {
    const trades = Store.getTrades().filter((t) => t.date === ymd);
    const total = trades.reduce((a, t) => a + Calc.pnlOf(t), 0);
    const wins = trades.filter(Calc.isWin).length;
    $('#dayModalTitle').textContent = DateUtil.prettyDate(ymd);
    $('#dayModalBody').innerHTML = `
      <div class="day-detail__summary">
        <div class="day-detail__pnl ${cls(total)}">${Fmt.money(total, { signed: true })}</div>
        <div class="day-detail__meta">${trades.length} trade${trades.length !== 1 ? 's' : ''} · ${wins}W / ${trades.length - wins}L</div>
      </div>
      ${trades.map((t) => {
        const pnl = Calc.pnlOf(t);
        return `<div class="trade-row" data-id="${t.id}">
          <div class="trade-row__badge trade-row__badge--${t.side === 'short' ? 'short' : 'long'}">${t.side === 'short' ? 'S' : 'L'}</div>
          <div class="trade-row__main">
            <div class="trade-row__sym">${esc((t.symbol || '—').toUpperCase())}</div>
            <div class="trade-row__meta">${esc([t.strategy, t.qty ? Fmt.num(t.qty, 0) + ' sh' : '', (t.tags || []).join(', ')].filter(Boolean).join(' · '))}</div>
          </div>
          <div class="trade-row__pnl"><div class="trade-row__pnl-val ${cls(pnl)}">${Fmt.money(pnl, { signed: true })}</div></div>
        </div>`;
      }).join('')}
      <button class="btn btn--ghost" style="width:100%;margin-top:12px" id="dayAddTrade">＋ Add trade on this day</button>
    `;
    openModal($('#dayModal'));
    $$('#dayModalBody .trade-row').forEach((r) => r.addEventListener('click', () => {
      const t = Store.getTrades().find((x) => x.id === r.dataset.id);
      if (t) { closeModal($('#dayModal')); setTimeout(() => openTradeModal(t), 260); }
    }));
    $('#dayAddTrade').addEventListener('click', () => {
      closeModal($('#dayModal'));
      setTimeout(() => { openTradeModal(); $('#f_date').value = ymd; }, 260);
    });
  }

  /* ================= Modal plumbing ================= */
  function openModal(m) { m.classList.add('modal--open'); m.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
  function closeModal(m) { m.classList.remove('modal--open'); m.setAttribute('aria-hidden', 'true'); document.body.style.overflow = ''; }
  function bindGlobalModalClose() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-modal]')) {
        const m = e.target.closest('.modal');
        if (m) closeModal(m);
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') $$('.modal--open').forEach(closeModal);
    });
  }

  /* ================= Import / Export ================= */
  function download(filename, text, type = 'application/json') {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = el('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function exportJson() {
    const payload = { app: 'trading-journal', version: 1, exportedAt: new Date().toISOString(), settings: Store.getSettings(), trades: Store.getTrades() };
    download(`trading-journal-${DateUtil.today()}.json`, JSON.stringify(payload, null, 2));
    toast('Backup exported');
  }

  function exportCsv() {
    const cols = ['date','symbol','side','qty','entry','exit','fees','pnl','r','strategy','tags','notes'];
    const rows = Calc.sortByDate(Store.getTrades(), 1).map((t) => cols.map((c) => {
      let v = c === 'tags' ? (t.tags || []).join('; ') : (c === 'pnl' ? Calc.pnlOf(t) : t[c]);
      if (v == null) v = '';
      v = String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }).join(','));
    download(`trading-journal-${DateUtil.today()}.csv`, cols.join(',') + '\n' + rows.join('\n'), 'text/csv');
    toast('CSV exported');
  }

  function handleImportFile(e) {
    const file = e.target.files[0];
    const mode = e.target.dataset.mode;
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        if (mode === 'json' || file.name.endsWith('.json')) importJson(reader.result);
        else importCsv(reader.result);
      } catch (err) {
        console.error(err); toast('Import failed — check the file format');
      }
    };
    reader.readAsText(file);
  }

  function importJson(text) {
    const data = JSON.parse(text);
    const trades = Array.isArray(data) ? data : data.trades;
    if (!Array.isArray(trades)) { toast('No trades found in file'); return; }
    if (!confirm(`Import ${trades.length} trades? This replaces your current data.`)) return;
    const normalized = trades.map(normalizeImportedTrade);
    Store.replaceAll(normalized, Array.isArray(data) ? null : data.settings);
    toast(`Imported ${normalized.length} trades`);
    render();
  }

  function importCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) { toast('CSV looks empty'); return; }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const idx = (name) => header.indexOf(name);
    const get = (row, name) => { const i = idx(name); return i >= 0 ? row[i] : ''; };
    const trades = rows.slice(1).filter((r) => r.some((c) => c && c.trim())).map((row) => normalizeImportedTrade({
      date: get(row, 'date'),
      symbol: get(row, 'symbol'),
      side: get(row, 'side'),
      qty: get(row, 'qty') || get(row, 'quantity'),
      entry: get(row, 'entry') || get(row, 'entryprice'),
      exit: get(row, 'exit') || get(row, 'exitprice'),
      fees: get(row, 'fees') || get(row, 'commission'),
      pnl: get(row, 'pnl') || get(row, 'profit') || get(row, 'p&l'),
      r: get(row, 'r') || get(row, 'rmultiple'),
      strategy: get(row, 'strategy') || get(row, 'setup'),
      tags: get(row, 'tags'),
      notes: get(row, 'notes'),
    }));
    if (!trades.length) { toast('No valid rows found'); return; }
    if (!confirm(`Import ${trades.length} trades from CSV? This replaces your current data.`)) return;
    Store.replaceAll(trades, null);
    toast(`Imported ${trades.length} trades`);
    render();
  }

  function normalizeImportedTrade(t) {
    const num = (v) => { if (v === '' || v == null) return null; const n = Number(String(v).replace(/[$,]/g, '')); return Number.isNaN(n) ? null : n; };
    let date = String(t.date || '').trim();
    // Accept common date formats -> YYYY-MM-DD
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(date)) {
      const [mm, dd, yy] = date.split('/');
      const yyyy = yy.length === 2 ? '20' + yy : yy;
      date = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    } else if (/^\d{4}-\d{1,2}-\d{1,2}/.test(date)) {
      const [y, m, d] = date.split('T')[0].split('-');
      date = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    if (!date) date = DateUtil.today();
    let tags = t.tags;
    if (typeof tags === 'string') tags = tags.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    if (!Array.isArray(tags)) tags = [];
    const side = /short|sell|s/i.test(String(t.side)) && !/long/i.test(String(t.side)) ? 'short' : 'long';
    return {
      id: t.id || Store.genId(),
      date,
      symbol: String(t.symbol || '').toUpperCase().trim() || '—',
      side,
      qty: num(t.qty), entry: num(t.entry), exit: num(t.exit), fees: num(t.fees) || 0,
      pnl: num(t.pnl), r: num(t.r),
      strategy: String(t.strategy || '').trim(),
      tags,
      notes: String(t.notes || '').trim(),
      _seq: Date.now() + Math.random(),
    };
  }

  // Minimal RFC-4180-ish CSV parser
  function parseCsv(text) {
    const rows = [];
    let field = '', row = [], inQuotes = false;
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
        else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ',') { row.push(field); field = ''; }
        else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
        else field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  /* ================= Misc UI ================= */
  function refreshStrategyList(trades) {
    const set = new Set();
    trades.forEach((t) => { if (t.strategy) set.add(t.strategy); });
    const dl = $('#strategyList');
    if (dl) dl.innerHTML = [...set].map((s) => `<option value="${esc(s)}">`).join('');
  }

  function emptyState(title, text, ctaLabel, ctaFn, cta2Label, cta2Fn) {
    const wrap = el('div', 'empty');
    wrap.innerHTML = `<div class="empty__icon">📈</div>
      <div class="empty__title">${esc(title)}</div>
      <div class="empty__text">${esc(text)}</div>`;
    const b = el('button', 'btn btn--primary', esc(ctaLabel));
    b.addEventListener('click', ctaFn); wrap.appendChild(b);
    if (cta2Label) {
      const b2 = el('button', 'btn btn--ghost btn--sm', esc(cta2Label));
      b2.style.marginTop = '10px'; b2.style.display = 'block'; b2.style.marginLeft = 'auto'; b2.style.marginRight = 'auto';
      b2.addEventListener('click', cta2Fn); wrap.appendChild(b2);
    }
    return wrap;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('toast--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('toast--show'), 2200);
  }

  /* ================= Sample data ================= */
  function loadSampleData() {
    if (Store.getTrades().length && !confirm('Load sample data? This replaces your current trades.')) return;
    const syms = ['AAPL','TSLA','NVDA','SPY','AMD','MSFT','META','QQQ','GOOGL','COIN'];
    const strats = ['Breakout','Pullback','Reversal','Gap & Go','VWAP bounce','Trend follow'];
    const tagPool = ['momentum','gap-up','news','scalp','swing','earnings','oversold'];
    const trades = [];
    const today = new Date();
    for (let i = 0; i < 40; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - Math.floor(Math.random() * 75));
      const side = Math.random() > 0.35 ? 'long' : 'short';
      const entry = +(20 + Math.random() * 400).toFixed(2);
      const qty = Math.floor(10 + Math.random() * 200);
      // Bias slightly toward winners for a realistic-ish curve
      const win = Math.random() < 0.56;
      const movePct = (Math.random() * 0.04 + 0.003) * (win ? 1 : -1);
      const exit = +(side === 'long' ? entry * (1 + movePct) : entry * (1 - movePct)).toFixed(2);
      const fees = +(Math.random() * 4 + 1).toFixed(2);
      trades.push(normalizeImportedTrade({
        date: DateUtil.toYMD(d),
        symbol: syms[Math.floor(Math.random() * syms.length)],
        side, qty, entry, exit, fees,
        strategy: strats[Math.floor(Math.random() * strats.length)],
        r: +((Math.random() * 3 - 1)).toFixed(1),
        tags: [tagPool[Math.floor(Math.random() * tagPool.length)]],
        notes: '',
      }));
    }
    Store.replaceAll(trades, null);
    toast('Loaded 40 sample trades');
    navigate('dashboard');
  }

  /* ================= PWA ================= */
  function registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
      });
    }
  }

  function maybeShowInstallHint() {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
    if (isIOS && !standalone && !localStorage.getItem('tj_hideInstall')) {
      const hint = el('div', 'install-hint');
      hint.innerHTML = `<span>📲</span><div><strong>Install this app:</strong> tap the Share icon in Safari, then <strong>“Add to Home Screen”</strong> for full-screen, offline access.</div><button aria-label="Dismiss">✕</button>`;
      $('.views').prepend(hint);
      hint.querySelector('button').addEventListener('click', () => { hint.remove(); localStorage.setItem('tj_hideInstall', '1'); });
    }
  }

  return { init, loadSampleData };
})();

document.addEventListener('DOMContentLoaded', App.init);
