from __future__ import annotations

import math
import re
import time
from dataclasses import dataclass
from typing import Dict, List, Sequence

import pandas as pd
import yfinance as yf


DEFAULT_PERIOD = "1y"

ALLOWED_PERIODS = {"5d", "1mo", "3mo", "6mo", "1y", "2y", "5y", "max"}

PANDAS_FREQ = {
    "5m": "5T",
    "15m": "15T",
    "1h": "60T",
    "4h": "240T",
    "1d": "1D",
    "1wk": "1W",
    "1mo": "MS",
    "3mo": "3MS",
}

# Preferred download intervals for each target interval ordered from finest to coarsest
FETCH_INTERVALS: Dict[str, Sequence[str]] = {
    "5m": ("5m", "2m", "1m"),
    "15m": ("15m", "5m", "2m", "1m"),
    "1h": ("60m", "30m", "15m", "5m", "2m", "1m"),
    "4h": ("60m", "30m", "15m", "5m", "2m", "1m"),
    "1d": ("1d", "60m", "30m", "15m", "5m", "2m", "1m"),
    "1wk": ("1wk", "1d", "60m", "30m", "15m", "5m"),
    "1mo": ("1mo", "1wk", "1d"),
    "3mo": ("3mo", "1mo", "1wk", "1d"),
}

_YF_ALLOWED_INTERVALS = {
    "1m",
    "2m",
    "5m",
    "15m",
    "30m",
    "60m",
    "90m",
    "1h",
    "1d",
    "5d",
    "1wk",
    "1mo",
    "3mo",
}


class FetchError(RuntimeError):
    """Raised when bar data cannot be retrieved from yfinance."""


def normalize_symbol(symbol: str) -> str:
    """Trim, uppercase, and normalise separators for Yahoo Finance tickers."""
    sym = symbol.strip().upper()
    if not sym:
        raise ValueError("Symbol is required")
    # Yahoo Finance uses '-' as the separator for pairs such as BTC-USD.
    sym = re.sub(r"\s+", "-", sym)
    return sym


def _ensure_datetime_index(data: pd.DataFrame) -> pd.DataFrame:
    if not isinstance(data.index, pd.DatetimeIndex):
        raise FetchError("Returned data is not indexed by timestamp")
    idx = data.index
    if idx.tz is None:
        idx = idx.tz_localize("UTC")
    else:
        idx = idx.tz_convert("UTC")
    data = data.copy()
    data.index = idx
    # Remove duplicates, preserving the latest record
    data = data[~data.index.duplicated(keep="last")]
    data = data.sort_index()
    return data


def resample_bars(df: pd.DataFrame, target_interval: str) -> pd.DataFrame:
    """Aggregate to the target interval using OHLCV semantics."""
    if target_interval not in PANDAS_FREQ:
        raise ValueError(f"Unsupported interval '{target_interval}'")

    rule = PANDAS_FREQ[target_interval]
    ohlc = (
        df[["Open", "High", "Low", "Close"]]
        .resample(rule, closed="left", label="right")
        .agg({"Open": "first", "High": "max", "Low": "min", "Close": "last"})
    )
    volume = df["Volume"].resample(rule, closed="left", label="right").sum()
    merged = pd.concat([ohlc, volume], axis=1)
    merged = merged.rename(columns={"Volume": "Volume"})
    merged = merged.dropna()
    if merged.empty:
        return merged
    return merged


def fetch_bars(symbol: str, interval: str, period: str = DEFAULT_PERIOD) -> pd.DataFrame:
    """Fetch OHLCV data for the requested symbol/interval/period."""
    target_interval = interval.lower()
    if target_interval not in PANDAS_FREQ:
        raise ValueError(f"Unsupported interval '{interval}'")

    requested_period = period.lower() if period else DEFAULT_PERIOD
    if requested_period not in ALLOWED_PERIODS:
        raise ValueError(f"Unsupported period '{period}'")

    norm_symbol = normalize_symbol(symbol)
    last_error: str | None = None

    for candidate in FETCH_INTERVALS[target_interval]:
        if candidate not in _YF_ALLOWED_INTERVALS:
            continue
        try:
            data = yf.download(
                tickers=norm_symbol,
                interval=candidate,
                period=requested_period,
                auto_adjust=False,
                actions=False,
                progress=False,
            )
        except Exception as exc:  # pragma: no cover - network errors
            last_error = str(exc)
            continue

        if data.empty:
            last_error = "Received empty dataset"
            continue

        df = data[["Open", "High", "Low", "Close", "Volume"]].copy()
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = [name[0] if isinstance(name, tuple) else name for name in df.columns]
        df = df.dropna(how="any")
        df = _ensure_datetime_index(df)

        if candidate != target_interval:
            df = resample_bars(df, target_interval)
        if df.empty:
            last_error = "No candles after processing"
            continue
        return df

    detail = (
        f"Unable to fetch data for {norm_symbol} {interval} {period}. "
        f"Last error: {last_error or 'no data available'}"
    )
    raise FetchError(detail)


def dataframe_to_candles(df: pd.DataFrame) -> List[Dict[str, float]]:
    """Convert a DataFrame to Lightweight Charts candle objects."""
    records: List[Dict[str, float]] = []
    sorted_df = df.sort_index()
    for ts, row in sorted_df.iterrows():
        open_, high, low, close = (
            row["Open"],
            row["High"],
            row["Low"],
            row["Close"],
        )
        volume = row["Volume"]
        if not all(math.isfinite(val) for val in (open_, high, low, close, volume)):
            continue
        records.append(
            {
                "time": int(ts.timestamp()),
                "open": float(open_),
                "high": float(high),
                "low": float(low),
                "close": float(close),
                "volume": int(volume),
            }
        )
    return records


@dataclass
class CacheEntry:
    expires_at: float
    data: List[Dict[str, float]]


class ResponseCache:
    """Simple TTL cache for API responses."""

    def __init__(self, ttl_seconds: int = 120) -> None:
        self.ttl = ttl_seconds
        self._store: Dict[str, CacheEntry] = {}

    def get(self, key: str) -> List[Dict[str, float]] | None:
        now = time.time()
        entry = self._store.get(key)
        if entry and entry.expires_at > now:
            return entry.data
        if entry:
            self._store.pop(key, None)
        return None

    def set(self, key: str, data: List[Dict[str, float]]) -> None:
        expires = time.time() + self.ttl
        self._store[key] = CacheEntry(expires_at=expires, data=data)

    def prune(self) -> None:
        now = time.time()
        expired = [key for key, entry in self._store.items() if entry.expires_at <= now]
        for key in expired:
            self._store.pop(key, None)
