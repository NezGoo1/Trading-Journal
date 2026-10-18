"""Performance statistics for a BacktestResult."""

import math

import numpy as np
import pandas as pd

from .engine import BacktestResult


def _safe_div(a, b, default=float("nan")):
    return a / b if b else default


def _years(index: pd.DatetimeIndex) -> float:
    return max((index[-1] - index[0]).days / 365.25, 1e-9)


def _period_returns(equity: pd.Series) -> pd.Series:
    """Daily returns for intraday/daily data, native-bar returns for weekly+ data."""
    if len(equity) > 1 and (equity.index[1:] - equity.index[:-1]).median() < pd.Timedelta(days=1):
        equity = equity.resample("D").last().dropna()
    return equity.pct_change().dropna()


def drawdown_series(equity: pd.Series) -> pd.Series:
    return equity / equity.cummax() - 1


def _max_drawdown_duration(equity: pd.Series) -> pd.Timedelta:
    """Longest time spent below a prior equity peak (until recovered or end of data)."""
    peak_time, longest = equity.index[0], pd.Timedelta(0)
    peak = equity.iloc[0]
    for t, v in equity.items():
        if v >= peak:
            peak, peak_time = v, t
        longest = max(longest, t - peak_time)
    return longest


def _streaks(pnls: pd.Series):
    max_w = max_l = cur_w = cur_l = 0
    for p in pnls:
        if p > 0:
            cur_w, cur_l = cur_w + 1, 0
        elif p < 0:
            cur_l, cur_w = cur_l + 1, 0
        else:
            cur_w = cur_l = 0
        max_w, max_l = max(max_w, cur_w), max(max_l, cur_l)
    return max_w, max_l


def equity_stats(equity: pd.Series, initial_capital: float) -> dict:
    rets = _period_returns(equity)
    years = _years(equity.index)
    ppy = len(rets) / years if years > 0 else 252
    final = equity.iloc[-1]
    total_return = final / initial_capital - 1
    cagr = (final / initial_capital) ** (1 / years) - 1 if final > 0 else -1.0
    vol = rets.std(ddof=1) * math.sqrt(ppy) if len(rets) > 1 else float("nan")
    downside = rets[rets < 0]
    downside_dev = math.sqrt((downside ** 2).sum() / len(rets)) * math.sqrt(ppy) if len(rets) else float("nan")
    mean_ann = rets.mean() * ppy
    dd = drawdown_series(equity)
    max_dd = dd.min()
    return {
        "start": equity.index[0],
        "end": equity.index[-1],
        "years": years,
        "initial_capital": initial_capital,
        "final_equity": final,
        "net_profit": final - initial_capital,
        "total_return": total_return,
        "cagr": cagr,
        "volatility_ann": vol,
        "sharpe": _safe_div(mean_ann, vol),
        "sortino": _safe_div(mean_ann, downside_dev),
        "max_drawdown": max_dd,
        "max_drawdown_usd": (equity - equity.cummax()).min(),
        "max_drawdown_duration_days": _max_drawdown_duration(equity).days,
        "calmar": _safe_div(cagr, abs(max_dd)),
        "best_period": rets.max() if len(rets) else float("nan"),
        "worst_period": rets.min() if len(rets) else float("nan"),
    }


def trade_stats(trades: pd.DataFrame) -> dict:
    n = len(trades)
    if n == 0:
        return {"total_trades": 0}
    pnl = trades["pnl"].astype(float)
    wins, losses = pnl[pnl > 0], pnl[pnl < 0]
    gross_win, gross_loss = wins.sum(), -losses.sum()
    avg_win = wins.mean() if len(wins) else 0.0
    avg_loss = losses.mean() if len(losses) else 0.0
    win_rate = len(wins) / n
    r = trades["r_multiple"].dropna().astype(float)
    max_w, max_l = _streaks(pnl)
    held = trades["bars_held"].astype(float)
    return {
        "total_trades": n,
        "long_trades": int((trades["side"] == "long").sum()),
        "short_trades": int((trades["side"] == "short").sum()),
        "winners": len(wins),
        "losers": len(losses),
        "win_rate": win_rate,
        "gross_profit": gross_win,
        "gross_loss": -gross_loss,
        "profit_factor": _safe_div(gross_win, gross_loss, float("inf") if gross_win > 0 else float("nan")),
        "avg_trade": pnl.mean(),
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "payoff_ratio": _safe_div(avg_win, abs(avg_loss)),
        "expectancy": win_rate * avg_win + (1 - win_rate) * avg_loss,
        "avg_trade_return": trades["return_pct"].mean(),
        "largest_win": pnl.max(),
        "largest_loss": pnl.min(),
        "max_consecutive_wins": max_w,
        "max_consecutive_losses": max_l,
        "avg_r": r.mean() if len(r) else float("nan"),
        "sqn": (r.mean() / r.std(ddof=1) * math.sqrt(min(len(r), 100))) if len(r) > 1 and r.std(ddof=1) > 0 else float("nan"),
        "avg_bars_held": held.mean(),
        "avg_bars_winners": held[pnl > 0].mean() if len(wins) else float("nan"),
        "avg_bars_losers": held[pnl < 0].mean() if len(losses) else float("nan"),
        "avg_mae": trades["mae"].mean(),
        "avg_mfe": trades["mfe"].mean(),
        "total_commission": trades["commission"].sum() if "commission" in trades else 0.0,
    }


