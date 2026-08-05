/* ============================================================
   calc.js — trade math, stats & aggregations
   ============================================================ */

const Calc = (() => {

  // Net P&L for a trade. Prefer explicit pnl; otherwise derive from prices.
  function pnlOf(t) {
    if (t.pnl != null && t.pnl !== '' && !Number.isNaN(Number(t.pnl))) {
      return Number(t.pnl);
    }
    const entry = Number(t.entry);
    const exit = Number(t.exit);
    const qty = Number(t.qty);
    const fees = Number(t.fees) || 0;
    if (!entry || !exit || !qty) return 0;
    const gross = t.side === 'short' ? (entry - exit) * qty : (exit - entry) * qty;
    return gross - fees;
  }

  function isWin(t) { return pnlOf(t) > 0; }
  function isLoss(t) { return pnlOf(t) < 0; }

  function sortByDate(trades, dir = 1) {
    return [...trades].sort((a, b) => {
      if (a.date === b.date) return (a._seq || 0) - (b._seq || 0);
      return a.date < b.date ? -1 * dir : 1 * dir;
    });
  }

  // Core summary statistics over a set of trades.
  function summary(trades) {
    const n = trades.length;
    const pnls = trades.map(pnlOf);
    const net = pnls.reduce((a, b) => a + b, 0);
    const fees = trades.reduce((a, t) => a + (Number(t.fees) || 0), 0);

    const wins = trades.filter(isWin);
    const losses = trades.filter(isLoss);
    const scratches = n - wins.length - losses.length;

    const grossProfit = wins.reduce((a, t) => a + pnlOf(t), 0);
    const grossLoss = Math.abs(losses.reduce((a, t) => a + pnlOf(t), 0));

    const winRate = n ? (wins.length / n) * 100 : 0;
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);
    const expectancy = n ? net / n : 0;
    const payoff = avgLoss > 0 ? avgWin / avgLoss : (avgWin > 0 ? Infinity : 0);

    const largestWin = wins.length ? Math.max(...wins.map(pnlOf)) : 0;
    const largestLoss = losses.length ? Math.min(...losses.map(pnlOf)) : 0;

    const rValues = trades.map((t) => Number(t.r)).filter((v) => !Number.isNaN(v) && v !== 0);
    const avgR = rValues.length ? rValues.reduce((a, b) => a + b, 0) / rValues.length : null;

    // Streaks (chronological)
    const chrono = sortByDate(trades, 1);
    let curStreak = 0, curSign = 0, bestWinStreak = 0, worstLossStreak = 0;
    chrono.forEach((t) => {
      const p = pnlOf(t);
      const sign = p > 0 ? 1 : (p < 0 ? -1 : 0);
      if (sign === 0) { curStreak = 0; curSign = 0; return; }
      if (sign === curSign) curStreak++; else { curStreak = 1; curSign = sign; }
      if (sign > 0) bestWinStreak = Math.max(bestWinStreak, curStreak);
      else worstLossStreak = Math.max(worstLossStreak, curStreak);
    });
    // Current active streak = trailing run
    let activeStreak = 0, activeSign = 0;
    for (let i = chrono.length - 1; i >= 0; i--) {
      const p = pnlOf(chrono[i]);
      const sign = p > 0 ? 1 : (p < 0 ? -1 : 0);
      if (sign === 0) break;
      if (activeSign === 0) { activeSign = sign; activeStreak = 1; }
      else if (sign === activeSign) activeStreak++;
      else break;
    }

    return {
      n, net, fees, wins: wins.length, losses: losses.length, scratches,
      winRate, avgWin, avgLoss, profitFactor, expectancy, payoff,
      grossProfit, grossLoss, largestWin, largestLoss, avgR,
      bestWinStreak, worstLossStreak, activeStreak, activeSign,
    };
  }

  // Cumulative equity curve, incl. starting balance. Returns [{date, pnl, cum, equity}]
  function equityCurve(trades, startBalance = 0) {
    const chrono = sortByDate(trades, 1);
    let cum = 0;
    return chrono.map((t) => {
      const p = pnlOf(t);
      cum += p;
      return { date: t.date, pnl: p, cum, equity: startBalance + cum, trade: t };
    });
  }

  // Max drawdown (peak-to-trough) on the equity curve.
  function maxDrawdown(trades, startBalance = 0) {
    const curve = equityCurve(trades, startBalance);
    let peak = startBalance, maxDD = 0, maxDDPct = 0;
    curve.forEach((pt) => {
      if (pt.equity > peak) peak = pt.equity;
      const dd = peak - pt.equity;
      if (dd > maxDD) { maxDD = dd; maxDDPct = peak > 0 ? (dd / peak) * 100 : 0; }
    });
    return { maxDD, maxDDPct };
  }

  // Group trades by calendar day -> { 'YYYY-MM-DD': {pnl, count, trades} }
  function byDay(trades) {
    const map = {};
    trades.forEach((t) => {
      if (!map[t.date]) map[t.date] = { pnl: 0, count: 0, trades: [] };
      map[t.date].pnl += pnlOf(t);
      map[t.date].count += 1;
      map[t.date].trades.push(t);
    });
    return map;
  }

  // Generic grouping by a key function -> sorted array of {key, pnl, count, wins, winRate}
  function groupBy(trades, keyFn) {
    const map = {};
    trades.forEach((t) => {
      const keys = keyFn(t);
      (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
        if (k == null || k === '') return;
        if (!map[k]) map[k] = { key: k, pnl: 0, count: 0, wins: 0 };
        map[k].pnl += pnlOf(t);
        map[k].count += 1;
        if (isWin(t)) map[k].wins += 1;
      });
    });
    return Object.values(map).map((g) => ({
      ...g,
      winRate: g.count ? (g.wins / g.count) * 100 : 0,
    })).sort((a, b) => b.pnl - a.pnl);
  }

  function bySymbol(trades) { return groupBy(trades, (t) => (t.symbol || '').toUpperCase()); }
  function byStrategy(trades) { return groupBy(trades, (t) => t.strategy || '—'); }
  function byTag(trades) { return groupBy(trades, (t) => (t.tags || [])); }

  function byWeekday(trades) {
    const buckets = [0,1,2,3,4,5,6].map((d) => ({ key: d, pnl: 0, count: 0, wins: 0 }));
    trades.forEach((t) => {
      const d = DateUtil.parse(t.date);
      if (!d) return;
      const wd = d.getDay();
      buckets[wd].pnl += pnlOf(t);
      buckets[wd].count += 1;
      if (isWin(t)) buckets[wd].wins += 1;
    });
    return buckets.map((b) => ({ ...b, winRate: b.count ? (b.wins / b.count) * 100 : 0 }));
  }

  // Monthly net for a year -> [{month, pnl, count}] (12 entries)
  function byMonth(trades, year) {
    const months = Array.from({ length: 12 }, (_, m) => ({ month: m, pnl: 0, count: 0 }));
    trades.forEach((t) => {
      const d = DateUtil.parse(t.date);
      if (!d || d.getFullYear() !== year) return;
      months[d.getMonth()].pnl += pnlOf(t);
      months[d.getMonth()].count += 1;
    });
    return months;
  }

  function distinctYears(trades) {
    const set = new Set();
    trades.forEach((t) => { const d = DateUtil.parse(t.date); if (d) set.add(d.getFullYear()); });
    return [...set].sort((a, b) => b - a);
  }

  return {
    pnlOf, isWin, isLoss, sortByDate, summary, equityCurve, maxDrawdown,
    byDay, groupBy, bySymbol, byStrategy, byTag, byWeekday, byMonth, distinctYears,
  };
})();
