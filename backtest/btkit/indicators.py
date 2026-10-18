"""Common indicators. Every function takes/returns pandas Series so you can
assign the result straight onto your DataFrame inside ``Strategy.prepare``."""

import numpy as np
import pandas as pd


def sma(series: pd.Series, n: int) -> pd.Series:
    return series.rolling(n).mean()


def ema(series: pd.Series, n: int) -> pd.Series:
    return series.ewm(span=n, adjust=False).mean()


def rsi(series: pd.Series, n: int = 14) -> pd.Series:
    """Wilder's RSI."""
    delta = series.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = gain / loss.replace(0, np.nan)
    return (100 - 100 / (1 + rs)).fillna(100.0).where(loss.notna())


def true_range(df: pd.DataFrame) -> pd.Series:
    prev_close = df["close"].shift()
    return pd.concat(
        [df["high"] - df["low"], (df["high"] - prev_close).abs(), (df["low"] - prev_close).abs()],
        axis=1,
    ).max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    """Wilder's Average True Range."""
    return true_range(df).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def bollinger(series: pd.Series, n: int = 20, k: float = 2.0):
    """Returns (middle, upper, lower)."""
    mid = sma(series, n)
    sd = series.rolling(n).std(ddof=0)
    return mid, mid + k * sd, mid - k * sd


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9):
    """Returns (macd_line, signal_line, histogram)."""
    line = ema(series, fast) - ema(series, slow)
    sig = ema(line, signal)
    return line, sig, line - sig


def highest(series: pd.Series, n: int) -> pd.Series:
    return series.rolling(n).max()


def lowest(series: pd.Series, n: int) -> pd.Series:
    return series.rolling(n).min()


def crossover(a: pd.Series, b) -> pd.Series:
    """True on the bar where ``a`` crosses above ``b`` (a Series or a number)."""
    b_prev = b.shift() if isinstance(b, pd.Series) else b
    return (a > b) & (a.shift() <= b_prev)


def crossunder(a: pd.Series, b) -> pd.Series:
    """True on the bar where ``a`` crosses below ``b`` (a Series or a number)."""
    b_prev = b.shift() if isinstance(b, pd.Series) else b
    return (a < b) & (a.shift() >= b_prev)
