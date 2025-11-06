# Terminal - Advanced Data Analysis Platform

## Overview
Terminal is a sophisticated data analysis and visualization platform that combines real-time market data with advanced cyclic pattern analysis. Built for traders and analysts who need precise timing and pattern recognition tools.

---

## Core Features

### 1. Real-Time Market Data Integration
- **Multi-Market Support**: Stocks, Crypto, Forex, Commodities, Indices
- **Global Exchange Coverage**: NYSE, NASDAQ, NSE, BSE, Crypto exchanges, and more
- **Live Price Updates**: Real-time candlestick data with multiple timeframe support
- **Symbol Search**: Fast, intelligent search with exchange filtering

### 2. Advanced Chart Visualization
- **Interactive Candlestick Charts**: Professional-grade charting with zoom, pan, and drawing tools
- **Multi-Timeframe Analysis**: 5m, 15m, 1h, 4h, 1d, 1wk, 1mo, 3mo + custom intervals
- **Flexible Period Selection**: 5d, 1mo, 3mo, 6mo, 1y, 2y, 5y, max + custom periods
- **Volume Analysis**: Integrated volume bars with price correlation
- **Dark Theme Interface**: Professional, low-light design optimized for extended use

### 3. Cyclic Overlay System
Proprietary data overlays that track cyclical patterns over time:

- **Geo-Declination (GD)**: Primary cyclic data metric
- **Helio-Declination (HD)**: Secondary cyclic data metric
- **Speed Analysis**: Rate of change tracking for cyclic patterns
- **Force Analysis**: Gravitational force calculations between data points
- **Weighted Analysis**: Composite weighted overlays (W-GD, W-HD)

**Customizable Parameters**:
- 8 data bodies: S, Mo, Me, V, Ma, J, Sa, N, U, P
- Date range selection with duration controls (days, weeks, months, years)
- Multi-body simultaneous tracking
- Custom zoom controls for speed and force overlays

### 4. Event Detection System
Automated detection of significant data events with visual markers:

#### Ingress Events
- Automatic detection of sign transitions
- Color-coded markers on price chart
- Filterable by data body
- Historical event tracking

#### Station Events (Retro)
- Entry and exit point detection
- Duration tracking with start/end markers
- Multi-body monitoring
- Cyan color coding for easy identification

#### Velocity Events
- Maximum and minimum velocity detection
- Peak identification system
- Real-time velocity tracking
- Purple markers for quick recognition

#### Combustion Events
- Proximity event detection
- Entry/exit tracking
- Duration analysis
- Red warning markers

### 5. Horizon Scanning (Advanced)
**Admin-Only Feature**

Time-based horizon analysis system:
- **Lagna Events**: Time-specific calculations with 15-minute precision
- **Moon Events**: Lunar cycle event detection
- **Location-Based Analysis**: Latitude/longitude coordinate system
- **Timezone Support**: Global timezone compatibility
- **Configurable Scan Windows**: 1-48 hour scan ranges
- **Automated Event Logging**: Real-time event detection and reporting

### 6. Harmonic Analysis System
**Plus/Admin Feature**

Slanting time-series harmonic pattern detection:
- **Multi-Body Selection**: Choose any data body for analysis
- **Harmonic Divisions**: 360°, 180°, 120° harmonic cycles
- **Scale Configuration**: Custom price-to-degree scaling (default 1:1)
- **Multi-Line Visualization**: Automatic harmonic line generation
- **Price Level Correlation**: Harmonic support/resistance identification

### 7. Performance Optimizations

#### Batch Processing
- Single-request data fetching for multi-month ranges
- 28x performance improvement (420s → 15s for 7-year data)
- Reduced API calls from 60+ to 1 per batch

#### Smart Caching
- 1-hour cache for event data
- 5-minute cache for symbol search
- Session state persistence
- Request cancellation to prevent blocking

#### Response Time
- <20ms interaction-to-next-paint (INP)
- Zero snap-back during panning
- Smooth 60fps chart interactions
- Instant overlay rendering

### 8. Data Export & Session Management
- **Session Persistence**: Automatic save of all settings, overlays, and selections
- **State Recovery**: Resume exactly where you left off
- **CSV Upload**: Import custom data sets
- **Cross-Device Sync**: Access your analysis from any device

### 9. Tier System

#### Free Tier
- Real-time market data for all symbols
- Basic candlestick charts
- Volume analysis
- Symbol search
- Drawing tools (trendlines)
- Shortform labels (S, Mo, Me, V, Ma, J, Sa)

