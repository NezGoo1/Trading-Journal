"""Bar-by-bar backtesting engine.

Execution model (designed to avoid look-ahead bias):
  * Your rules are evaluated on the CLOSE of bar i.
  * Market entries/exits from those rules fill at the OPEN of bar i+1 (plus slippage).
  * Stop-loss and take-profit orders are checked inside every bar using its high/low,
    including the bar you entered on. A gap through a stop fills at the open.
  * If a stop and a target are both touched in the same bar, the stop is assumed
    to have hit first (conservative).
  * One position at a time. If an exit and an opposite entry fire on the same bar,
    the position reverses at the next open.
"""

from dataclasses import dataclass, field, asdict
from types import SimpleNamespace
from typing import Optional

import numpy as np
import pandas as pd


class Strategy:
    """Subclass this and override the hooks you need. See my_strategy.py."""

    name: str = "Unnamed strategy"
    params: dict = {}
    max_bars_in_trade: Optional[int] = None  # force-exit after N bars (None = off)

    def __init__(self, **overrides):
        unknown = set(overrides) - set(self.params)
        if unknown:
            raise ValueError(f"Unknown parameter(s) {sorted(unknown)}; valid: {sorted(self.params)}")
        self.p = SimpleNamespace(**{**self.params, **overrides})

    def prepare(self, df: pd.DataFrame) -> pd.DataFrame:
        """Add indicator / signal columns to ``df`` and return it."""
        return df

    def entry(self, bar, prev) -> Optional[str]:
        """Called on each bar close while flat. Return "long", "short" or None."""
        return None

    def exit(self, bar, prev, trade: "Trade") -> bool:
        """Called on each bar close while in a trade. Return True to exit next open."""
        return False

    def stop_loss(self, bar, side: str, entry_price: float) -> Optional[float]:
        """Initial stop price for a new trade (None = no stop)."""
        return None

    def take_profit(self, bar, side: str, entry_price: float, stop: Optional[float]) -> Optional[float]:
        """Initial target price for a new trade (None = no target)."""
        return None

    def trailing_stop(self, bar, trade: "Trade") -> Optional[float]:
        """Return a new stop each bar to trail it. The engine only ever moves it in your favour."""
        return None


@dataclass
class BacktestConfig:
    initial_capital: float = 100_000.0
    # Sizing: "risk" = risk `risk_pct` of equity per trade (needs a stop; falls back to "percent"),
    #         "percent" = put `position_pct` of equity into each trade,
    #         "fixed" = always trade `fixed_qty` units.
    sizing: str = "risk"
    risk_pct: float = 0.01
    position_pct: float = 1.0
    fixed_qty: float = 100
    max_leverage: float = 1.0          # cap on position notional / equity
    allow_fractional: bool = False     # True for crypto/FX
    commission_per_trade: float = 0.0  # flat fee per side (entry and exit each)
    commission_pct: float = 0.0005     # % of notional per side (0.0005 = 5 bps)
    slippage_pct: float = 0.0005       # adverse fill vs. price per side (not applied to targets)
    allow_short: bool = True
    symbol: str = "SYMBOL"


@dataclass
class Trade:
    symbol: str
    side: str
    entry_time: pd.Timestamp
    entry_price: float
    qty: float
    stop: Optional[float] = None
    target: Optional[float] = None
    initial_stop: Optional[float] = None
    equity_at_entry: float = 0.0
    entry_commission: float = 0.0
    exit_time: Optional[pd.Timestamp] = None
    exit_price: Optional[float] = None
    exit_reason: str = ""
    exit_commission: float = 0.0
    bars_held: int = 0
    pnl: float = 0.0          # net of all commissions
    return_pct: float = 0.0   # pnl / equity at entry
    r_multiple: Optional[float] = None
    mae: float = 0.0          # max adverse excursion, in price (>= 0)
    mfe: float = 0.0          # max favourable excursion, in price (>= 0)

    @property
    def direction(self) -> int:
        return 1 if self.side == "long" else -1

    def unrealized(self, price: float) -> float:
        return self.direction * (price - self.entry_price) * self.qty


@dataclass
class BacktestResult:
    trades: pd.DataFrame
    equity: pd.Series
    data: pd.DataFrame
    config: BacktestConfig
    strategy: Strategy
    skipped_entries: int = 0
    notes: list = field(default_factory=list)


def _slip(price: float, buying: bool, pct: float) -> float:
    return price * (1 + pct) if buying else price * (1 - pct)


