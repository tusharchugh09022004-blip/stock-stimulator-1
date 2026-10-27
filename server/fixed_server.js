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
console.log('[Google Auth] Client ID loaded:', process.env.GOOGLE_CLIENT_ID ? 'YES (length: ' + process.env.GOOGLE_CLIENT_ID.length + ')' : 'NO - MISSING');

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
  const credential = req.body.credential || req.body.token;
  console.log('[Google Auth] Received credential:', credential ? `YES (type: ${typeof credential}, length: ${credential.length})` : `NO - body keys: ${Object.keys(req.body || {})}`);
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
    console.error('[Google Auth] Verification failed:', err.message);
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

    // Set system-level token so background cache refresh works
    upstoxApi.setAccessToken(tokens.accessToken, tokens.refreshToken);

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
const quoteInFlight = new Map();
const CACHE_TTL = 120 * 1000; // Limit upstream requests while keeping a short-lived real quote cache.
const LIVE_QUOTE_MAX_AGE_MS = 5 * 60 * 1000;
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = 2;
let yahooRateLimitedUntil = 0;
const YAHOO_RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000;
const chartCache = new Map();
const chartInFlight = new Map();
const CHART_CACHE_TTL = 5 * 60 * 1000;
let activeChartRequests = 0;
const MAX_CONCURRENT_CHART_REQUESTS = 2;

function isYahooRateLimit(error) {
  return error?.response?.status === 429 || /\b429\b|too many requests|rate limit/i.test(error?.message || '');
}

function noteYahooRateLimit(error) {
  if (!isYahooRateLimit(error)) return;
  if (Date.now() >= yahooRateLimitedUntil) {
    yahooRateLimitedUntil = Date.now() + YAHOO_RATE_LIMIT_COOLDOWN_MS;
    console.warn('[Yahoo] Rate limit reached; pausing Yahoo requests for five minutes');
  }
}

function yahooCooldownError() {
  const seconds = Math.max(1, Math.ceil((yahooRateLimitedUntil - Date.now()) / 1000));
  return new Error(`Yahoo data temporarily unavailable after rate limiting; retry in ${seconds}s`);
}

