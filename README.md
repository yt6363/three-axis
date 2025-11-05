# Market Terminal

This repository contains a small full-stack candlestick terminal built with a FastAPI backend and a Next.js frontend.

## Backend

- Location: `backend/`
- Stack: FastAPI, pandas, yfinance
- Run: `make backend` (after `make install-backend`)
- Endpoint: `GET /api/ohlc` with query params `symbol`, `interval`, optional `period`
- Tests: `cd backend && python3 -m pytest`

## Frontend

- Location: `vedic-ui/`
- Stack: Next.js (React 19), TypeScript, Lightweight Charts
- Run: `make frontend` (after `make install-frontend`)
- Env: uses `NEXT_PUBLIC_API_BASE` (default `http://localhost:8000`)

## Development

1. Install backend deps: `make install-backend`
2. Install frontend deps: `make install-frontend`
3. Start backend API: `make backend`
4. Start frontend UI: `make frontend`

The frontend expects the backend on port `8000` and will fetch live data on demand. Indicator settings persist in `localStorage` and the backend caches responses for two minutes.

