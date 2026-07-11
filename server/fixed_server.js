process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err?.message || err);
});

const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config({ path: __dirname + '/.env' });

const marketFeed = require('./market-websocket.js');
const nseData = require('./nse-data.js');
const upstoxApi = require('./upstox-api.js');
const db = require('./db.js');

let nseCache = null;
let sensexCache = null;

const app = express();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  'http://127.0.0.1:5175'
];
function corsOrigin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.onrender.com')) {
    callback(null, true);
  } else {
    callback(new Error('Not allowed by CORS'));
  }
}

const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: corsOrigin, methods: ['GET', 'POST'] }
});

app.use(cors({ origin: corsOrigin }));
app.use(express.json());

// JSON parse error handler
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({ error: 'Invalid JSON in request body' });
  }
  next();
});

// Global axios defaults
axios.defaults.timeout = 15000;

// Authentication Middleware
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const generateToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRY || '7d'
  });
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '';
};

// Authentication Routes (Public)
app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    const user = await db.createUser(username, password);
    
    if (!user) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    
    const token = generateToken(user.userId);
    res.json({
      userId: user.userId,
      username: user.username,
      balance: user.balance,
      portfolio: await db.getPortfolio(user.userId) || {},
      optionsPortfolio: await db.getOptionsPortfolio(user.userId) || {},
      watchlist: await db.getWatchlist(user.userId) || [],
      token
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing username or password' });
    const user = await db.verifyUser(username, password);
    if (!user) {
      db.saveLoginHistory(null, username, 'FAILED', getClientIp(req), req.headers['user-agent']).catch(() => {});
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    db.saveLoginHistory(user.userId, username, 'SUCCESS', getClientIp(req), req.headers['user-agent']).catch(() => {});
    
    const token = generateToken(user.userId);
    res.json({
      userId: user.userId,
      username: user.username,
      balance: user.balance,
      portfolio: await db.getPortfolio(user.userId) || {},
      optionsPortfolio: await db.getOptionsPortfolio(user.userId) || {},
      watchlist: await db.getWatchlist(user.userId) || [],
      token
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/google-token', async (req, res) => {
  const { credential } = req.body;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email;
    const name = payload.name;
    const googleId = payload.sub;
    
    let user = await db.getUserByGoogleId(googleId) || await db.getUserByEmail(email);
    if (!user) {
      user = await db.createGoogleUser(googleId, email, name);
    }
    
    await db.saveLoginHistory(user.userId, email, 'SUCCESS', getClientIp(req), req.headers['user-agent']);
    const token = generateToken(user.userId);
    
    res.json({
      userId: user.userId,
      username: user.username,
      balance: user.balance,
      portfolio: await db.getPortfolio(user.userId) || {},
      optionsPortfolio: await db.getOptionsPortfolio(user.userId) || {},
      watchlist: await db.getWatchlist(user.userId) || [],
      token
    });
  } catch (err) {
    res.status(401).json({ error: 'Invalid Google credential' });
  }
});

// Upstox OAuth Routes
app.get('/api/auth/upstox', verifyToken, (req, res) => {
  const authUrl = upstoxApi.getAuthUrl();
  res.json({ url: authUrl });
});

app.get('/auth/upstox', verifyToken, (req, res) => {
  const authUrl = upstoxApi.getAuthUrl();
  res.redirect(authUrl);
});

app.get('/auth/upstox/callback', async (req, res) => {
  const { code, state } = req.query;
  const clientUrl = process.env.CLIENT_URL || 'http://localhost:5173';
  if (!code) {
    return res.redirect(`${clientUrl}/?upstox=error&message=No+authorization+code+provided`);
  }
  try {
    const tokens = await upstoxApi.exchangeCodeForTokens(code);

    // If userId was passed in state, save tokens per-user
    if (state) {
      const expiry = tokens.expiry || (Date.now() + 24 * 60 * 60 * 1000);
      await db.saveUpstoxTokens(state, tokens.accessToken, tokens.refreshToken, expiry);
      console.log(`[Upstox] Tokens saved for user ${state}`);
    }

    console.log('[Upstox] Authentication successful, redirecting to client');
    res.redirect(`${clientUrl}/?upstox=success`);
  } catch (error) {
    console.error('Upstox OAuth callback error:', error.message);
    res.redirect(`${clientUrl}/?upstox=error&message=${encodeURIComponent(error.message)}`);
  }
});

app.get('/auth/upstox/status', verifyToken, async (req, res) => {
  // Check per-user token first
  const userTokens = await db.getUpstoxTokens(req.userId);
  if (userTokens && userTokens.accessToken) {
    const isExpired = userTokens.expiry && Date.now() >= userTokens.expiry;
    res.json({
      authenticated: !isExpired,
      perUser: true,
      connectedAt: userTokens.connectedAt,
      tokenPreview: userTokens.accessToken.substring(0, 20) + '...'
    });
    return;
  }
  // Fall back to system token
  const token = upstoxApi.getAccessToken();
  res.json({
    authenticated: !!token,
    perUser: false,
    tokenPreview: token ? token.substring(0, 20) + '...' : null
  });
});

async function getUserData(userId = 'default') {
  const user = await db.getUser(userId) || { balance: 10000000 };
  const portfolio = await db.getPortfolio(userId) || {};
  const optionsPortfolio = await db.getOptionsPortfolio(userId) || {};
  const watchlist = await db.getWatchlist(userId) || [];

  return {
    balance: user.balance,
    portfolio,
    optionsPortfolio,
    watchlist
  };
}


// yahoo-finance2 v2.x is ESM-only; use dynamic import()
let _yahooFinance = null;
async function getYahooFinance() {
  if (!_yahooFinance) {
    const mod = await import('yahoo-finance2');
    const YahooFinance = mod.default;
    _yahooFinance = new YahooFinance();
  }
  return _yahooFinance;
}

// ===== CACHING & RATE LIMITING =====
const quoteCache = new Map();
const CACHE_TTL = 3 * 1000; // 3 seconds
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 2;

const MOCK_INDICES = {
  '^NSEI': {
    symbol: '^NSEI',
    yahooSymbol: '^NSEI',
    longName: 'Nifty 50',
    shortName: 'NIFTY',
    exchange: 'NSE',
    regularMarketPrice: 24150,
    regularMarketChange: 85,
    regularMarketChangePercent: 0.35,
    regularMarketVolume: 50000000
  },
  '^BSESN': {
    symbol: '^BSESN',
    yahooSymbol: '^BSESN',
    longName: 'S&P BSE Sensex',
    shortName: 'SENSEX',
    exchange: 'BSE',
    regularMarketPrice: 79500,
    regularMarketChange: 320,
    regularMarketChangePercent: 0.40,
    regularMarketVolume: 30000000
  }
};

const MOCK_STOCKS = {
  'RELIANCE.NS': { symbol: 'RELIANCE', yahooSymbol: 'RELIANCE.NS', longName: 'Reliance Industries Ltd', shortName: 'RELIANCE', exchange: 'NSE', regularMarketPrice: 2850, regularMarketChange: 45, regularMarketChangePercent: 1.6, regularMarketVolume: 15000000 },
  'TCS.NS': { symbol: 'TCS', yahooSymbol: 'TCS.NS', longName: 'Tata Consultancy Services Ltd', shortName: 'TCS', exchange: 'NSE', regularMarketPrice: 4120, regularMarketChange: -30, regularMarketChangePercent: -0.72, regularMarketVolume: 8000000 },
  'HDFCBANK.NS': { symbol: 'HDFCBANK', yahooSymbol: 'HDFCBANK.NS', longName: 'HDFC Bank Ltd', shortName: 'HDFCBANK', exchange: 'NSE', regularMarketPrice: 1680, regularMarketChange: 25, regularMarketChangePercent: 1.5, regularMarketVolume: 12000000 },
  'INFY.NS': { symbol: 'INFY', yahooSymbol: 'INFY.NS', longName: 'Infosys Ltd', shortName: 'INFY', exchange: 'NSE', regularMarketPrice: 1520, regularMarketChange: -15, regularMarketChangePercent: -0.98, regularMarketVolume: 10000000 },
  'ICICIBANK.NS': { symbol: 'ICICIBANK', yahooSymbol: 'ICICIBANK.NS', longName: 'ICICI Bank Ltd', shortName: 'ICICIBANK', exchange: 'NSE', regularMarketPrice: 1080, regularMarketChange: 18, regularMarketChangePercent: 1.7, regularMarketVolume: 18000000 },
  'SBIN.NS': { symbol: 'SBIN', yahooSymbol: 'SBIN.NS', longName: 'State Bank of India', shortName: 'SBIN', exchange: 'NSE', regularMarketPrice: 780, regularMarketChange: 12, regularMarketChangePercent: 1.56, regularMarketVolume: 25000000 },
  'BHARTIARTL.NS': { symbol: 'BHARTIARTL', yahooSymbol: 'BHARTIARTL.NS', longName: 'Bharti Airtel Ltd', shortName: 'BHARTIARTL', exchange: 'NSE', regularMarketPrice: 1350, regularMarketChange: -8, regularMarketChangePercent: -0.59, regularMarketVolume: 9000000 },
  'ITC.NS': { symbol: 'ITC', yahooSymbol: 'ITC.NS', longName: 'ITC Ltd', shortName: 'ITC', exchange: 'NSE', regularMarketPrice: 450, regularMarketChange: 5, regularMarketChangePercent: 1.12, regularMarketVolume: 20000000 },
  'LICI.NS': { symbol: 'LICI', yahooSymbol: 'LICI.NS', longName: 'Life Insurance Corporation of India', shortName: 'LICI', exchange: 'NSE', regularMarketPrice: 920, regularMarketChange: 15, regularMarketChangePercent: 1.66, regularMarketVolume: 8000000 },
  'HINDUNILVR.NS': { symbol: 'HINDUNILVR', yahooSymbol: 'HINDUNILVR.NS', longName: 'Hindustan Unilever Ltd', shortName: 'HINDUNILVR', exchange: 'NSE', regularMarketPrice: 2450, regularMarketChange: -20, regularMarketChangePercent: -0.81, regularMarketVolume: 6000000 },
  'AXISBANK.NS': { symbol: 'AXISBANK', yahooSymbol: 'AXISBANK.NS', longName: 'Axis Bank Ltd', shortName: 'AXISBANK', exchange: 'NSE', regularMarketPrice: 1120, regularMarketChange: 8, regularMarketChangePercent: 0.72, regularMarketVolume: 11000000 },
  'KOTAKBANK.NS': { symbol: 'KOTAKBANK', yahooSymbol: 'KOTAKBANK.NS', longName: 'Kotak Mahindra Bank Ltd', shortName: 'KOTAKBANK', exchange: 'NSE', regularMarketPrice: 1780, regularMarketChange: -12, regularMarketChangePercent: -0.67, regularMarketVolume: 7000000 },
  'LT.NS': { symbol: 'LT', yahooSymbol: 'LT.NS', longName: 'Larsen & Toubro Ltd', shortName: 'LT', exchange: 'NSE', regularMarketPrice: 3650, regularMarketChange: 35, regularMarketChangePercent: 0.97, regularMarketVolume: 5000000 },
  'WIPRO.NS': { symbol: 'WIPRO', yahooSymbol: 'WIPRO.NS', longName: 'Wipro Ltd', shortName: 'WIPRO', exchange: 'NSE', regularMarketPrice: 480, regularMarketChange: 3, regularMarketChangePercent: 0.63, regularMarketVolume: 9000000 },
  'TATAMOTORS.NS': { symbol: 'TATAMOTORS', yahooSymbol: 'TATAMOTORS.NS', longName: 'Tata Motors Ltd', shortName: 'TATAMOTORS', exchange: 'NSE', regularMarketPrice: 920, regularMarketChange: 18, regularMarketChangePercent: 2.0, regularMarketVolume: 12000000 },
  'MARUTI.NS': { symbol: 'MARUTI', yahooSymbol: 'MARUTI.NS', longName: 'Maruti Suzuki India Ltd', shortName: 'MARUTI', exchange: 'NSE', regularMarketPrice: 12400, regularMarketChange: -80, regularMarketChangePercent: -0.64, regularMarketVolume: 3000000 },
  'BAJFINANCE.NS': { symbol: 'BAJFINANCE', yahooSymbol: 'BAJFINANCE.NS', longName: 'Bajaj Finance Ltd', shortName: 'BAJFINANCE', exchange: 'NSE', regularMarketPrice: 7200, regularMarketChange: 50, regularMarketChangePercent: 0.7, regularMarketVolume: 4000000 },
  'ADANIENT.NS': { symbol: 'ADANIENT', yahooSymbol: 'ADANIENT.NS', longName: 'Adani Enterprises Ltd', shortName: 'ADANIENT', exchange: 'NSE', regularMarketPrice: 2850, regularMarketChange: -45, regularMarketChangePercent: -1.56, regularMarketVolume: 15000000 },
  'TATASTEEL.NS': { symbol: 'TATASTEEL', yahooSymbol: 'TATASTEEL.NS', longName: 'Tata Steel Ltd', shortName: 'TATASTEEL', exchange: 'NSE', regularMarketPrice: 150, regularMarketChange: 3, regularMarketChangePercent: 2.04, regularMarketVolume: 25000000 },
  'SUNPHARMA.NS': { symbol: 'SUNPHARMA', yahooSymbol: 'SUNPHARMA.NS', longName: 'Sun Pharmaceutical Industries Ltd', shortName: 'SUNPHARMA', exchange: 'NSE', regularMarketPrice: 1680, regularMarketChange: 12, regularMarketChangePercent: 0.72, regularMarketVolume: 5000000 },
  'ONGC.NS': { symbol: 'ONGC', yahooSymbol: 'ONGC.NS', longName: 'Oil and Natural Gas Corporation Ltd', shortName: 'ONGC', exchange: 'NSE', regularMarketPrice: 280, regularMarketChange: 5, regularMarketChangePercent: 1.82, regularMarketVolume: 20000000 }
};


async function waitForSlot() {
  while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function getCachedQuote(symbol) {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  quoteCache.delete(symbol);
  return null;
}

function setCachedQuote(symbol, data) {
  quoteCache.set(symbol, { data, timestamp: Date.now() });
}

function normalizeYahooSymbol(symbol) {
  const query = String(symbol || '').trim();
  if (!query) return query;
  if (query.startsWith('^') || query.includes('.') || query.includes('=')) {
    return query;
  }
  return `${query}.NS`;
}

function normalizeDisplaySymbol(symbol) {
  return String(symbol || '').replace(/\.NS$/, '').trim();
}

function formatChartLabel(date, range) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';

  if (range === '1d') {
    return parsed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  }

  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function getChartRangeConfig(range) {
  const configs = {
    '1d': { yahooRange: '1d', interval: '5m', points: 78 },
    '1w': { yahooRange: '5d', interval: '30m', points: 60 },
    '1m': { yahooRange: '1mo', interval: '1d', points: 22 },
    '3m': { yahooRange: '3mo', interval: '1d', points: 66 },
    '1y': { yahooRange: '1y', interval: '1wk', points: 52 },
    '5d': { yahooRange: '5d', interval: '30m', points: 60 },
    '1mo': { yahooRange: '1mo', interval: '1d', points: 22 },
    '3mo': { yahooRange: '3mo', interval: '1d', points: 66 },
    '6mo': { yahooRange: '6mo', interval: '1d', points: 120 }
  };
  return configs[range] || configs['1m'];
}

function buildChartResponse(symbol, points, meta = {}) {
  if (!points.length) {
    return { symbol, points: [] };
  }

  const first = points[0];
  const last = points[points.length - 1];
  const previousClose = meta.previousClose ?? first.open ?? first.close ?? last.close ?? 0;
  const currentPrice = meta.currentPrice ?? last.close ?? previousClose;
  const change = currentPrice - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;

  return {
    symbol,
    points,
    currentPrice,
    previousClose,
    change,
    changePercent,
    stats: {
      open: first.open ?? first.close,
      high: Math.max(...points.map(point => point.high ?? point.close)),
      low: Math.min(...points.map(point => point.low ?? point.close))
    }
  };
}

function generateFallbackChartSeries(symbol, range) {
  const { points: pointCount } = getChartRangeConfig(range);
  const now = Date.now();
  const stepMs = range === '1d' ? 5 * 60 * 1000 : 24 * 60 * 60 * 1000;
  const upperSymbol = String(symbol || '').toUpperCase();
  let basePrice = 1200;

  if (upperSymbol.includes('NSEI') || upperSymbol.includes('NIFTY')) basePrice = 24100;
  if (upperSymbol.includes('BSESN') || upperSymbol.includes('SENSEX')) basePrice = 80000;

  const points = Array.from({ length: pointCount }, (_, index) => {
    const date = new Date(now - (pointCount - index - 1) * stepMs);
    const drift = Math.sin(index / 5) * basePrice * 0.002;
    const noise = (Math.random() - 0.5) * basePrice * 0.0015;
    const close = Math.max(1, basePrice + drift + noise);
    const open = Math.max(1, close - (Math.random() - 0.5) * basePrice * 0.001);
    const high = Math.max(open, close) + Math.random() * basePrice * 0.001;
    const low = Math.min(open, close) - Math.random() * basePrice * 0.001;

    return {
      date,
      label: formatChartLabel(date, range),
      open,
      high,
      low,
      close,
      volume: 0,
      adjclose: close
    };
  });

  return buildChartResponse(symbol, points);
}

async function fetchQuoteDirect(symbol) {
  const query = normalizeYahooSymbol(symbol);
  const encoded = encodeURIComponent(query);
  const res = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encoded}`, {
    params: { range: '1d', interval: '1d' },
    timeout: 8000,
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
  });
  const meta = res.data?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error('No chart meta data');
  const quotes = res.data?.chart?.result?.[0]?.indicators?.quote?.[0];
  const close = quotes?.close?.find(c => c != null);
  const prevClose = meta.chartPreviousClose || meta.previousClose || 0;
  const price = meta.regularMarketPrice || close || 0;
  return {
    symbol,
    yahooSymbol: meta.symbol,
    longName: meta.symbol,
    shortName: meta.symbol,
    exchange: 'NSE',
    regularMarketPrice: price,
    regularMarketChange: price - prevClose,
    regularMarketChangePercent: prevClose ? ((price - prevClose) / prevClose) * 100 : 0,
    regularMarketVolume: quotes?.volume?.reduce((a, b) => a + (b || 0), 0) || 0
  };
}

async function resolveQuote(symbol) {
  try {
    const cached = getCachedQuote(symbol);
    if (cached) return cached;

    await waitForSlot();
    activeRequests++;

    try {
      const yahooFinance = await getYahooFinance();
      const query = normalizeYahooSymbol(symbol);

      let retries = 3;
      let lastError;

      while (retries > 0) {
        try {
          const result = await Promise.race([
            yahooFinance.quote(query),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 12000))
          ]);
          const quote = {
            symbol,
            yahooSymbol: result.symbol,
            longName: result.longName,
            shortName: result.shortName,
            exchange: result.exchange,
            regularMarketPrice: result.regularMarketPrice || 0,
            regularMarketChange: result.regularMarketChange || 0,
            regularMarketChangePercent: result.regularMarketChangePercent || 0,
            regularMarketVolume: result.regularMarketVolume || 0
          };
          setCachedQuote(symbol, quote);
          return quote;
        } catch (err) {
          lastError = err;
          if (err.message?.includes('429') || err.message?.includes('Too Many Requests')) {
            retries--;
            if (retries > 0) {
              const delay = Math.pow(2, 3 - retries) * 1000;
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          } else {
            throw err;
          }
        }
      }

      if (MOCK_INDICES[query] || MOCK_INDICES[symbol]) {
        console.log('Using fallback mock data for index', symbol);
        return MOCK_INDICES[query] || MOCK_INDICES[symbol];
      }
      if (MOCK_STOCKS[query] || MOCK_STOCKS[symbol]) {
        console.log('Using fallback mock data for stock', symbol);
        return MOCK_STOCKS[query] || MOCK_STOCKS[symbol];
      }
      throw lastError || new Error('Failed to fetch quote after retries');
    } finally {
      activeRequests--;
    }
  } catch (err) {
    console.error('yahoo-finance2 failed for', symbol, err.message);

    // Try direct HTTP fallback (bypasses GDPR consent)
    try {
      const result = await fetchQuoteDirect(symbol);
      setCachedQuote(symbol, result);
      console.log('Direct HTTP quote succeeded for', symbol);
      return result;
    } catch (directErr) {
      console.error('Direct HTTP quote also failed for', symbol, directErr.message);
    }

    const query = normalizeYahooSymbol(symbol);

    if (MOCK_INDICES[query] || MOCK_INDICES[symbol]) {
      return MOCK_INDICES[query] || MOCK_INDICES[symbol];
    }
    if (MOCK_STOCKS[query] || MOCK_STOCKS[symbol]) {
      return MOCK_STOCKS[query] || MOCK_STOCKS[symbol];
    }

    const upperSymbol = String(symbol || '').toUpperCase();
    const basePrice = upperSymbol.includes('NSEI') || upperSymbol.includes('NIFTY') ? 24100 :
      upperSymbol.includes('BSESN') || upperSymbol.includes('SENSEX') ? 80000 : 1200;

    const delta = (Math.random() - 0.5) * (basePrice * 0.01);
    const price = Math.max(1, basePrice + delta);
    const changePercent = delta ? (delta / (price - delta)) * 100 : (Math.random() - 0.5) * 2;

    return {
      symbol,
      yahooSymbol: normalizeYahooSymbol(symbol),
      longName: symbol,
      shortName: symbol,
      exchange: 'NSE',
      regularMarketPrice: price,
      regularMarketChange: delta,
      regularMarketChangePercent: changePercent,
      regularMarketVolume: Math.floor(Math.random() * 10000000)
    };
  }
}

async function fetchChartSeries(symbol, range = '1d') {
  try {
    const query = normalizeYahooSymbol(symbol);
    const { yahooRange, interval } = getChartRangeConfig(range);
    
    // Wait for available slot
    await waitForSlot();
    activeRequests++;
    
    try {
      const encodedQuery = encodeURIComponent(query);
      const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodedQuery}`, {
        params: {
          range: yahooRange,
          interval,
          includePrePost: false
        },
        timeout: 10000
      });
      const result = response.data?.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const quotes = result?.indicators?.quote?.[0] || {};
      const adjClose = result?.indicators?.adjclose?.[0]?.adjclose || [];
      
      if (!timestamps.length) {
        return generateFallbackChartSeries(symbol, range);
      }

      const points = timestamps
        .map((timestamp, index) => ({
          date: new Date(timestamp * 1000),
          label: formatChartLabel(timestamp * 1000, range),
          open: quotes.open?.[index],
          high: quotes.high?.[index],
          low: quotes.low?.[index],
          close: quotes.close?.[index],
          volume: quotes.volume?.[index],
          adjclose: adjClose[index]
        }))
        .filter(point => point.close != null);

      const meta = result.meta || {};
      return buildChartResponse(symbol, points, {
        currentPrice: meta.regularMarketPrice,
        previousClose: meta.chartPreviousClose || meta.previousClose
      });
    } catch (err) {
      console.error('Yahoo chart request failed for', symbol, err.message);
      return generateFallbackChartSeries(symbol, range);
    } finally {
      activeRequests--;
    }
  } catch (err) {
    console.error('Error fetching chart for', symbol, err.message);
    return generateFallbackChartSeries(symbol, range);
  }
}

