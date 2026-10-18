"""Printing and saving backtest results."""

import json
import math
import os
from datetime import datetime

import pandas as pd

from .engine import BacktestResult
from .stats import drawdown_series, monthly_returns


def _fmt(v, kind="num"):
    if v is None or (isinstance(v, float) and math.isnan(v)):
        return "n/a"
    if isinstance(v, float) and math.isinf(v):
        return "∞"
    if kind == "pct":
        return f"{v * 100:,.2f}%"
    if kind == "usd":
        return f"{v:,.2f}"
    if kind == "int":
        return f"{int(v):,}"
    if isinstance(v, float):
        return f"{v:,.2f}"
    return str(v)


def _section(title, rows):
    lines = [f"\n{title}", "-" * len(title)]
    width = max(len(label) for label, _ in rows)
    lines += [f"  {label:<{width}}  {value}" for label, value in rows]
    return lines


def format_report(stats: dict, result: BacktestResult) -> str:
    e, t, b, mc = stats["equity"], stats["trades"], stats["benchmark"], stats["monte_carlo"]
    params = ", ".join(f"{k}={v}" for k, v in stats["params"].items()) or "none"
    out = [
        "=" * 64,
        f" {stats['strategy']}  |  {stats['symbol']}",
        f" {e['start']:%Y-%m-%d} → {e['end']:%Y-%m-%d}  ({e['years']:.1f} yrs, {stats['bars']:,} bars)",
        f" Params: {params}",
        "=" * 64,
    ]
    out += _section("RETURNS", [
        ("Initial capital", _fmt(e["initial_capital"], "usd")),
        ("Final equity", _fmt(e["final_equity"], "usd")),
        ("Net profit", _fmt(e["net_profit"], "usd")),
        ("Total return", f"{_fmt(e['total_return'], 'pct')}   (buy & hold {_fmt(b['total_return'], 'pct')})"),
        ("CAGR", f"{_fmt(e['cagr'], 'pct')}   (buy & hold {_fmt(b['cagr'], 'pct')})"),
        ("Exposure (time in market)", _fmt(stats["exposure"], "pct")),
    ])
    out += _section("RISK", [
        ("Max drawdown", f"{_fmt(e['max_drawdown'], 'pct')}  ({_fmt(e['max_drawdown_usd'], 'usd')})   (buy & hold {_fmt(b['max_drawdown'], 'pct')})"),
        ("Longest drawdown", f"{e['max_drawdown_duration_days']:,} days"),
        ("Annual volatility", _fmt(e["volatility_ann"], "pct")),
        ("Sharpe ratio", f"{_fmt(e['sharpe'])}   (buy & hold {_fmt(b['sharpe'])})"),
        ("Sortino ratio", _fmt(e["sortino"])),
        ("Calmar ratio (CAGR/MaxDD)", _fmt(e["calmar"])),
        ("Best / worst period", f"{_fmt(e['best_period'], 'pct')} / {_fmt(e['worst_period'], 'pct')}"),
    ])
    if t.get("total_trades", 0) == 0:
        out.append("\nNo trades were taken. Check your entry rules and indicator warm-up.")
        return "\n".join(out)

    out += _section("TRADES", [
        ("Total trades", f"{t['total_trades']}  (long {t['long_trades']}, short {t['short_trades']})"),
        ("Win rate", f"{_fmt(t['win_rate'], 'pct')}  ({t['winners']}W / {t['losers']}L)"),
        ("Profit factor", _fmt(t["profit_factor"])),
        ("Expectancy per trade", _fmt(t["expectancy"], "usd")),
        ("Avg trade return", _fmt(t["avg_trade_return"], "pct")),
        ("Avg win / avg loss", f"{_fmt(t['avg_win'], 'usd')} / {_fmt(t['avg_loss'], 'usd')}"),
        ("Payoff ratio (win/loss)", _fmt(t["payoff_ratio"])),
        ("Largest win / loss", f"{_fmt(t['largest_win'], 'usd')} / {_fmt(t['largest_loss'], 'usd')}"),
        ("Max consecutive W / L", f"{t['max_consecutive_wins']} / {t['max_consecutive_losses']}"),
        ("Avg R-multiple", _fmt(t["avg_r"])),
        ("SQN (system quality)", _fmt(t["sqn"])),
        ("Avg bars held (all/W/L)", f"{_fmt(t['avg_bars_held'])} / {_fmt(t['avg_bars_winners'])} / {_fmt(t['avg_bars_losers'])}"),
        ("Avg MAE / MFE (price)", f"{_fmt(t['avg_mae'])} / {_fmt(t['avg_mfe'])}"),
        ("Total commissions", _fmt(t["total_commission"], "usd")),
        ("Skipped entries", f"{stats['skipped_entries']}  (gapped through stop / zero size)"),
    ])

    sides = stats.get("by_side", {})
    if len(sides) > 1:
        lng, sht = sides.get("long", {}), sides.get("short", {})
        rows = [("", f"{'LONG':>14}{'SHORT':>14}")]
        for label, key, kind in [("Trades", "total_trades", "int"), ("Win rate", "win_rate", "pct"),
                                 ("Net P&L", "gross_profit", "net"), ("Profit factor", "profit_factor", "num"),
                                 ("Expectancy", "expectancy", "usd"), ("Avg R", "avg_r", "num")]:
            if kind == "net":
                vals = [_fmt(s.get("gross_profit", 0) + s.get("gross_loss", 0), "usd") for s in (lng, sht)]
            else:
                vals = [_fmt(s.get(key), kind) for s in (lng, sht)]
            rows.append((label, f"{vals[0]:>14}{vals[1]:>14}"))
        out += _section("LONG vs SHORT", rows)

    out += _section("EXIT REASONS", [(k, str(v)) for k, v in stats["exit_reasons"].items()])
    out += _section("BY YEAR (trades closed)", [
        (str(y), f"{d['trades']:>4} trades   P&L {_fmt(d['pnl'], 'usd'):>14}   win {_fmt(d['win_rate'], 'pct')}")
        for y, d in stats["by_year"].items()
    ])
    if mc:
        out += _section(f"MONTE CARLO ({mc['simulations']:,} trade-resampled runs)", [
            ("Return  5th / 50th / 95th pct", f"{_fmt(mc['return_p5'], 'pct')} / {_fmt(mc['return_p50'], 'pct')} / {_fmt(mc['return_p95'], 'pct')}"),
            ("Max DD  median / 95th pct / worst", f"{_fmt(mc['max_dd_p50'], 'pct')} / {_fmt(mc['max_dd_p95'], 'pct')} / {_fmt(mc['max_dd_worst'], 'pct')}"),
            ("Probability of losing money", _fmt(mc["prob_loss"], "pct")),
        ])

    mt = monthly_returns(result.equity)
    mt.index.name = None
    out.append("\nMONTHLY RETURNS (%)\n-------------------")
    out.append((mt * 100).round(1).to_string(na_rep="."))
    out.append("")
    return "\n".join(out)


