# Virtual Stock Market Simulator (Indian Markets)

## Setup
1. Get free API key from [Alpha Vantage](https://www.alphavantage.co/support/#api-key) or use Yahoo Finance (no key needed).
2. Backend:
   ```
   cd stock-simulator/server
   copy .env.example .env
   # Edit .env with API_KEY if using AlphaVantage
   npm install
   npm run dev
   ```
3. Frontend:
   ```
   cd stock-simulator/client
   npm install
   npm run dev
   ```
4. Open http://localhost:5173

## Features
- Virtual 10M Rs balance
- Real-time NSE quotes (RELIANCE.NS etc.)
- Buy/Sell simulation
- Portfolio tracking with P&L

Note: Backend uses yahoo-finance2 for NSE data.