// Generate mock options chain for indices
function seededRandom(seed) {
  let s = Math.abs(seed | 0) + 1;
  return function () {
    s = (s * 1664525 + 1013904223) & 0x7FFFFFFF;
    return s / 0x7FFFFFFF;
  };
}

function generateOptionsChain(basePrice, strikes = 13, index = 'NIFTY', expiryTimestamp = 0) {
  const chain = [];
  const step = index.toUpperCase() === 'SENSEX' ? 100 : 50;
  const roundedBase = Math.round(basePrice / step) * step;
  const halfStrikes = Math.floor(strikes / 2);
  const weeksToExpiry = expiryTimestamp > 0
    ? Math.max(0.5, (expiryTimestamp - Date.now() / 1000) / (7 * 86400))
    : 1;
  const tValuePct = index.toUpperCase() === 'SENSEX' ? 0.0044 : 0.006;
  const baseTimeValue = basePrice * tValuePct * Math.sqrt(weeksToExpiry);
  const decayLambda = index.toUpperCase() === 'SENSEX' ? 250 : 300;

  for (let i = -halfStrikes; i <= halfStrikes; i++) {
    const strike = roundedBase + (i * step);
    const distFromSpot = Math.abs(strike - basePrice);
    const isATM = distFromSpot < step;
    const rng = seededRandom(expiryTimestamp + strike);

    const callIntrinsic = Math.max(0, basePrice - strike);
    const putIntrinsic = Math.max(0, strike - basePrice);

    const timeDecay = Math.exp(-distFromSpot / decayLambda);

    const callLtp = +(callIntrinsic + baseTimeValue * timeDecay).toFixed(2);
    const putLtp = +(putIntrinsic + baseTimeValue * timeDecay).toFixed(2);

    chain.push({
      strike,
      call: {
        oi: Math.floor(rng() * 5000000) + 500000,
        ltp: callLtp,
        iv: (15 + rng() * 15).toFixed(2),
        volume: Math.floor(rng() * 100000) + 10000,
        change: (rng() * 10 - 5).toFixed(2),
        bid: +(callLtp * 0.95).toFixed(2),
        ask: +(callLtp * 1.05).toFixed(2)
      },
      put: {
        oi: Math.floor(rng() * 5000000) + 500000,
        ltp: putLtp,
        iv: (15 + rng() * 15).toFixed(2),
        volume: Math.floor(rng() * 100000) + 10000,
        change: (rng() * 10 - 5).toFixed(2),
        bid: +(putLtp * 0.95).toFixed(2),
        ask: +(putLtp * 1.05).toFixed(2)
      },
      isATM
    });
  }

  return chain;
}