async function waitForSlot() {
  while (activeRequests >= MAX_CONCURRENT_REQUESTS) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

async function waitForChartSlot() {
  while (activeChartRequests >= MAX_CONCURRENT_CHART_REQUESTS) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function getCachedQuote(symbol) {
  const cached = quoteCache.get(symbol);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
}

function setCachedQuote(symbol, data) {
  const timestamp = Date.now();
  const observedAt = normalizeQuoteTimestamp(data.observedAt) || new Date(timestamp).toISOString();
  const ageMs = timestamp - new Date(observedAt).getTime();
  const stale = !Number.isFinite(ageMs) || ageMs > LIVE_QUOTE_MAX_AGE_MS;
  const quote = { ...data, observedAt, dataStatus: stale ? 'stale' : 'available', stale };
  quoteCache.set(symbol, { data: quote, timestamp });
  db.saveMarketDataCache(`quote:${symbol}`, quote).catch(err => {
    console.warn(`[Cache] Could not persist quote ${symbol}: ${err.message}`);
  });
  return quote;
}

function normalizeQuoteTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'number') {
    const milliseconds = value < 1e12 ? value * 1000 : value;
    const parsed = new Date(milliseconds);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function getStaleQuote(symbol) {
  const inMemory = quoteCache.get(symbol);
  if (inMemory) {
    const observedAt = inMemory.data.observedAt || new Date(inMemory.timestamp).toISOString();
    const ageMs = Date.now() - new Date(observedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs <= 7 * 24 * 60 * 60 * 1000) {
      return { ...inMemory.data, observedAt, dataStatus: 'stale', stale: true };
    }
  }
  try {
    const stored = await db.getMarketDataCache(`quote:${symbol}`);
    if (!stored?.payload) return null;
    const observedAt = stored.payload.observedAt || stored.updated_at;
    const ageMs = Date.now() - new Date(observedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 7 * 24 * 60 * 60 * 1000) return null;
    const quote = { ...stored.payload, observedAt, dataStatus: 'stale', stale: true };
    quoteCache.set(symbol, { data: quote, timestamp: 0 });
    return quote;
  } catch (err) {
    console.warn(`[Cache] Could not read saved quote ${symbol}: ${err.message}`);
    return null;
  }
}

function canonicalMarketSymbol(symbol) {
  const value = String(symbol || '').trim();
  const aliases = { TATAMOTORS: 'TMPV', 'TATAMOTORS.NS': 'TMPV.NS', ZOMATO: 'ETERNAL', 'ZOMATO.NS': 'ETERNAL.NS' };
  return aliases[value.toUpperCase()] || value;
}

function normalizeYahooSymbol(symbol) {
  const query = canonicalMarketSymbol(symbol);
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

async function fetchQuoteDirect(symbol) {
  const query = encodeURIComponent(normalizeYahooSymbol(symbol));
  const response = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${query}`, {
    params: { range: '1d', interval: '1d' },
    timeout: 8000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  const result = response.data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) throw new Error('No live quote data returned');
  const quotes = result.indicators?.quote?.[0] || {};
  const previousClose = meta.chartPreviousClose || meta.previousClose;
  const price = meta.regularMarketPrice || quotes.close?.find(value => value != null);
  if (!(price > 0) || !(previousClose > 0)) throw new Error('Live quote is incomplete');
  return {
    symbol,
    yahooSymbol: meta.symbol,
    longName: meta.longName || meta.symbol,
    shortName: meta.shortName || meta.symbol,
    exchange: meta.exchangeName || '',
    regularMarketPrice: price,
    regularMarketChange: price - previousClose,
    regularMarketChangePercent: ((price - previousClose) / previousClose) * 100,
    regularMarketVolume: quotes.volume?.reduce((sum, value) => sum + (value || 0), 0) || 0,
    observedAt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString()
  };
}

async function resolveQuote(symbol) {
  const query = normalizeYahooSymbol(symbol);
  const cached = getCachedQuote(query);
  if (cached) return cached;
  const existing = quoteInFlight.get(query);
  if (existing) return existing;
  const request = resolveQuoteUncached(symbol, query);
  quoteInFlight.set(query, request);
  try {
    return await request;
  } finally {
    quoteInFlight.delete(query);
  }
}

async function resolveQuoteUncached(symbol, query) {
  try {
    const liveNseQuote = await nseData.getLiveQuote(query);
    if (liveNseQuote?.regularMarketPrice > 0) {
      const quote = { ...liveNseQuote, symbol: normalizeDisplaySymbol(query) };
      return setCachedQuote(query, quote);
    }
  } catch (err) {
    console.warn(`[NSE] Live quote unavailable for ${symbol}: ${err.message}`);
  }

  await waitForSlot();
  activeRequests++;
  let providerError;
  try {
    try {
      if (Date.now() < yahooRateLimitedUntil) throw yahooCooldownError();
      const yahooFinance = await getYahooFinance();
      const result = await Promise.race([
        yahooFinance.quote(query),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Yahoo quote timed out')), 12000))
      ]);
      if (!(result?.regularMarketPrice > 0)) throw new Error('Yahoo returned no live price');
      const quote = {
        symbol: normalizeDisplaySymbol(query),
        yahooSymbol: result.symbol,
        longName: result.longName,
        shortName: result.shortName,
        exchange: result.exchange,
        regularMarketPrice: result.regularMarketPrice,
        regularMarketChange: result.regularMarketChange,
        regularMarketChangePercent: result.regularMarketChangePercent,
        regularMarketVolume: result.regularMarketVolume,
        observedAt: result.regularMarketTime ? new Date(result.regularMarketTime).toISOString() : new Date().toISOString()
      };
      return setCachedQuote(query, quote);
    } catch (err) {
      providerError = err;
      noteYahooRateLimit(err);
      if (!isYahooRateLimit(err) && Date.now() >= yahooRateLimitedUntil) {
        console.error('yahoo-finance2 failed for', symbol, err.message);
      }
    }
  } finally {
    activeRequests--;
  }

  if (Date.now() < yahooRateLimitedUntil) {
    const staleQuote = await getStaleQuote(query);
    if (staleQuote) {
      console.warn(`[Market] Serving last saved quote for ${symbol} from ${staleQuote.observedAt}`);
      return { ...staleQuote, symbol: normalizeDisplaySymbol(query) };
    }
    throw yahooCooldownError();
  }

  try {
    const quote = await fetchQuoteDirect(query);
    quote.symbol = normalizeDisplaySymbol(query);
    return setCachedQuote(query, quote);
  } catch (err) {
    noteYahooRateLimit(err);
    if (!isYahooRateLimit(err)) console.error('Direct Yahoo quote failed for', symbol, err.message);
    const staleQuote = await getStaleQuote(query);
    if (staleQuote) {
      console.warn(`[Market] Serving last saved quote for ${symbol} from ${staleQuote.observedAt}`);
      return { ...staleQuote, symbol: normalizeDisplaySymbol(query) };
    }
    throw new Error(`Live quote unavailable for ${symbol}: ${err.message || providerError?.message}`);
  }
}

async function fetchChartSeries(symbol, range = '1d') {
  const cacheKey = `${normalizeYahooSymbol(symbol)}:${range}`;
  const cached = chartCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CHART_CACHE_TTL) {
    return cached.data;
  }

  const existingRequest = chartInFlight.get(cacheKey);
  if (existingRequest) return existingRequest;

  const request = fetchChartSeriesUncached(symbol, range)
    .then(data => {
      data.dataStatus = 'available';
      data.observedAt = new Date().toISOString();
      chartCache.set(cacheKey, { data, timestamp: Date.now() });
      db.saveMarketDataCache(`chart:${cacheKey}`, data).catch(err => {
        console.warn(`[Cache] Could not persist chart ${cacheKey}: ${err.message}`);
      });
      if (chartCache.size > 500) chartCache.delete(chartCache.keys().next().value);
      return data;
    })
    .catch(async err => {
      const memoryCache = chartCache.get(cacheKey)?.data;
      let stale = memoryCache || null;
      if (!stale) {
        try {
          const stored = await db.getMarketDataCache(`chart:${cacheKey}`);
          stale = stored?.payload || null;
        } catch (cacheErr) {
          console.warn(`[Cache] Could not read saved chart ${cacheKey}: ${cacheErr.message}`);
        }
      }
      const ageMs = stale?.observedAt ? Date.now() - new Date(stale.observedAt).getTime() : Infinity;
      if (stale?.points?.length && ageMs <= 30 * 24 * 60 * 60 * 1000) {
        const staleResponse = { ...stale, dataStatus: 'stale', stale: true };
        chartCache.set(cacheKey, { data: staleResponse, timestamp: 0 });
        console.warn(`[Market] Serving last saved chart for ${symbol} from ${stale.observedAt}`);
        return staleResponse;
      }
      throw err;
    })
    .finally(() => chartInFlight.delete(cacheKey));

  chartInFlight.set(cacheKey, request);
  return request;
}

async function fetchChartSeriesUncached(symbol, range = '1d') {
  try {
    if (Date.now() < yahooRateLimitedUntil) throw yahooCooldownError();
    const query = normalizeYahooSymbol(symbol);
    const { yahooRange, interval } = getChartRangeConfig(range);
    
    // Chart traffic has its own limiter so quote refreshes cannot hold charts open.
    await waitForChartSlot();
    activeChartRequests++;
    
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
      
      if (!timestamps.length) throw new Error(`No live chart data returned for ${symbol}`);

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
      noteYahooRateLimit(err);
      if (!isYahooRateLimit(err)) console.error('Yahoo chart request failed for', symbol, err.message);
      throw err;
    } finally {
      activeChartRequests--;
    }
  } catch (err) {
    console.error('Error fetching chart for', symbol, err.message);
    throw err;
  }
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
        console.warn(`Watchlist quote unavailable for ${item.symbol}: ${err.message}`);
        return null;
      }
    })
  );
}

app.get('/api/quote/:symbol', async (req, res) => {
  try {
    const quote = await resolveQuote(req.params.symbol);
    res.json(quote);
  } catch (err) {
    res.status(503).json({ error: 'Live quote unavailable', detail: err.message });
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
  { symbol: 'TMPV', name: 'Tata Motors Passenger Vehicles Ltd' },
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
  { symbol: 'ETERNAL', name: 'Eternal Ltd' },
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
    res.status(503).json({ error: 'Live chart data unavailable', detail: err.message });
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
    const enriched = (await enrichWatchlist(userData.watchlist || [])).filter(Boolean);
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

    const enriched = (await enrichWatchlist(nextWatchlist)).filter(Boolean);
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
    const nextWatchlist = (userData.watchlist || []).filter((item) => item.symbol !== symbol);
    // Save to database
    await db.removeFromWatchlist(userId, symbol);

    const enriched = (await enrichWatchlist(nextWatchlist)).filter(Boolean);
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
  if (Date.now() < yahooRateLimitedUntil) return;
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
    }
    if (sensexData?.chain?.length) {
      sensexCache = { data: sensexData, timestamp: Date.now() };
    }
    return !!(niftyData?.chain?.length || sensexData?.chain?.length);
  } catch (_) { return false; }
}

// Warm the NSE session and populate cache
updateCacheFromUpstox().then(ok => {
  if (!ok) {
    nseData.warmSession().then(async () => {
      await updateNseCache();
    });
  }
});
// Refresh live option data once a minute
setInterval(async () => {
  if (!(await updateCacheFromUpstox())) {
    nseData.warmSession();
    await updateNseCache();
  }
}, 60000);

// Auto-refresh per-user Upstox tokens every 5 minutes
setInterval(async () => {
  try {
    const users = await db.getAllUsersWithUpstoxTokens();
    const REFRESH_WINDOW = 10 * 60 * 1000; // refresh if expiring within 10 minutes

    for (const user of users) {
      const needsRefresh = !user.expiry || (user.expiry - Date.now()) < REFRESH_WINDOW;
      if (!needsRefresh) continue;

      try {
        const newTokens = await upstoxApi.refreshUserToken(user.refreshToken);
        await db.saveUpstoxTokens(user.userId, newTokens.accessToken, newTokens.refreshToken, newTokens.expiry);
        console.log(`[Upstox] Auto-refreshed token for user ${user.userId}`);
      } catch (err) {
        console.error(`[Upstox] Auto-refresh failed for user ${user.userId}:`, err.response?.data?.message || err.message);
        await db.clearUpstoxTokens(user.userId);
        console.log(`[Upstox] Cleared expired tokens for user ${user.userId}`);
      }
    }
  } catch (err) {
    console.error('[Upstox] Token refresh scheduler error:', err.message);
  }
}, 5 * 60 * 1000);

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
    if (!quote.regularMarketPrice) throw new Error(`No live spot price for ${index}`);
    return quote.regularMarketPrice;
  } catch (err) {
    throw new Error(`Live spot price unavailable for ${index}: ${err.message}`);
  }
}

async function updateNseCache() {
  try {
    const result = await nseData.getNiftyOptionChain();
    if (result?.chain?.length && result.spotPrice > 0) {
      nseCache = {
        data: {
          chain: result.chain,
          spotPrice: result.spotPrice,
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

// Get available expiration dates from Upstox
app.get('/api/options/expiries/:index', async (req, res) => {
  let error;
  try {
    let userToken = null;
    if (req.userId) {
      const userTokens = await db.getUpstoxTokens(req.userId);
      if (userTokens?.accessToken) userToken = userTokens.accessToken;
    }
    const expiries = await upstoxApi.getExpiryDates(req.params.index, userToken);
    if (expiries?.length) return res.json(expiries);
  } catch (err) {
    error = err;
  }

  if (req.params.index.toUpperCase() === 'NIFTY') {
    const nseExpiries = await nseData.getNiftyExpiries();
    if (nseExpiries?.length) return res.json(nseExpiries);
  }
  return res.status(503).json({ error: 'Live option expiries unavailable', detail: error?.message });
});

// Options Chain Endpoint (authenticated Upstox, or fresh NSE data for NIFTY)
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
          const expiry = upstoxData.expiry || '';
          return res.json({
            index,
            spot: upstoxData.spotPrice,
            expiry,
            chain: upstoxData.chain,
            source: 'upstox'
          });
        }
      }
    } catch (err) {
      console.log('[Upstox] Chain endpoint error:', err.message);
      if (err.response?.data) console.log('[Upstox] API response:', JSON.stringify(err.response.data));
    }

    if (idx === 'NIFTY' && nseCache?.data?.chain?.length && Date.now() - nseCache.timestamp < 30000) {
      return res.json({
        index,
        spot: nseCache.data.spotPrice,
        expiry: nseCache.data.expiry,
        expiryTimestamp: nseCache.data.expiryTimestamp,
        chain: JSON.parse(JSON.stringify(nseCache.data.chain)),
        source: 'nse'
      });
    }
    return res.status(503).json({ error: `Live ${idx} option chain unavailable` });
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
    
    return res.status(503).json({ error: 'Live option quote unavailable' });
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