def to_journal_csv(trades: pd.DataFrame, strategy_name: str) -> pd.DataFrame:
    """Trades in the Trading Journal app's CSV import format (Data → Import CSV)."""
    if trades.empty:
        return pd.DataFrame(columns=["date", "symbol", "side", "qty", "entry", "exit", "fees", "pnl", "r", "strategy", "tags", "notes"])
    return pd.DataFrame({
        "date": pd.to_datetime(trades["exit_time"]).dt.strftime("%Y-%m-%d"),
        "symbol": trades["symbol"],
        "side": trades["side"],
        "qty": trades["qty"].round(6),
        "entry": trades["entry_price"].round(6),
        "exit": trades["exit_price"].round(6),
        "fees": trades["commission"].round(2),
        "pnl": trades["pnl"].round(2),
        "r": trades["r_multiple"].round(2),
        "strategy": strategy_name,
        "tags": "backtest; exit:" + trades["exit_reason"],
        "notes": "Entered " + pd.to_datetime(trades["entry_time"]).dt.strftime("%Y-%m-%d %H:%M").str.replace(" 00:00", "")
                 + ", held " + trades["bars_held"].astype(str) + " bars",
    })


def _json_default(o):
    if isinstance(o, (pd.Timestamp, datetime)):
        return o.isoformat()
    if hasattr(o, "item"):
        return o.item()
    return str(o)


def save_results(stats: dict, result: BacktestResult, report_text: str, out_root: str = "results") -> str:
    slug = "_".join("".join(c if c.isalnum() else " " for c in stats["strategy"]).lower().split())
    out_dir = os.path.join(out_root, f"{slug}_{result.config.symbol}_{datetime.now():%Y%m%d_%H%M%S}")
    os.makedirs(out_dir, exist_ok=True)

    with open(os.path.join(out_dir, "report.txt"), "w") as f:
        f.write(report_text)

    def clean(o):
        if isinstance(o, dict):
            return {str(k): clean(v) for k, v in o.items()}
        if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
            return None
        return o
    with open(os.path.join(out_dir, "stats.json"), "w") as f:
        json.dump(clean(stats), f, indent=2, default=_json_default)

    result.trades.to_csv(os.path.join(out_dir, "trades.csv"), index=False)
    pd.DataFrame({"equity": result.equity, "drawdown": drawdown_series(result.equity)}).to_csv(
        os.path.join(out_dir, "equity.csv"))
    monthly_returns(result.equity).to_csv(os.path.join(out_dir, "monthly_returns.csv"))
    to_journal_csv(result.trades, stats["strategy"]).to_csv(os.path.join(out_dir, "journal_import.csv"), index=False)
    _plot(result, os.path.join(out_dir, "chart.png"))
    return out_dir


def _plot(result: BacktestResult, path: str):
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return  # charts are optional: pip install matplotlib
    eq = result.equity
    bh = result.data["close"] / result.data["close"].iloc[0] * result.config.initial_capital
    dd = drawdown_series(eq) * 100
    fig, (ax1, ax2, ax3) = plt.subplots(3, 1, figsize=(11, 9), height_ratios=[3, 1.2, 1.5])
    ax1.plot(eq.index, eq, color="#2a6fdb", lw=1.6, label="Strategy")
    ax1.plot(bh.index, bh, color="#9aa0a6", lw=1.0, label="Buy & hold")
    ax1.set_title(f"{result.strategy.name} — {result.config.symbol}", loc="left")
    ax1.set_ylabel("Equity")
    ax1.legend(frameon=False)
    ax2.fill_between(dd.index, dd, 0, color="#d93025", alpha=0.35, lw=0)
    ax2.set_ylabel("Drawdown %")
    t = result.trades
    if not t.empty:
        colors = ["#188038" if p > 0 else "#d93025" for p in t["pnl"]]
        ax3.bar(range(len(t)), t["pnl"], color=colors, width=0.8)
        ax3.axhline(0, color="#5f6368", lw=0.6)
    ax3.set_ylabel("Trade P&L")
    ax3.set_xlabel("Trade #")
    for ax in (ax1, ax2, ax3):
        ax.spines[["top", "right"]].set_visible(False)
        ax.grid(alpha=0.2)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