async function enrichWatchlist(items = []) {
  return Promise.all(
    items.map(async (item) => {
      try {
        const quote = await resolveQuote(item.yahooSymbol || item.symbol);
        return {
          symbol: quote.symbol,
          yahooSymbol: quote.yahooSymbol,
          name: item.name || quote.longName || quote.shortName || quote.symbol,
          exchange: quote.exchange,
          regularMarketPrice: quote.regularMarketPrice,
          regularMarketChangePercent: quote.regularMarketChangePercent
        };
      } catch (err) {
        return {
          symbol: item.symbol,
          yahooSymbol: item.yahooSymbol || item.symbol,
          name: item.name || item.symbol,
          exchange: item.exchange || '',
          regularMarketPrice: 0,
          regularMarketChangePercent: 0
        };
      }
    })
  );
}

app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const quote = await resolveQuote(req.params.symbol);
    res.json(quote);
  } catch (err) {
    // Last-resort fallback so UI doesn't break.
    const symbol = req.params.symbol;
    res.json({
      symbol,
      yahooSymbol: normalizeYahooSymbol(symbol),
      longName: symbol,
      shortName: symbol,
      exchange: 'NSE',
      regularMarketPrice: 0,
      regularMarketChange: 0,
      regularMarketChangePercent: 0,
      regularMarketVolume: 0
    });
  }
});