#### Plus Tier ($19/month)
- All Free features
- Cyclic Overlay system (GD, HD, Speed, Force, Weighted)
- Event detection (Ingress, Retro, Velocity, Combustion)
- Harmonic Analysis system
- Multi-body tracking (up to 8 bodies simultaneously)
- Advanced filtering and date range controls
- Shortform labels

#### Admin Tier (Custom Pricing)
- All Plus features
- Horizon Scanning system
- Lagna and Moon event detection
- Location-based analysis
- Full terminology (no shortforms)
- Priority support
- Custom configurations

---

## Technical Specifications

### Frontend
- **Framework**: Next.js 15.5.4 with React 19
- **Language**: TypeScript
- **Charting**: ECharts (Apache ECharts)
- **UI**: Tailwind CSS with custom dark theme
- **Authentication**: Clerk integration
- **Payments**: Lemon Squeezy integration
- **Date/Time**: Luxon for timezone management

### Backend
- **Framework**: Python FastAPI
- **Calculations**: Swiss Ephemeris library
- **Caching**: In-memory ResponseCache with TTL
- **API**: RESTful endpoints with batch processing support

### Performance Metrics
- **Chart Rendering**: <50ms initial load
- **Interaction Speed**: <20ms INP
- **Data Fetching**: <2s for 7-year dataset (with cache)
- **Search Response**: <150ms (cached results instant)
- **Overlay Calculation**: <1s for 2-year multi-body analysis

### Browser Support
- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile responsive (iOS/Android)

---

## Use Cases

### For Day Traders
- Real-time price action with cyclic pattern overlays
- Event markers for precise entry/exit timing
- Multiple timeframe analysis (5m - 4h)
- Fast symbol switching with search

### For Swing Traders
- Multi-day/week cyclic pattern analysis
- Event detection for trend changes
- Harmonic support/resistance levels
- 1d - 1wk timeframes

### For Position Traders
- Long-term cyclic pattern identification
- Weighted overlay analysis for macro trends
- Historical event correlation
- Monthly/quarterly timeframes

### For Analysts
- Advanced data export capabilities
- Multi-body correlation analysis
- Custom harmonic configurations
- Location-based event analysis (Admin)

---

## Key Differentiators

1. **Unique Cyclic Analysis**: Proprietary overlay system not available in traditional charting platforms
2. **Event Automation**: Automatic detection and marking of significant data events
3. **Performance**: 28x faster than traditional methods with intelligent caching
4. **Precision**: Sub-minute timing accuracy for event detection
5. **Integration**: Seamless combination of market data with cyclic pattern analysis
6. **User Experience**: Professional trader interface with terminal-style design
7. **Flexibility**: Highly customizable parameters for advanced users

---

## Pricing

### Free Forever
- $0/month
- Basic charting and market data
- Perfect for beginners and casual users

### Plus Plan
- $19/month
- Professional cyclic analysis tools
- Event detection and harmonic analysis
- 14-day free trial

### Admin Plan
- Custom pricing
- Enterprise features
- Horizon scanning and location analysis
- Priority support and custom configurations

---

## Getting Started

1. **Sign Up**: Create a free account in seconds
2. **Search Symbol**: Find any stock, crypto, or market instrument
3. **Load Data**: Select timeframe and period
4. **Add Overlays**: Enable cyclic overlays and event detection
5. **Analyze**: Use drawing tools, zoom, and pan to identify patterns
6. **Upgrade**: Unlock advanced features with Plus or Admin tier

---

## Support & Documentation

- **Knowledge Base**: Comprehensive guides and tutorials
- **Video Tutorials**: Step-by-step feature walkthroughs
- **Community Forum**: Connect with other users
- **Email Support**: Response within 24 hours (Plus/Admin)
- **Priority Support**: Dedicated assistance (Admin tier)

---

## Future Roadmap

- [ ] Multi-chart layouts (2x2, 3x1 grids)
- [ ] Custom indicator builder
- [ ] Alert system for events and price levels
- [ ] Mobile apps (iOS/Android)
- [ ] API access for programmatic analysis
- [ ] Backtesting engine
- [ ] Portfolio tracking integration
- [ ] Social sharing and collaboration tools

---

## Security & Privacy

- **Data Encryption**: All data transmitted via HTTPS/TLS
- **Authentication**: Secure Clerk authentication system
- **Payment Security**: PCI-compliant Lemon Squeezy processing
- **Privacy**: No data sharing with third parties
- **Session Security**: Automatic timeout and secure token management

---

*Terminal - Where Data Meets Precision*

**Website**: [Your Website URL]
**Contact**: [Your Contact Email]
**Version**: 1.0.0
**Last Updated**: November 2025
