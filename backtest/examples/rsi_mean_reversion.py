"""Example: long-only RSI(2) mean reversion in an uptrend.

    python run_backtest.py --strategy examples/rsi_mean_reversion.py
"""

from btkit import Strategy, indicators as ta


class RsiMeanReversion(Strategy):
    name = "RSI(2) Mean Reversion"
    params = {"rsi_len": 2, "oversold": 10, "exit_level": 70, "trend_len": 200, "stop_pct": 0.05}
    max_bars_in_trade = 10

    def prepare(self, df):
        df["rsi"] = ta.rsi(df["close"], self.p.rsi_len)
        df["trend"] = ta.sma(df["close"], self.p.trend_len)
        return df

    def entry(self, bar, prev):
        if bar.close > bar.trend and bar.rsi < self.p.oversold:
            return "long"
        return None

    def exit(self, bar, prev, trade):
        return bar.rsi > self.p.exit_level

    def stop_loss(self, bar, side, entry_price):
        return entry_price * (1 - self.p.stop_pct)