// ===== SEARCH HELPERS =====
function sanitizeQuery(query) {
  return String(query || '').toUpperCase().trim();
}

function uniqueBy(arr, fn) {
  const seen = new Set();
  return arr.filter(item => {
    const key = fn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rankIndianSearchResults(results, query) {
  const q = sanitizeQuery(query);
  return results
    .map(r => {
      let score = 0;
      const sym = String(r.symbol || '').toUpperCase();
      const name = String(r.name || r.shortName || r.longName || '').toUpperCase();
      if (sym === q) score += 100;
      else if (sym.startsWith(q)) score += 80;
      else if (sym.includes(q)) score += 40;
      if (name === q) score += 60;
      else if (name.includes(q)) score += 20;
      if (r.exchange === 'NSE') score += 10;
      return { ...r, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function searchYahoo(query) {
  try {
    const yahooFinance = await getYahooFinance();
    const results = await yahooFinance.search(query);
    return (results.quotes || [])
      .filter(q => q.symbol && (q.exchange === 'NSE' || q.exchange === 'BSE'))
      .slice(0, 10)
      .map(q => ({
        symbol: q.symbol,
        name: q.shortName || q.longName || q.symbol,
        exchange: q.exchange,
        type: q.quoteType || 'EQUITY'
      }));
  } catch (err) {
    console.error('Yahoo search failed:', err.message);
    return [];
  }
}

const allIndianStocks = [
  { symbol: 'RELIANCE', name: 'Reliance Industries Ltd' },
  { symbol: 'TCS', name: 'Tata Consultancy Services Ltd' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd' },
  { symbol: 'INFY', name: 'Infosys Ltd' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd' },
  { symbol: 'SBIN', name: 'State Bank of India' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd' },
  { symbol: 'ITC', name: 'ITC Ltd' },
  { symbol: 'LICI', name: 'Life Insurance Corporation of India' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd' },
  { symbol: 'AXISBANK', name: 'Axis Bank Ltd' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank Ltd' },
  { symbol: 'LT', name: 'Larsen & Toubro Ltd' },
  { symbol: 'WIPRO', name: 'Wipro Ltd' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Ltd' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki India Ltd' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance Ltd' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises Ltd' },
  { symbol: 'TATASTEEL', name: 'Tata Steel Ltd' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries Ltd' },
  { symbol: 'ONGC', name: 'Oil and Natural Gas Corporation Ltd' },
  { symbol: 'NTPC', name: 'NTPC Ltd' },
  { symbol: 'POWERGRID', name: 'Power Grid Corporation of India Ltd' },
  { symbol: 'M&M', name: 'Mahindra & Mahindra Ltd' },
  { symbol: 'TITAN', name: 'Titan Company Ltd' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints Ltd' },
  { symbol: 'NESTLEIND', name: 'Nestle India Ltd' },
  { symbol: 'HCLTECH', name: 'HCL Technologies Ltd' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement Ltd' },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv Ltd' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports and Special Economic Zone Ltd' },
  { symbol: 'JSWSTEEL', name: 'JSW Steel Ltd' },
  { symbol: 'TRENT', name: 'Trent Ltd' },
  { symbol: 'COALINDIA', name: 'Coal India Ltd' },
  { symbol: 'BRITANNIA', name: 'Britannia Industries Ltd' },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance Company Ltd' },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance Company Ltd' },
  { symbol: 'EICHERMOT', name: 'Eicher Motors Ltd' },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto Ltd' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp Ltd' },
  { symbol: 'DLF', name: 'DLF Ltd' },
  { symbol: 'HAL', name: 'Hindustan Aeronautics Ltd' },
  { symbol: 'BEL', name: 'Bharat Electronics Ltd' },
  { symbol: 'IRCTC', name: 'Indian Railway Catering and Tourism Corporation Ltd' },
  { symbol: 'VEDL', name: 'Vedanta Ltd' },
  { symbol: 'IOC', name: 'Indian Oil Corporation Ltd' },
  { symbol: 'BPCL', name: 'Bharat Petroleum Corporation Ltd' },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products Ltd' },
  { symbol: 'DIVISLAB', name: 'Divi\'s Laboratories Ltd' },
  { symbol: 'DRREDDY', name: 'Dr. Reddy\'s Laboratories Ltd' },
  { symbol: 'CIPLA', name: 'Cipla Ltd' },
  { symbol: 'GRASIM', name: 'Grasim Industries Ltd' },
  { symbol: 'HINDALCO', name: 'Hindalco Industries Ltd' },
  { symbol: 'TECHM', name: 'Tech Mahindra Ltd' },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank Ltd' },
  { symbol: 'ZOMATO', name: 'Zomato Ltd' },
  { symbol: 'PIDILITIND', name: 'Pidilite Industries Ltd' },
  { symbol: 'HAVELLS', name: 'Havells India Ltd' },
  { symbol: 'GODREJCP', name: 'Godrej Consumer Products Ltd' },
  { symbol: 'MARICO', name: 'Marico Ltd' },
  { symbol: 'SIEMENS', name: 'Siemens Ltd' },
  { symbol: 'BHEL', name: 'Bharat Heavy Electricals Ltd' },
  { symbol: 'GAIL', name: 'GAIL (India) Ltd' },
  { symbol: 'YESBANK', name: 'Yes Bank Ltd' },
  { symbol: 'IDEA', name: 'Vodafone Idea Ltd' },
  { symbol: 'AUBANK', name: 'AU Small Finance Bank Ltd' },
  { symbol: 'FEDERALBNK', name: 'Federal Bank Ltd' },
  { symbol: 'PFC', name: 'Power Finance Corporation Ltd' },
  { symbol: 'RECLTD', name: 'REC Ltd' },
  { symbol: 'NHPC', name: 'NHPC Ltd' },
  { symbol: 'CONCOR', name: 'Container Corporation of India Ltd' }
];

async function handleSearch(req, res) {
  try {
    const query = String(req.query.q || '').trim();
    if (!query) return res.json([]);

    const yahooMatches = await searchYahoo(query).catch(() => []);
    const rankedMatches = rankIndianSearchResults(yahooMatches, query);
    const localMatches = allIndianStocks
      .filter((stock) => stock.symbol.includes(sanitizeQuery(query)) || stock.name.toUpperCase().includes(sanitizeQuery(query)))
      .map((stock) => ({
        symbol: stock.symbol,
        yahooSymbol: `${stock.symbol}.NS`,
        name: stock.name,
        exchange: 'NSE',
        type: 'EQUITY',
        score: 0
      }));

    res.json(uniqueBy([...localMatches, ...rankedMatches], (item) => item.yahooSymbol || item.symbol).slice(0, 12));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

app.get('/api/search', handleSearch);

app.get('/api/search/:query', async (req, res) => {
  req.query.q = req.params.query;
  return handleSearch(req, res);
});

app.get('/api/chart/:symbol', async (req, res) => {
  try {
    const range = String(req.query.range || '1d');
    const chart = await fetchChartSeries(req.params.symbol, range);
    res.json(chart);
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

app.get('/api/stocks', (req, res) => {
  res.json(allIndianStocks);
});

app.get('/api/watchlist/:userId', verifyToken, async (req, res) => {
  try {
    if (req.params.userId !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const userId = req.userId;
    const userData = await getUserData(userId);
    const enriched = await enrichWatchlist(userData.watchlist || []);
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/watchlist', verifyToken, async (req, res) => {
  try {
    const { symbol } = req.body;
    if (!symbol) return res.status(400).json({ error: 'Symbol is required' });

    const userId = req.userId;
    const userData = await getUserData(userId);
    const quote = await resolveQuote(symbol);
    const nextWatchlist = [...(userData.watchlist || [])];

    if (!nextWatchlist.some((item) => item.symbol === quote.symbol)) {
      nextWatchlist.push({
        symbol: quote.symbol,
        yahooSymbol: quote.yahooSymbol,
        name: quote.longName || quote.shortName || quote.symbol,
        exchange: quote.exchange
      });
      // Save to database
      await db.addToWatchlist(userId, quote.symbol, quote.yahooSymbol, quote.longName || quote.shortName || quote.symbol, quote.exchange);
    }

    const enriched = await enrichWatchlist(nextWatchlist);
    io.emit('watchlistUpdate', { userId, watchlist: enriched });
    res.json(enriched);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/watchlist/:userId/:symbol', verifyToken, async (req, res) => {
  try {
    const { userId, symbol } = req.params;
    
    // Verify user can only delete their own watchlist
    if (userId !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const userData = await getUserData(userId);
    const normalizedSymbol = normalizeDisplaySymbol(symbol);
    const nextWatchlist = (userData.watchlist || []).filter((item) => item.symbol !== normalizedSymbol);
    // Save to database
    await db.removeFromWatchlist(userId, normalizedSymbol);

    const enriched = await enrichWatchlist(nextWatchlist);
    io.emit('watchlistUpdate', { userId, watchlist: enriched });
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const tradeLocks = {};

app.post('/api/trade', verifyToken, async (req, res) => {
  const { symbol, action, qty, price } = req.body;
  const userId = req.userId;
  const parsedQty = Number(qty);
  const parsedPrice = Number(price);

  if (!symbol || !Number.isFinite(parsedQty) || parsedQty <= 0 || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    return res.status(400).json({ error: 'Invalid trade payload' });
  }

  // Acquire per-user lock to prevent race conditions
  while (tradeLocks[userId]) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  tradeLocks[userId] = true;
  try {
    const userData = await getUserData(userId);
    const totalCost = parsedQty * parsedPrice;

    if (action === 'buy') {
      if (userData.balance < totalCost) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }

      userData.balance -= totalCost;
      if (!userData.portfolio[symbol]) userData.portfolio[symbol] = { qty: 0, avgPrice: 0 };

      const oldValue = userData.portfolio[symbol].qty * userData.portfolio[symbol].avgPrice;
      const newQty = userData.portfolio[symbol].qty + parsedQty;
      userData.portfolio[symbol].avgPrice = (oldValue + totalCost) / newQty;
      userData.portfolio[symbol].qty = newQty;
      
      // Persist buy to database
      await db.updatePortfolio(userId, symbol, userData.portfolio[symbol].qty, userData.portfolio[symbol].avgPrice);
    } else if (action === 'sell') {
      if (!userData.portfolio[symbol] || userData.portfolio[symbol].qty < parsedQty) {
        return res.status(400).json({ error: 'Insufficient shares' });
      }

      const avgEntry = userData.portfolio[symbol].avgPrice;
      const realizedPnL = (parsedPrice - avgEntry) * parsedQty;

      userData.balance += totalCost;
      userData.portfolio[symbol].qty -= parsedQty;
      
      if (userData.portfolio[symbol].qty <= 0) {
        await db.clearPortfolioPosition(userId, symbol);
        delete userData.portfolio[symbol];
      } else {
        await db.updatePortfolio(userId, symbol, userData.portfolio[symbol].qty, userData.portfolio[symbol].avgPrice);
      }
      
      await db.saveTrade(userId, symbol, 'EQUITY', parsedQty, avgEntry, parsedPrice, realizedPnL);
    } else {
      return res.status(400).json({ error: 'Unsupported trade action' });
    }

    // Save balance to database
    await db.updateUserBalance(userId, userData.balance);
    
    // Save order to history
    await db.saveOrder(userId, symbol, `${symbol}.NS`, action, parsedQty, parsedPrice, totalCost);
    
    io.emit('userUpdate', { userId, ...userData });
    res.json(userData);
  } finally {
    delete tradeLocks[userId];
  }
});

// Options Trading Endpoints
const getLotSize = (index) => (index && index.toUpperCase() === 'SENSEX') ? 20 : 65;

const lookUpOptionPrice = (index, strike, type) => {
  const cache = index === 'SENSEX' ? sensexCache : nseCache;
  if (!cache?.data?.chain) return null;
  const item = cache.data.chain.find(c => c.strike === strike);
  if (!item) return null;
  const side = type === 'CE' ? 'call' : 'put';
  return item[side]?.ltp || null;
};

app.post('/api/options/trade', verifyToken, async (req, res) => {
  const { contract, action, quantity, premium, strike, type, index, expiry } = req.body;
  const userId = req.userId;
  const parsedQty = Number(quantity);
  const parsedPremium = Number(premium);

  if (!contract || !Number.isFinite(parsedQty) || parsedQty <= 0 || !Number.isFinite(parsedPremium) || parsedPremium <= 0) {
    return res.status(400).json({ error: 'Invalid options trade payload' });
  }

  const lotSize = getLotSize(index);
  if (parsedQty % lotSize !== 0) {
    return res.status(400).json({ error: `Quantity must be a multiple of ${lotSize} (lot size for ${index})` });
  }

  // Acquire per-user lock to prevent race conditions
  while (tradeLocks[userId]) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  tradeLocks[userId] = true;
  try {
    const userData = await getUserData(userId);
    const totalCost = parsedQty * parsedPremium;

    if (action === 'buy') {
      if (userData.balance < totalCost) {
        return res.status(400).json({ error: 'Insufficient balance' });
      }

      userData.balance -= totalCost;
      if (!userData.optionsPortfolio) userData.optionsPortfolio = {};
      
      const optionKey = contract;
      if (!userData.optionsPortfolio[optionKey]) {
        userData.optionsPortfolio[optionKey] = {
          contract, strike, type, index, expiry, quantity: 0, avgPremium: 0
        };
      }

      const oldValue = userData.optionsPortfolio[optionKey].quantity * userData.optionsPortfolio[optionKey].avgPremium;
      const newQty = userData.optionsPortfolio[optionKey].quantity + parsedQty;
      userData.optionsPortfolio[optionKey].avgPremium = (oldValue + totalCost) / newQty;
      userData.optionsPortfolio[optionKey].quantity = newQty;
      
      await db.saveOptionsTrade(userId, contract, strike, type, index, expiry, action, parsedQty, parsedPremium, totalCost);
      await db.updateOptionsPortfolio(userId, contract, strike, type, index, expiry, newQty, userData.optionsPortfolio[optionKey].avgPremium);
    } else if (action === 'sell') {
      if (!userData.optionsPortfolio || !userData.optionsPortfolio[contract] || userData.optionsPortfolio[contract].quantity < parsedQty) {
        return res.status(400).json({ error: 'Insufficient options position' });
      }

      const avgEntry = userData.optionsPortfolio[contract].avgPremium;
      const realizedPnL = (parsedPremium - avgEntry) * parsedQty;

      userData.balance += totalCost;
      userData.optionsPortfolio[contract].quantity -= parsedQty;
      
      await db.saveOptionsTrade(userId, contract, strike, type, index, expiry, action, parsedQty, parsedPremium, totalCost);
      await db.saveTrade(userId, contract, 'OPTION', parsedQty, avgEntry, parsedPremium, realizedPnL);
      await db.updateOptionsPortfolio(userId, contract, strike, type, index, expiry, userData.optionsPortfolio[contract].quantity, avgEntry);
      
      if (userData.optionsPortfolio[contract].quantity <= 0) {
        delete userData.optionsPortfolio[contract];
      }
    } else {
      return res.status(400).json({ error: 'Unsupported trade action' });
    }

    // Save balance to database
    await db.updateUserBalance(userId, userData.balance);
    
    io.emit('userUpdate', { userId, ...userData });
    res.json(userData);
  } finally {
    delete tradeLocks[userId];
  }
});

app.get('/api/options/portfolio/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;
  
  if (userId !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const userData = await getUserData(userId);
  res.json(userData.optionsPortfolio || {});
});

app.get('/api/portfolio/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;
  
  if (userId !== 'default' && userId !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const actualUserId = req.userId;
  const userData = await getUserData(actualUserId);
  const symbols = Object.keys(userData.portfolio);
  const quotes = {};

  if (symbols.length > 0) {
    try {
      const quoteResults = await Promise.all(symbols.map((symbol) => resolveQuote(symbol)));
      quoteResults.forEach((quote) => {
        quotes[quote.symbol] = quote;
      });
    } catch (err) {
      console.error('Quote fetch error:', err.message);
    }
  }

  const enrichedPortfolio = {};
  Object.entries(userData.portfolio).forEach(([symbol, position]) => {
    const quote = quotes[symbol];
    const currentPrice = quote?.regularMarketPrice || 0;
    const pnl = currentPrice ? (currentPrice - position.avgPrice) * position.qty : 0;
    enrichedPortfolio[symbol] = {
      ...position,
      type: 'EQUITY',
      currentPrice,
      pnl,
      pnlPercent: position.avgPrice ? ((currentPrice / position.avgPrice - 1) * 100) : 0,
      dayChange: quote?.regularMarketChange || 0,
      dayChangePercent: quote?.regularMarketChangePercent || 0
    };
  });

  // Add options
  const optionsPort = userData.optionsPortfolio || {};
  Object.entries(optionsPort).forEach(([contract, pos]) => {
    const lotSize = getLotSize(pos.index);
    const livePrice = lookUpOptionPrice(pos.index, pos.strike, pos.type) ?? pos.avgPremium;
    const pnl = (livePrice - pos.avgPremium) * pos.quantity;
    enrichedPortfolio[contract] = {
      ...pos,
      type: 'OPTION',
      symbol: contract,
      avgPrice: pos.avgPremium,
      qty: pos.quantity,
      lots: pos.quantity / lotSize,
      lotSize,
      currentPrice: livePrice,
      pnl,
      pnlPercent: pos.avgPremium ? ((livePrice / pos.avgPremium - 1) * 100) : 0,
      dayChange: 0,
      dayChangePercent: 0
    };
  });

  res.json({ ...userData, portfolio: enrichedPortfolio });
});

// Fast-refresh endpoint for live options P&L only
app.get('/api/options/portfolio/live/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;
  if (userId !== req.userId) return res.status(403).json({ error: 'Forbidden' });

  const userData = await getUserData(userId);
  const optionsPort = userData.optionsPortfolio || {};
  const liveOptions = {};

  Object.entries(optionsPort).forEach(([contract, pos]) => {
    const lotSize = getLotSize(pos.index);
    const livePrice = lookUpOptionPrice(pos.index, pos.strike, pos.type) ?? pos.avgPremium;
    const pnl = (livePrice - pos.avgPremium) * pos.quantity;
    liveOptions[contract] = {
      ...pos,
      type: 'OPTION',
      symbol: contract,
      avgPrice: pos.avgPremium,
      qty: pos.quantity,
      lots: pos.quantity / lotSize,
      lotSize,
      currentPrice: livePrice,
      pnl,
      pnlPercent: pos.avgPremium ? ((livePrice / pos.avgPremium - 1) * 100) : 0,
      dayChange: 0,
      dayChangePercent: 0
    };
  });

  res.json(liveOptions);
});

app.get('/api/orders/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;
  
  if (userId !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const limit = parseInt(req.query.limit) || 50;
  const eqOrders = await db.getOrderHistory(userId, limit);
  const optTrades = await db.getOptionsTrades(userId, limit);
  
  const combined = [
    ...eqOrders.map(o => ({...o, instrumentType: 'EQUITY', time: o.orderTime})),
    ...optTrades.map(o => ({...o, symbol: o.contract, price: o.premium, instrumentType: 'OPTION', time: o.tradeTime}))
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, limit);

  res.json(combined);
});


app.get('/api/trades/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;
  if (userId !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  const trades = await db.getTradeHistory(userId, 100);
  res.json(trades);
});

// Delete/cancel order and reverse the trade
app.delete('/api/orders/:orderId', verifyToken, async (req, res) => {
  const { orderId } = req.params;
  const userId = req.userId;
  
  // Get the order first to verify it belongs to the user
  const orders = await db.getOrderHistory(userId, 999);
  const order = orders.find(o => o.id == orderId);
  
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  // Just delete the order record - do NOT reverse the trade
  // Portfolio state is the source of truth, not order history
  const result = await db.deleteOrderHistoryRecord(orderId, userId);
  
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  res.json({ success: true, message: 'Order record deleted' });
});

// Delete/cancel all orders and reverse trades
app.delete('/api/orders/user/:userId/all', verifyToken, async (req, res) => {
  try {
    if (req.params.userId !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = req.userId;
    
    const result = await db.deleteAllOrders(userId);
    await db.clearPortfolio(userId);
    await db.resetBalance(userId);
    
    // Return updated user data after deletion
    const userData = await getUserData(userId);
    io.emit('userUpdate', { userId, ...userData });
    console.log(`[CLEAR ALL] userId=${userId}, deleted ${result.changes} orders, portfolio+balance reset`);
    res.json({ success: true, message: `Cleared ${result.changes} orders, reset portfolio and balance` });
  } catch (err) {
    console.error('Clear all orders error:', err);
    res.status(500).json({ error: err.message || 'Failed to clear orders' });
  }
});

// Get user profile
app.get('/api/user/profile', verifyToken, async (req, res) => {
  const user = await db.getUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

// Update user balance (add or set)
app.put('/api/user/balance', verifyToken, async (req, res) => {
  try {
    const { balance, add } = req.body;
    const userId = req.userId;
    
    const user = await db.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    let newBalance;
    
    if (add !== undefined) {
      // Add to existing balance
      const addAmount = Number(add);
      if (!Number.isFinite(addAmount)) {
        return res.status(400).json({ error: 'Invalid amount' });
      }
      // Ensure user.balance is treated as a number
      newBalance = Number(user.balance) + addAmount;
    } else if (balance !== undefined) {
      // Set to specific balance
      newBalance = Number(balance);
    } else {
      return res.status(400).json({ error: 'balance or add amount required' });
    }
    
    if (!Number.isFinite(newBalance) || newBalance < 0) {
      return res.status(400).json({ error: 'Invalid balance' });
    }
    
    await db.updateUserBalance(userId, newBalance);
    
    const updatedUser = await db.getUser(userId);
    io.emit('userUpdate', { userId, balance: updatedUser.balance });
    res.json({ success: true, balance: updatedUser.balance });
  } catch (err) {
    console.error('Balance update error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

app.post('/api/options/subscribe-strikes', (req, res) => {
  const { index, strikes } = req.body;
  if (!index || !strikes?.length) {
    return res.status(400).json({ error: 'index and strikes[] required' });
  }
  marketFeed.subscribe(index, strikes);
  res.json({ success: true, index, subscribed: strikes.length });
});

setInterval(async () => {
  try {
    const sampleQuote = await resolveQuote('RELIANCE');
    io.emit('stockUpdate', sampleQuote);
  } catch (err) {
    console.error('Realtime quote broadcast failed:', err.message);
  }
}, 30000);

// ─── Market WebSocket Feed Integration ────────────────────────────
marketFeed.on('tick', (tick) => {
  io.emit('optionPriceUpdate', tick);
});

io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('subscribeOptionStrikes', (data) => {
    const { index, strikes } = data;
    if (index && strikes?.length) {
      marketFeed.subscribe(index, strikes);
    }
  });

  socket.on('unsubscribeOptionStrikes', (data) => {
    const { index, strikes } = data;
    if (index && strikes?.length) {
      marketFeed.unsubscribe(index, strikes);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start the market data feed after server is ready
marketFeed.start();

async function updateCacheFromUpstox() {
  if (!upstoxApi.getAccessToken()) return false;
  try {
    const [niftyData, sensexData] = await Promise.all([
      upstoxApi.getOptionsChain('NIFTY').catch(() => null),
      upstoxApi.getOptionsChain('SENSEX').catch(() => null)
    ]);
    if (niftyData?.chain?.length) {
      nseCache = { data: niftyData, timestamp: Date.now() };
      marketFeed.seedStrikePrices(niftyData.chain, 'NIFTY');
    }
    if (sensexData?.chain?.length) {
      sensexCache = { data: sensexData, timestamp: Date.now() };
      marketFeed.seedStrikePrices(sensexData.chain, 'SENSEX');
    }
    if (niftyData?.spotPrice || sensexData?.spotPrice) {
      marketFeed.updateBasePrices({
        NIFTY: niftyData?.spotPrice,
        SENSEX: sensexData?.spotPrice
      });
    }
    return !!(niftyData?.chain?.length || sensexData?.chain?.length);
  } catch (_) { return false; }
}

// Warm the NSE session and populate cache
updateCacheFromUpstox().then(ok => {
  if (!ok) {
    nseData.warmSession().then(async () => {
      await updateNseCache();
      const niftySpot = nseCache?.data?.spotPrice || await getSpotPriceForIndex('NIFTY').catch(() => 24100);
      marketFeed.updateBasePrices({ NIFTY: niftySpot });
      if (nseCache?.data?.chain?.length) {
        marketFeed.seedStrikePrices(nseCache.data.chain, 'NIFTY');
      } else {
        const mockChain = generateOptionsChain(niftySpot, 31, 'NIFTY', Math.floor(Date.now() / 1000));
        marketFeed.seedStrikePrices(mockChain, 'NIFTY');
      }
      await updateSensexCache();
      if (sensexCache?.data?.chain?.length) {
        marketFeed.seedStrikePrices(sensexCache.data.chain, 'SENSEX');
      }
    });
  }
});
// Refresh cache every 15s
setInterval(async () => {
  if (!(await updateCacheFromUpstox())) {
    nseData.warmSession();
    await updateNseCache();
    const niftySpot = nseCache?.data?.spotPrice || await getSpotPriceForIndex('NIFTY').catch(() => 24100);
    marketFeed.updateBasePrices({ NIFTY: niftySpot });
    if (nseCache?.data?.chain?.length) {
      marketFeed.seedStrikePrices(nseCache.data.chain, 'NIFTY');
    } else {
      const mockChain = generateOptionsChain(niftySpot, 31, 'NIFTY', Math.floor(Date.now() / 1000));
      marketFeed.seedStrikePrices(mockChain, 'NIFTY');
    }
    await updateSensexCache();
    if (sensexCache?.data?.chain?.length) {
      marketFeed.seedStrikePrices(sensexCache.data.chain, 'SENSEX');
    }
  }
}, 5000);

app.get('/api/market-movers', async (req, res) => {
  try {
    const BATCH_SIZE = 10;
    const allQuotes = [];
    for (let i = 0; i < allIndianStocks.length; i += BATCH_SIZE) {
      const batch = allIndianStocks.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (stock) => {
          try {
            return await resolveQuote(stock.symbol);
          } catch {
            return null;
          }
        })
      );
      allQuotes.push(...results.filter(Boolean));
    }

    const valid = allQuotes.filter((q) => q.regularMarketPrice > 0);

    const gainers = [...valid]
      .filter((q) => q.regularMarketChangePercent > 0)
      .sort((a, b) => b.regularMarketChangePercent - a.regularMarketChangePercent)
      .slice(0, 5);

    const losers = [...valid]
      .filter((q) => q.regularMarketChangePercent < 0)
      .sort((a, b) => a.regularMarketChangePercent - b.regularMarketChangePercent)
      .slice(0, 5);

    const trending = [...valid]
      .sort((a, b) => b.regularMarketVolume - a.regularMarketVolume)
      .slice(0, 5);

    res.json({ gainers, losers, trending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== OPTIONS CHAIN WITH REAL-TIME DATA =====
function getIndexSymbol(index) {
  return index.toUpperCase() === 'SENSEX' ? '^BSESN' : '^NSEI';
}

async function getSpotPriceForIndex(index) {
  try {
    const quote = await resolveQuote(getIndexSymbol(index));
    return quote.regularMarketPrice || (index.toUpperCase() === 'SENSEX' ? 80000 : 24100);
  } catch {
    return index.toUpperCase() === 'SENSEX' ? 80000 : 24100;
  }
}

async function updateNseCache() {
  try {
    const spotPrice = await getSpotPriceForIndex('NIFTY');
    const result = await nseData.getNiftyOptionChain(spotPrice);
    if (result?.chain?.length) {
      nseCache = {
        data: {
          chain: result.chain,
          spotPrice: result.spotPrice || spotPrice,
          expiry: result.expiry || '',
          expiryTimestamp: result.expiryTimestamp || 0
        },
        timestamp: Date.now()
      };
      console.log('[NSE] Cache updated');
    }
  } catch (err) {
    console.log('[NSE] Cache update failed:', err.message);
  }
}

async function updateSensexCache() {
  try {
    const expiry = generateFallbackExpiries(8, 'SENSEX')[0];
    const sensexSpot = await getSpotPriceForIndex('SENSEX');
    const chain = generateOptionsChain(sensexSpot, 31, 'SENSEX', expiry.timestamp);
    sensexCache = {
      data: { chain, spotPrice: sensexSpot, expiry: expiry.date, expiryTimestamp: expiry.timestamp },
      timestamp: Date.now()
    };
  } catch (err) {
    console.log('[SENSEX] Cache update failed:', err.message);
  }
}

function generateFallbackExpiries(weeks = 8, index = 'NIFTY') {
  const now = new Date();
  const expiries = [];
  let d = new Date(now);
  const expiryDay = index.toUpperCase() === 'SENSEX' ? 4 : 2; // Sensex Thu, Nifty Tue
  while (d.getDay() !== expiryDay) d.setDate(d.getDate() + 1);
  for (let i = 0; i < weeks; i++) {
    const ts = Math.floor(d.getTime() / 1000);
    expiries.push({
      timestamp: ts,
      date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      label: d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    });
    d.setDate(d.getDate() + 7);
  }
  return expiries;
}

// Get available expiration dates (Upstox first, fallback to generated)
app.get('/api/options/expiries/:index', async (req, res) => {
  try {
    // Try per-user token first
    let userToken = null;
    if (req.userId) {
      const userTokens = await db.getUpstoxTokens(req.userId);
      if (userTokens && userTokens.accessToken) userToken = userTokens.accessToken;
    }
    const upstoxExpiries = await upstoxApi.getExpiryDates(req.params.index, userToken);
    if (upstoxExpiries && upstoxExpiries.length > 0) {
      return res.json(upstoxExpiries);
    }
  } catch (_) {}
  res.json(generateFallbackExpiries(8, req.params.index));
});

// Options Chain Endpoint (Upstox first, then cached NSE/mock fallback)
app.get('/api/options/chain/:index', async (req, res) => {
  try {
    const { index } = req.params;
    const idx = index.toUpperCase();
    const expiryTimestamp = req.query.expiry ? parseInt(req.query.expiry) : null;

    // Try per-user token first, fall back to system token
    let userToken = null;
    if (req.userId) {
      const userTokens = await db.getUpstoxTokens(req.userId);
      if (userTokens && userTokens.accessToken) userToken = userTokens.accessToken;
    }

    // Upstox real-time chain
    try {
      const tokenToUse = userToken || upstoxApi.getAccessToken();
      if (tokenToUse) {
        const upstoxData = await upstoxApi.getOptionsChain(index, expiryTimestamp, userToken);
        if (upstoxData && upstoxData.chain && upstoxData.chain.length > 0) {
          const fallbackExpiries = generateFallbackExpiries(8, idx);
          return res.json({
            index,
            spot: upstoxData.spotPrice,
            expiry: fallbackExpiries[0].date,
            expiryTimestamp: fallbackExpiries[0].timestamp,
            chain: upstoxData.chain,
            source: 'upstox'
          });
        }
      }
    } catch (err) {
      console.log('[Upstox] Chain endpoint error:', err.message);
      if (err.response?.data) console.log('[Upstox] API response:', JSON.stringify(err.response.data));
    }

    const spotPrice = await getSpotPriceForIndex(index);
    const fallbackExpiries = generateFallbackExpiries(8, idx);

    let expiry = fallbackExpiries[0].date;
    let resolvedExpiryTimestamp = fallbackExpiries[0].timestamp;
    if (expiryTimestamp) {
      const match = fallbackExpiries.find(e => e.timestamp === expiryTimestamp);
      if (match) {
        expiry = match.date;
        resolvedExpiryTimestamp = match.timestamp;
      }
    }

    if (idx === 'NIFTY' && nseCache) {
      return res.json({
        index,
        spot: nseCache.data.spotPrice || spotPrice,
        expiry: nseCache.data.expiry || expiry,
        expiryTimestamp: nseCache.data.expiryTimestamp || resolvedExpiryTimestamp,
        chain: JSON.parse(JSON.stringify(nseCache.data.chain)),
        source: 'nse'
      });
    }

    if (idx === 'SENSEX' && sensexCache) {
      return res.json({
        index,
        spot: sensexCache.data.spotPrice || spotPrice,
        expiry: sensexCache.data.expiry || expiry,
        expiryTimestamp: sensexCache.data.expiryTimestamp || resolvedExpiryTimestamp,
        chain: JSON.parse(JSON.stringify(sensexCache.data.chain)),
        source: 'mock'
      });
    }

    const chain = generateOptionsChain(spotPrice, 31, index, resolvedExpiryTimestamp);
    res.json({
      index,
      spot: spotPrice,
      expiry,
      expiryTimestamp: resolvedExpiryTimestamp,
      chain,
      source: 'mock'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to get options quote for specific strike
app.get('/api/options/quote/:index/:strike/:type', async (req, res) => {
  try {
    const { index, strike, type } = req.params;
    const strikeNum = parseFloat(strike);

    // Try per-user token first
    let userToken = null;
    if (req.userId) {
      const userTokens = await db.getUpstoxTokens(req.userId);
      if (userTokens && userTokens.accessToken) userToken = userTokens.accessToken;
    }

    // Upstox real-time quote
    try {
      const tokenToUse = userToken || upstoxApi.getAccessToken();
      if (tokenToUse) {
        const upstoxData = await upstoxApi.getOptionsChain(index, null, userToken);
        if (upstoxData && upstoxData.chain && upstoxData.chain.length > 0) {
          const strikeData = upstoxData.chain.find(s => s.strike === strikeNum);
          if (strikeData) {
            const optionData = type.toUpperCase() === 'CALL' || type.toUpperCase() === 'CE' ? strikeData.call : strikeData.put;
            return res.json({
              index,
              strike: strikeNum,
              type,
              spot: upstoxData.spotPrice,
              premium: optionData.ltp.toFixed(2),
              intrinsic: '0.00',
              timeValue: optionData.ltp.toFixed(2),
              iv: optionData.iv,
              oi: optionData.oi,
              volume: optionData.volume,
              bid: optionData.bid,
              ask: optionData.ask,
              source: 'upstox'
            });
          }
        }
      }
    } catch (_) {}
    
    const spotPrice = await getSpotPriceForIndex(index);
    
    const intrinsicValue = type.toUpperCase() === 'CALL' 
      ? Math.max(0, spotPrice - strikeNum)
      : Math.max(0, strikeNum - spotPrice);
    
    const timeValue = Math.random() * 50 + 20;
    const premium = intrinsicValue + timeValue;
    
    res.json({
      index,
      strike: strikeNum,
      type,
      spot: spotPrice,
      premium: premium.toFixed(2),
      intrinsic: intrinsicValue.toFixed(2),
      timeValue: timeValue.toFixed(2),
      iv: (15 + Math.random() * 15).toFixed(2),
      oi: Math.floor(Math.random() * 5000000) + 500000,
      volume: Math.floor(Math.random() * 100000) + 10000
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static client build
app.use(express.static(path.join(__dirname, '../client/dist')));

// SPA catch-all - serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api') && !req.path.startsWith('/auth')) {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  } else {
    res.status(404).json({ error: 'API route not found' });
  }
});

const PORT = process.env.PORT || 5000;
db.initSchema().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}).catch((err) => {
  console.error('[DB] Schema init failed:', err.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  marketFeed.stop();
  server.close(() => process.exit(0));
});
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  marketFeed.stop();
  server.close(() => process.exit(0));
});
