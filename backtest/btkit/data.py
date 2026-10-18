"""Loading OHLCV price data into the shape the engine expects:
a DataFrame indexed by datetime with lowercase columns
``open, high, low, close`` (``volume`` optional)."""

import numpy as np
import pandas as pd

_ALIASES = {
    "date": "datetime", "time": "datetime", "timestamp": "datetime", "datetime": "datetime",
    "open": "open", "o": "open",
    "high": "high", "h": "high",
    "low": "low", "l": "low",
    "close": "close", "c": "close", "last": "close", "price": "close",
    "adj close": "adj_close", "adj_close": "adj_close", "adjclose": "adj_close",
    "volume": "volume", "vol": "volume", "v": "volume",
}


def normalize(df: pd.DataFrame) -> pd.DataFrame:
    """Rename common column variants, set a sorted DatetimeIndex, drop bad rows."""
    df = df.copy()
    df.columns = [_ALIASES.get(str(c).strip().lower(), str(c).strip().lower()) for c in df.columns]
    if "datetime" in df.columns:
        df["datetime"] = pd.to_datetime(df["datetime"])
        df = df.set_index("datetime")
    df.index = pd.to_datetime(df.index)
    if getattr(df.index, "tz", None) is not None:
        df.index = df.index.tz_localize(None)
    df.index.name = "datetime"

    if "close" not in df.columns and "adj_close" in df.columns:
        df["close"] = df["adj_close"]
    missing = [c for c in ("open", "high", "low", "close") if c not in df.columns]
    if missing:
        raise ValueError(f"Price data is missing columns: {missing}. Found: {list(df.columns)}")

    keep = ["open", "high", "low", "close"] + (["volume"] if "volume" in df.columns else [])
    df = df[keep].apply(pd.to_numeric, errors="coerce")
    df = df.dropna(subset=["open", "high", "low", "close"])
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df


def load_csv(path: str) -> pd.DataFrame:
    return normalize(pd.read_csv(path))


def load_yfinance(symbol: str, start: str = None, end: str = None, interval: str = "1d") -> pd.DataFrame:
    """Download from Yahoo Finance (``pip install yfinance``)."""
    try:
        import yfinance as yf
    except ImportError as e:
        raise ImportError("yfinance is not installed: pip install yfinance") from e
    raw = yf.download(symbol, start=start, end=end, interval=interval, auto_adjust=True, progress=False)
    if raw.empty:
        raise ValueError(f"No data returned for {symbol}")
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = raw.columns.get_level_values(0)
    return normalize(raw.reset_index())


def sample_data(bars: int = 2520, start: str = "2015-01-02", seed: int = 1) -> pd.DataFrame:
    """Synthetic daily OHLCV with trending and choppy regimes — for trying the
    template out before you plug in real data. Not a substitute for real prices."""
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(start, periods=bars)
    regime_drift = rng.choice([-0.0008, 0.0, 0.0012], size=bars // 60 + 1, p=[0.3, 0.3, 0.4])
    drift = np.repeat(regime_drift, 60)[:bars]
    vol = 0.012 + 0.006 * np.abs(np.sin(np.arange(bars) / 90))
    rets = drift + vol * rng.standard_normal(bars)
    close = 100 * np.exp(np.cumsum(rets))
    open_ = np.r_[close[0], close[:-1]] * np.exp(0.002 * rng.standard_normal(bars))
    span = np.abs(rng.standard_normal(bars)) * vol * close * 0.6
    high = np.maximum(open_, close) + span
    low = np.minimum(open_, close) - span
    volume = rng.integers(500_000, 3_000_000, size=bars)
    return pd.DataFrame(
        {"open": open_, "high": high, "low": low, "close": close, "volume": volume},
        index=pd.DatetimeIndex(idx, name="datetime"),
    )
