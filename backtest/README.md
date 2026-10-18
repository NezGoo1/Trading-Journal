# 🧪 Strategy Backtester

A Python template for testing a trading strategy. You write your rules in **one file** (`my_strategy.py`). The backtester then reports the stats you need to judge the strategy: returns, risk, trade quality, long vs short, by year, monthly returns and a Monte Carlo stress test. It also writes a CSV you can import straight into the Trading Journal app.

## Quick start

```bash
cd backtest
pip install -r requirements.txt          # pandas + numpy (matplotlib/yfinance optional)
python run_backtest.py                   # runs my_strategy.py on synthetic sample data
```

Then point it at real prices:

```bash
python run_backtest.py --csv data/AAPL.csv                 # your own OHLCV file
python run_backtest.py --yf SPY --start 2015-01-01         # download (pip install yfinance)
python run_backtest.py --yf BTC-USD --interval 1h --start 2025-06-01 --fractional
```

CSV needs `Date, Open, High, Low, Close` (`Volume` optional). Common variants (`timestamp`, `Adj Close`, lowercase, …) are recognised.

## Plugging in your rules

Open **`my_strategy.py`** and edit the five sections:

| Section | Method | What you return |
|---|---|---|
| 1. Parameters | `params = {...}` | Tunable numbers. Read them as `self.p.name` |
| 2. Indicators | `prepare(df)` | `df` with your indicator columns added |
| 3. Entry | `entry(bar, prev)` | `"long"`, `"short"` or `None` |
| 4. Exit | `exit(bar, prev, trade)` | `True` to close the trade |
| 5. Risk | `stop_loss`, `take_profit`, `trailing_stop` | a price, or `None` |

`bar` / `prev` are the current and previous rows. Read any column with dot access: `bar.close`, `bar.rsi`. Built-in indicators are in `btkit/indicators.py`: `sma`, `ema`, `rsi`, `atr`, `bollinger`, `macd`, `highest`, `lowest`, `crossover`, `crossunder`.

Set `max_bars_in_trade = N` for a time-based exit. See `examples/rsi_mean_reversion.py` for a second strategy, and run it with `--strategy examples/rsi_mean_reversion.py`.

Try parameter values without editing the file:

```bash
python run_backtest.py --param fast=10 --param slow=40 --param trade_short=False
```

## How trades are simulated

- Rules are evaluated on each bar's **close**. Orders fill at the **next bar's open**, so there is no look-ahead.
- Stops and targets are checked **inside each bar** using its high and low. A gap through a stop fills at the open. If a bar touches both the stop and the target, the stop is assumed to hit first.
- One position at a time. An exit signal plus an opposite entry on the same bar reverses the position.
- An entry whose stop is already breached at the fill, or can't be computed yet (indicator warm-up), is skipped and counted.

## Account, sizing and costs

| Flag | Default | Meaning |
|---|---|---|
| `--capital` | 100000 | starting equity |
| `--sizing` | `risk` | `risk` = risk `--risk-pct` of equity per trade, using your stop. `percent` = `--position-pct` of equity. `fixed` = `--qty` units |
| `--risk-pct` | 0.01 | 1% of equity at risk per trade |
| `--leverage` | 1.0 | maximum position notional ÷ equity |
| `--commission` / `--commission-pct` | 0 / 0.0005 | fee per side: flat amount and fraction of notional |
| `--slippage-pct` | 0.0005 | adverse fill per side (not applied to limit targets) |
| `--long-only`, `--fractional` | off | turn off shorts, allow fractional quantities |

## What you get

The report prints to the console. Each run also writes a folder under `results/` containing:

- `report.txt`: the full printed report
- `stats.json`: every stat in machine-readable form
- `trades.csv`: each trade with entry/exit, P&L, R-multiple, MAE/MFE and exit reason
- `equity.csv`: the equity and drawdown curves
- `monthly_returns.csv`: a year × month return grid
- `journal_import.csv`: import this into the Trading Journal app (**Data → Import CSV**) to see the backtest on the calendar and analytics screens
- `chart.png`: equity vs buy & hold, drawdown and per-trade P&L (needs matplotlib)

### Stats reported

- **Returns:** net profit, total return, CAGR, exposure (time in market), each next to **buy & hold** of the same instrument
- **Risk:** max drawdown (% and $), longest drawdown, annual volatility, Sharpe, Sortino, Calmar, best and worst period
- **Trades:** count, win rate, profit factor, expectancy, average win and loss, payoff ratio, largest win and loss, streaks, average R, SQN, holding time (all, winners, losers), average MAE/MFE, commissions
- **Breakdowns:** long vs short, exit reasons, by year, monthly returns
- **Monte Carlo:** trades are resampled 2,000 times to give the 5th–95th percentile range of returns and drawdowns, plus the probability of losing money

### Reading the results (rules of thumb)

- **Profit factor above 1.3** and **positive expectancy** after costs are the minimum. Look at results with and without costs.
- **Sharpe above 1** (daily data) is good. Compare it to buy & hold's Sharpe, not only to its return.
- **Plan for the Monte Carlo 95th-percentile drawdown**, not the single historical one.
- **Fewer than about 30 trades** is anecdote, not evidence.
- Hold back recent data with `--end` while you tune, then run once on the unseen period with `--start`. If the out-of-sample results fall apart, the strategy was overfit.

## Tests

```bash
python -m unittest discover -s tests
```
