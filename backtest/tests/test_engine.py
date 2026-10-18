"""Sanity tests with hand-checkable prices. Run: python -m unittest discover -s tests"""

import os
import sys
import unittest

import pandas as pd

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from btkit import BacktestConfig, Strategy, compute_stats, run_backtest, to_journal_csv  # noqa: E402
from btkit import indicators as ta  # noqa: E402

NO_COSTS = dict(commission_pct=0.0, slippage_pct=0.0, commission_per_trade=0.0)


def bars(rows):
    """rows: list of (open, high, low, close)."""
    idx = pd.bdate_range("2024-01-01", periods=len(rows))
    return pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx)


class EnterOnBar(Strategy):
    """Signal on bar `at` (0-based), optional stop/target offsets and exit bar."""
    name = "test"
    params = {"at": 1, "side": "long", "stop": None, "target": None, "exit_at": None}

    def prepare(self, df):
        df["n"] = range(len(df))
        return df

    def entry(self, bar, prev):
        return self.p.side if bar.n == self.p.at else None

    def exit(self, bar, prev, trade):
        return self.p.exit_at is not None and bar.n == self.p.exit_at

    def stop_loss(self, bar, side, entry_price):
        return None if self.p.stop is None else entry_price - self.p.stop * (1 if side == "long" else -1)

    def take_profit(self, bar, side, entry_price, stop):
        return None if self.p.target is None else entry_price + self.p.target * (1 if side == "long" else -1)


FLAT_THEN_UP = bars([(100, 101, 99, 100)] * 3 + [(100, 106, 99, 105), (105, 111, 104, 110), (110, 111, 109, 110)])


class EngineTests(unittest.TestCase):
    def test_fills_next_open_and_exit_signal(self):
        cfg = BacktestConfig(sizing="fixed", fixed_qty=10, **NO_COSTS)
        r = run_backtest(FLAT_THEN_UP, EnterOnBar(at=1, exit_at=4), cfg)
        t = r.trades.iloc[0]
        self.assertEqual(t.entry_time, FLAT_THEN_UP.index[2])   # signal bar 1 → fill bar 2 open
        self.assertEqual(t.entry_price, 100)
        self.assertEqual(t.exit_price, 110)                     # exit signal bar 4 → bar 5 open
        self.assertEqual(t.exit_reason, "signal")
        self.assertAlmostEqual(t.pnl, 100)
        self.assertAlmostEqual(r.equity.iloc[-1], 100_100)

    def test_stop_hit_and_r_multiple(self):
        data = bars([(100, 101, 99, 100)] * 2 + [(100, 101, 94, 95), (95, 96, 94, 95)])
        cfg = BacktestConfig(sizing="risk", risk_pct=0.01, **NO_COSTS)
        r = run_backtest(data, EnterOnBar(at=1, stop=5), cfg)
        t = r.trades.iloc[0]
        self.assertEqual(t.exit_reason, "stop")
        self.assertEqual(t.exit_price, 95)
        self.assertEqual(t.qty, 200)                    # 1% of 100k = 1000 risk / 5 per share
        self.assertAlmostEqual(t.r_multiple, -1.0)
        self.assertAlmostEqual(t.pnl, -1000)

    def test_gap_through_stop_fills_at_open(self):
        data = bars([(100, 101, 99, 100)] * 3 + [(90, 91, 89, 90), (90, 90, 90, 90)])
        cfg = BacktestConfig(sizing="fixed", fixed_qty=1, **NO_COSTS)
        r = run_backtest(data, EnterOnBar(at=1, stop=5), cfg)
        self.assertEqual(r.trades.iloc[0].exit_price, 90)

    def test_target_and_short(self):
        data = bars([(100, 101, 99, 100)] * 2 + [(100, 101, 89, 90), (90, 90, 90, 90)])
        cfg = BacktestConfig(sizing="fixed", fixed_qty=1, **NO_COSTS)
        r = run_backtest(data, EnterOnBar(at=1, side="short", stop=5, target=8), cfg)
        t = r.trades.iloc[0]
        self.assertEqual((t.side, t.exit_reason, t.exit_price), ("short", "target", 92))
        self.assertAlmostEqual(t.pnl, 8)
        self.assertAlmostEqual(t.r_multiple, 1.6)

    def test_stop_wins_when_both_hit(self):
        data = bars([(100, 101, 99, 100)] * 2 + [(100, 120, 80, 100), (100, 100, 100, 100)])
        cfg = BacktestConfig(sizing="fixed", fixed_qty=1, **NO_COSTS)
        r = run_backtest(data, EnterOnBar(at=1, stop=5, target=5), cfg)
        self.assertEqual(r.trades.iloc[0].exit_reason, "stop")

    def test_costs(self):
        cfg = BacktestConfig(sizing="fixed", fixed_qty=10, commission_per_trade=1.0,
                             commission_pct=0.0, slippage_pct=0.01)
        r = run_backtest(FLAT_THEN_UP, EnterOnBar(at=1, exit_at=4), cfg)
        t = r.trades.iloc[0]
        self.assertAlmostEqual(t.entry_price, 101)       # bought 1% above open
        self.assertAlmostEqual(t.exit_price, 108.9)      # sold 1% below open
        self.assertAlmostEqual(t.pnl, (108.9 - 101) * 10 - 2)
        self.assertAlmostEqual(r.equity.iloc[-1], 100_000 + t.pnl)

    def test_open_trade_closed_at_end(self):
        cfg = BacktestConfig(sizing="fixed", fixed_qty=1, **NO_COSTS)
        r = run_backtest(FLAT_THEN_UP, EnterOnBar(at=1), cfg)
        self.assertEqual(r.trades.iloc[0].exit_reason, "end_of_data")
        self.assertAlmostEqual(r.trades.iloc[0].pnl, 10)

    def test_stats_and_journal_export(self):
        cfg = BacktestConfig(sizing="fixed", fixed_qty=10, **NO_COSTS)
        r = run_backtest(FLAT_THEN_UP, EnterOnBar(at=1, exit_at=4), cfg)
        s = compute_stats(r)
        self.assertEqual(s["trades"]["total_trades"], 1)
        self.assertEqual(s["trades"]["win_rate"], 1.0)
        self.assertAlmostEqual(s["equity"]["net_profit"], 100)
        j = to_journal_csv(r.trades, "test")
        self.assertEqual(list(j.columns[:8]), ["date", "symbol", "side", "qty", "entry", "exit", "fees", "pnl"])
        self.assertEqual(j.iloc[0]["pnl"], 100)

    def test_unknown_param_rejected(self):
        with self.assertRaises(ValueError):
            EnterOnBar(bogus=1)

    def test_crossover(self):
        a = pd.Series([1, 2, 3, 2, 1])
        self.assertEqual(ta.crossover(a, 2.5).tolist(), [False, False, True, False, False])
        self.assertEqual(ta.crossunder(a, 1.5).tolist(), [False, False, False, False, True])


if __name__ == "__main__":
    unittest.main()
