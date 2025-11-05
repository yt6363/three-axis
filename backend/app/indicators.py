from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Dict

import pandas as pd

IndicatorFunction = Callable[[pd.DataFrame, Dict[str, Any]], pd.DataFrame]


@dataclass(frozen=True)
class IndicatorDefinition:
    name: str
    func: IndicatorFunction
    options_schema: Dict[str, Any]


class IndicatorRegistry:
    """Lightweight registry to mirror the frontend indicator interface."""

    def __init__(self) -> None:
        self._indicators: Dict[str, IndicatorDefinition] = {}

    def register(
        self, name: str, func: IndicatorFunction, options_schema: Dict[str, Any]
    ) -> None:
        key = name.lower()
        self._indicators[key] = IndicatorDefinition(
            name=name, func=func, options_schema=options_schema
        )

    def get(self, name: str) -> IndicatorDefinition | None:
        return self._indicators.get(name.lower())


registry = IndicatorRegistry()


def ema_indicator(df: pd.DataFrame, options: Dict[str, Any]) -> pd.DataFrame:
    length = int(options.get("length", 20))
    if length <= 0:
        raise ValueError("EMA length must be positive")
    ema = (
        df["Close"].ewm(span=length, adjust=False).mean().rename("value").to_frame()
    )
    return ema


def rsi_indicator(df: pd.DataFrame, options: Dict[str, Any]) -> pd.DataFrame:
    length = max(int(options.get("length", 14)), 1)
    delta = df["Close"].diff()
    gain = delta.where(delta > 0, 0.0)
    loss = -delta.where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=length, min_periods=length).mean()
    avg_loss = loss.rolling(window=length, min_periods=length).mean()
    rs = avg_gain / avg_loss.replace({0: pd.NA})
    rsi = 100 - (100 / (1 + rs))
    return rsi.rename("value").to_frame()


registry.register(
    "EMA",
    ema_indicator,
    {"length": {"type": "number", "default": 20, "min": 1, "max": 200}},
)

registry.register(
    "RSI",
    rsi_indicator,
    {"length": {"type": "number", "default": 14, "min": 1, "max": 200}},
)

