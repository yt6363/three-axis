# JUPITER Backend API

FastAPI backend for JUPITER Vedic Astrology Trading Terminal.

## Features

- **Vedic Astrology Calculations**: Swiss Ephemeris integration for planetary positions and events
- **Market Data**: Candlestick data fetching via yfinance
- **Orbital Calculations**: Advanced astronomical computations
- **RESTful API**: Fast, modern API with automatic documentation

## Tech Stack

- **FastAPI**: Modern Python web framework
- **pyswisseph**: Swiss Ephemeris for astronomical calculations
- **yfinance**: Market data fetching
- **astropy**: Astronomical calculations
- **pandas**: Data processing

## Local Development

### Prerequisites

- Python 3.11+
- pip

### Setup

1. Create virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Run development server:
```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

4. API will be available at:
- API: http://localhost:8000
- Interactive docs: http://localhost:8000/docs
- Alternative docs: http://localhost:8000/redoc

## API Endpoints

- `GET /candles` - Fetch candlestick data for symbols
- `POST /swiss/horizon` - Calculate Vedic astrology horizon events
- `POST /swiss/monthly` - Calculate monthly planetary events
- `POST /overlay-series` - Compute orbital overlay data

## Deployment

### Railway

1. Install Railway CLI:
```bash
npm i -g @railway/cli
```

2. Login and deploy:
```bash
railway login
railway init
railway up
```

### Environment Variables

No environment variables required for basic operation. CORS is configured to allow all origins.

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py          # FastAPI app and routes
│   ├── swiss.py         # Swiss Ephemeris calculations
│   ├── orbital.py       # Orbital calculations
│   ├── indicators.py    # Technical indicators
│   └── utils.py         # Utility functions
├── tests/               # Test files
├── requirements.txt     # Python dependencies
├── Procfile            # Deployment configuration
└── runtime.txt         # Python version specification
```

## License

Private - JUPITER Vedic Astrology Trading Terminal
