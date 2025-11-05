from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _assert_candles_payload(data: list[dict[str, object]]) -> None:
    assert isinstance(data, list)
    assert data, "Expected non-empty candle payload"
    times = [row["time"] for row in data]
    assert times == sorted(times)
    for row in data:
        assert {"time", "open", "high", "low", "close", "volume"} <= row.keys()
        assert isinstance(row["time"], int)
        assert isinstance(row["volume"], int)


def test_aapl_daily_six_months() -> None:
    response = client.get(
        "/api/ohlc",
        params={"symbol": "AAPL", "interval": "1d", "period": "6mo"},
    )
    assert response.status_code == 200
    _assert_candles_payload(response.json())


def test_btc_usd_intraday() -> None:
    response = client.get(
        "/api/ohlc",
        params={"symbol": "BTC USD", "interval": "5m", "period": "5d"},
    )
    assert response.status_code == 200
    _assert_candles_payload(response.json())