def run_backtest(df: pd.DataFrame, strategy: Strategy, config: BacktestConfig = None) -> BacktestResult:
    cfg = config or BacktestConfig()
    data = strategy.prepare(df.copy())
    rows = list(data.itertuples(index=True, name="Bar"))
    if len(rows) < 2:
        raise ValueError("Need at least 2 bars of data")

    cash = cfg.initial_capital
    pos: Optional[Trade] = None
    pending_entry: Optional[str] = None
    pending_exit: Optional[str] = None
    closed: list[Trade] = []
    equity = np.empty(len(rows))
    skipped = 0

    def commission(price, qty):
        return cfg.commission_per_trade + cfg.commission_pct * abs(price * qty)

    def close(trade: Trade, price: float, when, reason: str, slippage: bool = True):
        nonlocal cash
        if slippage:
            price = _slip(price, buying=trade.side == "short", pct=cfg.slippage_pct)
        trade.exit_price, trade.exit_time, trade.exit_reason = price, when, reason
        trade.exit_commission = commission(price, trade.qty)
        gross = trade.unrealized(price)
        trade.pnl = gross - trade.entry_commission - trade.exit_commission
        cash += gross - trade.exit_commission
        trade.return_pct = trade.pnl / trade.equity_at_entry if trade.equity_at_entry else 0.0
        if trade.initial_stop is not None:
            risk = abs(trade.entry_price - trade.initial_stop) * trade.qty
            trade.r_multiple = trade.pnl / risk if risk > 0 else None
        closed.append(trade)

    def size(entry_price: float, stop: Optional[float]) -> float:
        eq = cash
        mode = cfg.sizing
        if mode == "risk" and stop is None:
            mode = "percent"
        if mode == "risk":
            qty = eq * cfg.risk_pct / abs(entry_price - stop)
        elif mode == "percent":
            qty = eq * cfg.position_pct / entry_price
        elif mode == "fixed":
            qty = cfg.fixed_qty
        else:
            raise ValueError(f"Unknown sizing mode {cfg.sizing!r}")
        qty = min(qty, eq * cfg.max_leverage / entry_price)
        return qty if cfg.allow_fractional else float(np.floor(qty))

    def open_(side: str, signal_bar, fill_bar):
        nonlocal cash, pos, skipped
        price = _slip(fill_bar.open, buying=side == "long", pct=cfg.slippage_pct)
        d = 1 if side == "long" else -1
        stop = strategy.stop_loss(signal_bar, side, price)
        if stop is not None and (not np.isfinite(stop) or d * (price - stop) <= 0):
            skipped += 1  # stop not computable yet (NaN indicator) or gapped through — skip
            return
        target = strategy.take_profit(signal_bar, side, price, stop)
        if target is not None and (not np.isfinite(target) or d * (target - price) <= 0):
            target = None
        qty = size(price, stop)
        if not np.isfinite(qty) or qty <= 0:
            skipped += 1
            return
        fee = commission(price, qty)
        pos = Trade(cfg.symbol, side, fill_bar.Index, price, qty, stop, target, stop,
                    equity_at_entry=cash, entry_commission=fee)
        cash -= fee

    prev = None
    for i, bar in enumerate(rows):
        # 1) Orders queued at the previous close fill at this open.
        if pos is not None and pending_exit:
            close(pos, bar.open, bar.Index, pending_exit)
            pos = None
        if pos is None and pending_entry:
            open_(pending_entry, rows[i - 1], bar)
        pending_entry = pending_exit = None

        # 2) Intrabar stop / target checks.
        if pos is not None:
            d = pos.direction
            worst = bar.low if d == 1 else bar.high
            best = bar.high if d == 1 else bar.low
            pos.mae = max(pos.mae, d * (pos.entry_price - worst))
            pos.mfe = max(pos.mfe, d * (best - pos.entry_price))
            if pos.stop is not None and d * (worst - pos.stop) <= 0:
                fill = min(bar.open, pos.stop) if d == 1 else max(bar.open, pos.stop)
                close(pos, fill, bar.Index, "stop")
                pos = None
            elif pos.target is not None and d * (best - pos.target) >= 0:
                fill = max(bar.open, pos.target) if d == 1 else min(bar.open, pos.target)
                close(pos, fill, bar.Index, "target", slippage=False)
                pos = None

        # 3) Evaluate rules on this bar's close.
        if i > 0 and i < len(rows) - 1:
            if pos is not None:
                pos.bars_held += 1
                if strategy.exit(bar, prev, pos):
                    pending_exit = "signal"
                elif strategy.max_bars_in_trade and pos.bars_held >= strategy.max_bars_in_trade:
                    pending_exit = "time"
                else:
                    new_stop = strategy.trailing_stop(bar, pos)
                    if new_stop is not None:
                        if pos.stop is None:
                            pos.stop = new_stop
                        else:
                            pos.stop = max(pos.stop, new_stop) if pos.direction == 1 else min(pos.stop, new_stop)
            if pos is None or pending_exit:
                sig = strategy.entry(bar, prev)
                if sig not in (None, "long", "short"):
                    raise ValueError(f"entry() must return 'long', 'short' or None, got {sig!r}")
                if sig == "short" and not cfg.allow_short:
                    sig = None
                if sig and not (pos is not None and pos.side == sig):
                    pending_entry = sig
        elif pos is not None:
            pos.bars_held += 1

        # 4) Mark to market.
        equity[i] = cash + (pos.unrealized(bar.close) if pos is not None else 0.0)
        prev = bar

    if pos is not None:
        last = rows[-1]
        close(pos, last.close, last.Index, "end_of_data")
        equity[-1] = cash

    trades = pd.DataFrame([{k: v for k, v in asdict(t).items()} for t in closed])
    if trades.empty:
        trades = pd.DataFrame(columns=[f for f in Trade.__dataclass_fields__])
    else:
        for col in ("stop", "target", "initial_stop", "r_multiple"):
            trades[col] = pd.to_numeric(trades[col], errors="coerce").astype(float)
        trades["commission"] = trades["entry_commission"] + trades["exit_commission"]
    eq = pd.Series(equity, index=data.index, name="equity")
    return BacktestResult(trades, eq, data, cfg, strategy, skipped_entries=skipped)
