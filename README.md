# THREE AXIS - Vedic Astrology Terminal

Professional financial charting terminal with integrated Vedic astrology, planetary overlays, and performance optimizations.

## Repository

https://github.com/yt6363/three-axis

## Features

- High-performance charting (<20ms INP, zero snap-back)
- Dual synchronized charts (price + orbital)
- Planetary overlays & event tracking
- Clerk auth + Lemon Squeezy payments
- Next.js 15.5.4 + FastAPI backend

## Quick Start

### Frontend
```bash
cd vedic-ui && npm install && npm run dev
```

### Backend
```bash
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload
```

## Performance

- ✅ <20ms INP on all interactions
- ✅ RequestAnimationFrame updates
- ✅ Zero snap-back panning
- ✅ CLS near 0

Built with Next.js, React 19, FastAPI, and Swiss Ephemeris.
