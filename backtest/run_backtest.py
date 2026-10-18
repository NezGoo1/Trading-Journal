#!/usr/bin/env python3
"""Run a strategy and print/save the full performance report.

Examples:
    python run_backtest.py
    python run_backtest.py --csv data/AAPL.csv --symbol AAPL
    python run_backtest.py --yf SPY --start 2010-01-01
    python run_backtest.py --strategy examples/rsi_mean_reversion.py
    python run_backtest.py --param fast=10 --param slow=30 --sizing percent --position-pct 1.0
"""

import argparse
import ast
import importlib.util
import inspect
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from btkit import BacktestConfig, Strategy, compute_stats, format_report, run_backtest, save_results  # noqa: E402
from btkit import data as datalib  # noqa: E402


def load_strategy_class(path: str):
    path = os.path.abspath(path)
    spec = importlib.util.spec_from_file_location("user_strategy", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    classes = [c for _, c in inspect.getmembers(module, inspect.isclass)
               if issubclass(c, Strategy) and c is not Strategy and c.__module__ == module.__name__]
    if not classes:
        raise SystemExit(f"No Strategy subclass found in {path}")
    return classes[0]


def parse_params(pairs):
    out = {}
    for pair in pairs or []:
        key, _, raw = pair.partition("=")
        try:
            out[key.strip()] = ast.literal_eval(raw)
        except (ValueError, SyntaxError):
            out[key.strip()] = raw
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_argument_group("data (pick one; default = synthetic sample)")
    src.add_argument("--csv", help="OHLCV CSV file (Date,Open,High,Low,Close[,Volume])")
    src.add_argument("--yf", metavar="TICKER", help="download from Yahoo Finance (needs yfinance)")
    src.add_argument("--interval", default="1d", help="yfinance interval, e.g. 1d, 1h")
    ap.add_argument("--start", help="first date to test, e.g. 2018-01-01")
    ap.add_argument("--end", help="last date to test")
    ap.add_argument("--symbol", help="symbol label for reports")
    ap.add_argument("--strategy", default=os.path.join(HERE, "my_strategy.py"), help="strategy file")
    ap.add_argument("--param", action="append", metavar="NAME=VALUE", help="override a strategy param (repeatable)")

    c = ap.add_argument_group("account & costs")
    d = BacktestConfig()
    c.add_argument("--capital", type=float, default=d.initial_capital)
    c.add_argument("--sizing", choices=["risk", "percent", "fixed"], default=d.sizing)
    c.add_argument("--risk-pct", type=float, default=d.risk_pct, help="fraction of equity risked per trade")
    c.add_argument("--position-pct", type=float, default=d.position_pct, help="fraction of equity per trade")
    c.add_argument("--qty", type=float, default=d.fixed_qty, help="units per trade for --sizing fixed")
    c.add_argument("--leverage", type=float, default=d.max_leverage, help="max notional / equity")
    c.add_argument("--fractional", action="store_true", help="allow fractional quantities")
    c.add_argument("--commission", type=float, default=d.commission_per_trade, help="flat fee per side")
    c.add_argument("--commission-pct", type=float, default=d.commission_pct, help="fee as fraction of notional per side")
    c.add_argument("--slippage-pct", type=float, default=d.slippage_pct)
    c.add_argument("--long-only", action="store_true")

    ap.add_argument("--out", default=os.path.join(HERE, "results"), help="results folder")
    ap.add_argument("--no-save", action="store_true", help="print only, don't write files")
    args = ap.parse_args()

    if args.csv:
        df = datalib.load_csv(args.csv)
        symbol = args.symbol or os.path.splitext(os.path.basename(args.csv))[0].upper()
    elif args.yf:
        df = datalib.load_yfinance(args.yf, args.start, args.end, args.interval)
        symbol = args.symbol or args.yf.upper()
    else:
        print("No data given — using synthetic sample data (pass --csv or --yf for real prices).")
        df = datalib.sample_data()
        symbol = args.symbol or "SAMPLE"
    if args.start:
        df = df[df.index >= args.start]
    if args.end:
        df = df[df.index <= args.end]

    strategy = load_strategy_class(args.strategy)(**parse_params(args.param))
    config = BacktestConfig(
        initial_capital=args.capital, sizing=args.sizing, risk_pct=args.risk_pct,
        position_pct=args.position_pct, fixed_qty=args.qty, max_leverage=args.leverage,
        allow_fractional=args.fractional, commission_per_trade=args.commission,
        commission_pct=args.commission_pct, slippage_pct=args.slippage_pct,
        allow_short=not args.long_only, symbol=symbol,
    )

    result = run_backtest(df, strategy, config)
    stats = compute_stats(result)
    report = format_report(stats, result)
    print(report)
    if not args.no_save:
        out_dir = save_results(stats, result, report, args.out)
        print(f"Saved report, trades, equity curve and journal_import.csv to: {out_dir}")


if __name__ == "__main__":
    main()
