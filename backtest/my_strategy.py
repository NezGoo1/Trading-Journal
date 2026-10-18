"""
╔══════════════════════════════════════════════════════════════════╗
║  YOUR STRATEGY — edit this file                                  ║
╚══════════════════════════════════════════════════════════════════╝

Fill in the five sections below. Then run:

    python run_backtest.py                       # synthetic sample data
    python run_backtest.py --csv mydata.csv      # your own OHLCV file
    python run_backtest.py --yf SPY --start 2015-01-01
    python run_backtest.py --param fast=10 --param slow=40   # override params

How a bar is processed (no look-ahead):
  * entry()/exit() run on the CLOSE of each bar.
  * The resulting order fills at the NEXT bar's OPEN.
  * Stops/targets are checked intrabar on every bar you're in the trade.

`bar` and `prev` are the current and previous rows. Read any column with
dot access: bar.close, bar.high, bar.volume, or anything you add in
prepare(), e.g. bar.sma_fast. Parameters live in self.p (self.p.fast).
"""

from btkit import Strategy, indicators as ta


class MyStrategy(Strategy):
    # ── 1. NAME & PARAMETERS ─────────────────────────────────────────
    name = "SMA Crossover + ATR Stop"
    params = {
        "fast": 20,          # fast moving average length
        "slow": 50,          # slow moving average length
        "atr_len": 14,
        "stop_atr": 2.0,     # stop distance = stop_atr × ATR
        "target_r": 3.0,     # take profit at N × initial risk (0 = no target)
        "trail_atr": 3.0,    # trailing stop distance in ATRs (0 = no trail)
        "trade_short": True,
    }
    max_bars_in_trade = None  # e.g. 20 to force-exit after 20 bars

    # ── 2. INDICATORS ────────────────────────────────────────────────
    def prepare(self, df):
        df["sma_fast"] = ta.sma(df["close"], self.p.fast)
        df["sma_slow"] = ta.sma(df["close"], self.p.slow)
        df["atr"] = ta.atr(df, self.p.atr_len)
        # Vectorised signal columns are the easiest way to express crossovers:
        df["cross_up"] = ta.crossover(df["sma_fast"], df["sma_slow"])
        df["cross_down"] = ta.crossunder(df["sma_fast"], df["sma_slow"])
        return df

    # ── 3. ENTRY RULES ───────────────────────────────────────────────
    def entry(self, bar, prev):
        """Return "long", "short", or None. Only called while flat
        (or on a bar where an exit has just been signalled → reversal)."""
        if bar.cross_up:
            return "long"
        if bar.cross_down and self.p.trade_short:
            return "short"
        return None

    # ── 4. EXIT RULES ────────────────────────────────────────────────
    def exit(self, bar, prev, trade):
        """Return True to close the open trade at the next open.
        `trade` has .side, .entry_price, .bars_held, .stop, .target, ..."""
        if trade.side == "long":
            return bool(bar.cross_down)
        return bool(bar.cross_up)

    # ── 5. RISK: STOP, TARGET, TRAILING STOP ─────────────────────────
    def stop_loss(self, bar, side, entry_price):
        """Initial stop price, or None. Required for R-multiples and
        for risk-based position sizing."""
        dist = self.p.stop_atr * bar.atr
        return entry_price - dist if side == "long" else entry_price + dist

    def take_profit(self, bar, side, entry_price, stop):
        if not self.p.target_r or stop is None:
            return None
        risk = abs(entry_price - stop)
        return entry_price + self.p.target_r * risk if side == "long" else entry_price - self.p.target_r * risk

    def trailing_stop(self, bar, trade):
        """Called each bar close while in a trade. Return a new stop price
        (the engine only ever tightens it) or None to leave it alone."""
        if not self.p.trail_atr:
            return None
        dist = self.p.trail_atr * bar.atr
        return bar.close - dist if trade.side == "long" else bar.close + dist