def exposure(result: BacktestResult) -> float:
    """Fraction of bars with an open position."""
    t = result.trades
    if t.empty:
        return 0.0
    idx = result.equity.index
    in_mkt = np.zeros(len(idx), dtype=bool)
    starts = idx.searchsorted(pd.to_datetime(t["entry_time"]))
    ends = idx.searchsorted(pd.to_datetime(t["exit_time"]))
    for s, e in zip(starts, ends):
        in_mkt[s:e + 1] = True
    return in_mkt.mean()


def monthly_returns(equity: pd.Series) -> pd.DataFrame:
    """Year x month table of returns, plus a full-year column."""
    month_end = equity.resample("ME").last()
    prev = month_end.shift()
    prev.iloc[0] = equity.iloc[0]
    m = (month_end / prev - 1).dropna()
    table = pd.DataFrame({"year": m.index.year, "month": m.index.month, "ret": m.values})
    table = table.pivot(index="year", columns="month", values="ret").reindex(columns=range(1, 13))
    table.columns = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    year_end = equity.resample("YE").last()
    year_prev = year_end.shift()
    year_prev.iloc[0] = equity.iloc[0]
    table["Year"] = (year_end / year_prev - 1).values
    return table


def monte_carlo(trades: pd.DataFrame, sims: int = 2000, seed: int = 42) -> dict:
    """Resample trade returns (with replacement) to see the range of outcomes
    the same edge could have produced in a different order/luck."""
    if len(trades) < 5:
        return {}
    rets = trades["return_pct"].astype(float).to_numpy()
    rng = np.random.default_rng(seed)
    draws = rng.choice(rets, size=(sims, len(rets)), replace=True)
    curves = np.cumprod(1 + draws, axis=1)
    final = curves[:, -1] - 1
    peaks = np.maximum.accumulate(np.maximum(curves, 1.0), axis=1)
    max_dd = (curves / peaks - 1).min(axis=1)
    pct = lambda a, q: float(np.percentile(a, q))
    return {
        "simulations": sims,
        "return_p5": pct(final, 5), "return_p50": pct(final, 50), "return_p95": pct(final, 95),
        "max_dd_p50": pct(max_dd, 50), "max_dd_p95": pct(max_dd, 5), "max_dd_worst": float(max_dd.min()),
        "prob_loss": float((final < 0).mean()),
    }


def benchmark_stats(data: pd.DataFrame, initial_capital: float) -> dict:
    """Buy & hold the same instrument over the same period."""
    bh = data["close"] / data["close"].iloc[0] * initial_capital
    s = equity_stats(bh, initial_capital)
    return {k: s[k] for k in ("total_return", "cagr", "sharpe", "max_drawdown", "volatility_ann")}


def compute_stats(result: BacktestResult) -> dict:
    cfg = result.config
    t = result.trades
    stats = {
        "strategy": result.strategy.name,
        "params": vars(result.strategy.p),
        "symbol": cfg.symbol,
        "bars": len(result.equity),
        "equity": equity_stats(result.equity, cfg.initial_capital),
        "trades": trade_stats(t),
        "exposure": exposure(result),
        "skipped_entries": result.skipped_entries,
        "benchmark": benchmark_stats(result.data, cfg.initial_capital),
        "monte_carlo": monte_carlo(t),
    }
    if not t.empty:
        stats["by_side"] = {side: trade_stats(g) for side, g in t.groupby("side")}
        stats["exit_reasons"] = t["exit_reason"].value_counts().to_dict()
        years = pd.to_datetime(t["exit_time"]).dt.year
        stats["by_year"] = {
            int(y): {"trades": len(g), "pnl": g["pnl"].sum(), "win_rate": (g["pnl"] > 0).mean()}
            for y, g in t.groupby(years)
        }
    return stats
