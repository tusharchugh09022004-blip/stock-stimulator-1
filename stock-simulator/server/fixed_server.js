const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

// Database module
const db = require('./db.js');

const app = express();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const server = http.createServer(app);
io = socketIo(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors({ origin: '*' })); 
app.use(express.json());

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
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  
  const user = db.createUser(username, password);
  
  if (!user) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  
  const token = generateToken(user.userId);
  res.json({
    userId: user.userId,
    username: user.username,
    balance: user.balance,
    token
  });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  
  const user = db.verifyUser(username, password);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  
  const token = generateToken(user.userId);
  db.saveLoginHistory(
    user.userId,
    user.username,
    'login_password',
    getClientIp(req),
    req.headers['user-agent']
  );

  res.json({
    userId: user.userId,
    username: user.username,
    balance: user.balance,
    token
  });
});

app.post('/api/auth/logout', (req, res) => {
  // Logout is typically handled on the client by deleting the token
  res.json({ message: 'Logged out successfully' });
});

// Google Sign-Up/Login with JWT token verification
app.post('/api/auth/google-token', async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({ error: 'Google token is required' });
  }

  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Google authentication is not configured on server' });
  }

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    const payload = ticket.getPayload();

    if (!payload?.email || !payload?.email_verified) {
      return res.status(400).json({ error: 'Google account email is not verified' });
    }

    const googleEmail = String(payload.email).toLowerCase().trim();
    let user = db.getUserByUsername(googleEmail);

    if (!user) {
      // Use a random secret so password login cannot be guessed for OAuth-created accounts.
      const randomPassword = crypto.randomBytes(32).toString('hex');
      const createdUser = db.createUser(googleEmail, randomPassword);
      if (!createdUser) {
        return res.status(400).json({ error: 'Email already registered with a different method' });
      }
      user = db.getUserById(createdUser.userId);
    }

    if (!user) {
      return res.status(500).json({ error: 'Failed to complete Google login' });
    }

    const jwtToken = generateToken(user.userId);
    db.saveLoginHistory(
      user.userId,
      user.username,
      'login_google',
      getClientIp(req),
      req.headers['user-agent']
    );

    res.json({
      userId: user.userId,
      username: user.username,
      balance: user.balance,
      token: jwtToken
    });
  } catch (err) {
    console.error('Google token verification error:', err.message);
    res.status(400).json({ error: 'Invalid Google token' });
  }
});

app.get('/api/auth/user', verifyToken, (req, res) => {
  const user = db.getUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

app.get('/api/auth/login-history', verifyToken, (req, res) => {
  try {
    const limit = parseInt(req.query.limit, 10) || 50;
    const history = db.getLoginHistory(req.userId, limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch login history' });
  }
});

// Admin endpoint to view all login history
app.get('/api/admin/all-login-history', verifyToken, (req, res) => {
  try {
    // Check if user is admin
    const isAdmin = db.getUserAdminStatus(req.userId);
    if (!isAdmin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const limit = parseInt(req.query.limit, 10) || 100;
    const allHistory = db.getAllLoginHistory(limit);
    res.json(allHistory);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch login history' });
  }
});

// Endpoint to set user as admin (temporary - for initial setup)
app.post('/api/admin/set-admin', verifyToken, (req, res) => {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Username required' });
    }

    const user = db.getUserByUsername(username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    db.setAdminStatus(user.userId, true);
    res.json({ message: `${username} is now an admin` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to set admin status' });
  }
});

const yahooClient = axios.create({
  timeout: 12000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*'
  }
});

const DEFAULT_BALANCE = 10000000;
const YAHOO_SEARCH_URL = 'https://query2.finance.yahoo.com/v1/finance/search';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

const RANGE_CONFIG = {
  '1d': { range: '1d', interval: '5m' },
  '1w': { range: '5d', interval: '30m' },
  '1m': { range: '1mo', interval: '1d' },
  '3m': { range: '3mo', interval: '1d' },
  '1y': { range: '1y', interval: '1wk' }
};

const allIndianStocks = [
  { symbol: 'HDFCBANK', name: 'HDFC Bank' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank' },
  { symbol: 'SBIN', name: 'State Bank of India' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank' },
  { symbol: 'AXISBANK', name: 'Axis Bank' },
  { symbol: 'INDUSIND', name: 'IndusInd Bank' },
  { symbol: 'FEDERALBANK', name: 'Federal Bank' },
  { symbol: 'YESBANK', name: 'Yes Bank' },
  { symbol: 'BANKBARODA', name: 'Bank of Baroda' },
  { symbol: 'IDFCFIRSTB', name: 'IDFC FIRST Bank' },
  { symbol: 'AUBANK', name: 'AU Small Finance Bank' },
  { symbol: 'BANDHANBNK', name: 'Bandhan Bank' },
  { symbol: 'RBLBANK', name: 'RBL Bank' },
  { symbol: 'TCS', name: 'Tata Consultancy Services' },
  { symbol: 'INFY', name: 'Infosys' },
  { symbol: 'HCLTECH', name: 'HCL Technologies' },
  { symbol: 'TECHM', name: 'Tech Mahindra' },
  { symbol: 'WIPRO', name: 'Wipro' },
  { symbol: 'PERSISTENT', name: 'Persistent Systems' },
  { symbol: 'LTIM', name: 'LTIMindtree' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors' },
  { symbol: 'M&M', name: 'Mahindra & Mahindra' },
  { symbol: 'EICHERMOT', name: 'Eicher Motors' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp' },
  { symbol: 'RELIANCE', name: 'Reliance Industries' },
  { symbol: 'POWERGRID', name: 'Power Grid' },
  { symbol: 'NTPC', name: 'NTPC' },
  { symbol: 'ONGC', name: 'ONGC' },
  { symbol: 'COALINDIA', name: 'Coal India' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises' },
  { symbol: 'ADANIPOWER', name: 'Adani Power' },
  { symbol: 'TATAPOWER', name: 'Tata Power' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement' },
  { symbol: 'SHREECEM', name: 'Shree Cement' },
  { symbol: 'AMBUJACEM', name: 'Ambuja Cements' },
  { symbol: 'ACC', name: 'ACC' },
  { symbol: 'JSWSTEEL', name: 'JSW Steel' },
  { symbol: 'HINDALCO', name: 'Hindalco' },
  { symbol: 'TATASTEEL', name: 'Tata Steel' },
  { symbol: 'VEDL', name: 'Vedanta' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharma' },
  { symbol: 'CIPLA', name: 'Cipla' },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals' },
  { symbol: 'DRREDDY', name: "Dr Reddy's Laboratories" },
  { symbol: 'LUPIN', name: 'Lupin' },
  { symbol: 'DIVISLAB', name: "Divi's Laboratories" },
  { symbol: 'ZYDUSLIFE', name: 'Zydus Life' },
  { symbol: 'ITC', name: 'ITC' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever' },
  { symbol: 'NESTLEIND', name: 'Nestle India' },
  { symbol: 'BRITANNIA', name: 'Britannia' },
  { symbol: 'MARICO', name: 'Marico' },
  { symbol: 'DABUR', name: 'Dabur' },
  { symbol: 'TITAN', name: 'Titan Company' },
  { symbol: 'DMART', name: 'Avenue Supermarts' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel' },
  { symbol: 'IDEA', name: 'Vodafone Idea' },
  { symbol: 'ZEEL', name: 'Zee Entertainment' },
  { symbol: 'IRCTC', name: 'IRCTC' },
  { symbol: 'RVNL', name: 'Rail Vikas Nigam' },
  { symbol: 'BEL', name: 'Bharat Electronics' },
  { symbol: 'HAL', name: 'Hindustan Aeronautics' },
  { symbol: 'BHEL', name: 'Bharat Heavy Electricals' },
  { symbol: 'DLF', name: 'DLF' },
  { symbol: 'LODHA', name: 'Macrotech Developers' },
  { symbol: 'GRASIM', name: 'Grasim Industries' },
  { symbol: 'PIDILITIND', name: 'Pidilite Industries' }
];

function sanitizeQuery(value = '') {
  return String(value).trim().toUpperCase();
}

function normalizeDisplaySymbol(symbol = '') {
  return sanitizeQuery(symbol).replace(/\.(NS|BO)$/i, '');
}

function buildSymbolCandidates(query) {
  const raw = sanitizeQuery(query);
  if (!raw) return [];
  if (raw.endsWith('.NS') || raw.endsWith('.BO')) return [raw];
  return [`${raw}.NS`, `${raw}.BO`, raw];
}

function isIndianMarketEntry(entry = {}) {
  const source = [
    entry.symbol,
    entry.exchange,
    entry.exchangeDisp,
    entry.exchangeDisplay,
    entry.fullExchangeName,
    entry.exchDisp
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase();

  return source.includes('.NS') || source.includes('NSE') || source.includes('NSI') || source.includes('.BO') || source.includes('BSE') || source.includes('BOM');
}

function uniqueBy(items, keyBuilder) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyBuilder(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatChartLabel(timestamp, rangeKey) {
  const date = new Date(timestamp * 1000);

  if (rangeKey === '1d') {
    return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  if (rangeKey === '1w') {
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit' }).format(date);
  }

  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: rangeKey === '1y' ? '2-digit' : undefined }).format(date);
}

function mapQuote(result, fallbackName = '') {
  const marketPrice = Number(result.regularMarketPrice ?? result.postMarketPrice ?? result.bid ?? 0);
  const previousClose = Number(result.regularMarketPreviousClose ?? result.previousClose ?? result.regularMarketOpen ?? 0);
  const explicitChange = result.regularMarketChange;
  const computedChange = previousClose ? marketPrice - previousClose : 0;
  const change = Number(explicitChange ?? computedChange ?? 0);
  const explicitChangePercent = result.regularMarketChangePercent;
  const computedChangePercent = previousClose ? (change / previousClose) * 100 : 0;

  return {
    symbol: normalizeDisplaySymbol(result.symbol || ''),
    yahooSymbol: result.symbol || '',
    shortName: result.shortName || result.longName || fallbackName || normalizeDisplaySymbol(result.symbol || ''),
    longName: result.longName || result.shortName || fallbackName || normalizeDisplaySymbol(result.symbol || ''),
    exchange: result.fullExchangeName || result.exchangeDisp || result.exchange || '',
    currency: result.currency || 'INR',
    regularMarketPrice: marketPrice,
    regularMarketChange: Number(change.toFixed(2)),
    regularMarketChangePercent: Number((explicitChangePercent ?? computedChangePercent ?? 0).toFixed(2)),
    regularMarketPreviousClose: previousClose,
    regularMarketOpen: Number(result.regularMarketOpen ?? 0),
    regularMarketDayHigh: Number(result.regularMarketDayHigh ?? marketPrice ?? 0),
    regularMarketDayLow: Number(result.regularMarketDayLow ?? marketPrice ?? 0),
    regularMarketVolume: Number(result.regularMarketVolume ?? 0),
    regularMarketTime: result.regularMarketTime || null
  };
}

async function searchYahoo(query) {
  const response = await yahooClient.get(YAHOO_SEARCH_URL, {
    params: {
      q: query,
      quotesCount: 15,
      newsCount: 0,
      listsCount: 0,
      enableFuzzyQuery: true,
      lang: 'en-IN',
      region: 'IN'
    }
  });

  return response.data?.quotes || [];
}

async function fetchChartMetaQuote(symbol, fallbackName = '') {
  const response = await yahooClient.get(`${YAHOO_CHART_URL}/${encodeURIComponent(symbol)}`, {
    params: {
      range: '1d',
      interval: '5m',
      includePrePost: false,
      events: 'div,splits',
      lang: 'en-IN',
      region: 'IN'
    }
  });

  const result = response.data?.chart?.result?.[0];
  const error = response.data?.chart?.error;

  if (!result?.meta) {
    throw new Error(error?.description || `Quote unavailable for ${symbol}`);
  }

  const meta = result.meta;
  return mapQuote(
    {
      symbol: meta.symbol || symbol,
      shortName: meta.shortName,
      longName: meta.longName,
      fullExchangeName: meta.fullExchangeName || meta.exchangeName,
      exchange: meta.exchangeName,
      currency: meta.currency,
      regularMarketPrice: meta.regularMarketPrice,
      regularMarketPreviousClose: meta.chartPreviousClose ?? meta.previousClose,
      regularMarketOpen: meta.regularMarketOpen,
      regularMarketDayHigh: meta.regularMarketDayHigh,
      regularMarketDayLow: meta.regularMarketDayLow,
      regularMarketVolume: meta.regularMarketVolume,
      regularMarketTime: meta.regularMarketTime
    },
    fallbackName
  );
}

function rankIndianSearchResults(results, query) {
  const raw = sanitizeQuery(query);

  return uniqueBy(
    results
      .filter((item) => isIndianMarketEntry(item) || allIndianStocks.some((stock) => stock.symbol === normalizeDisplaySymbol(item.symbol || '')))
      .map((item) => ({
        symbol: normalizeDisplaySymbol(item.symbol || ''),
        yahooSymbol: item.symbol || '',
        name: item.shortname || item.longname || item.symbol || '',
        exchange: item.exchDisp || item.exchangeDisp || item.exchange || '',
        type: item.quoteType || '',
        score: item.score || 0
      }))
      .sort((a, b) => {
        const aExact = a.symbol === raw ? 2 : a.name.toUpperCase() === raw ? 1 : 0;
        const bExact = b.symbol === raw ? 2 : b.name.toUpperCase() === raw ? 1 : 0;
        if (aExact !== bExact) return bExact - aExact;
        return (b.score || 0) - (a.score || 0);
      }),
    (item) => item.yahooSymbol || item.symbol
  );
}

async function resolveQuote(query) {
  const raw = sanitizeQuery(query);
  if (!raw) throw new Error('Stock symbol is required');

  // Handle indices specially (they start with ^)
  if (raw.startsWith('^')) {
    try {
      const quote = await fetchChartMetaQuote(raw);
      return quote;
    } catch (err) {
      throw new Error(`Unable to find index "${query}"`);
    }
  }

  const localMatches = allIndianStocks.filter((stock) => stock.symbol.includes(raw) || stock.name.toUpperCase().includes(raw));
  const searchMatches = rankIndianSearchResults(await searchYahoo(raw).catch(() => []), raw);
  const candidateSymbols = [
    ...buildSymbolCandidates(raw),
    ...localMatches.flatMap((item) => buildSymbolCandidates(item.symbol))
    ,
    ...searchMatches.map((item) => item.yahooSymbol)
  ].filter(Boolean);

  const tried = new Set();
  for (const candidate of candidateSymbols) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);

    try {
      const localName = localMatches.find((item) => candidate.startsWith(item.symbol))?.name;
      const quote = await fetchChartMetaQuote(candidate, localName);
      if (isIndianMarketEntry({ symbol: quote.yahooSymbol, exchange: quote.exchange })) {
        return quote;
      }
    } catch (err) {
      continue;
    }
  }

  throw new Error(`Unable to find an Indian market symbol for "${query}"`);
}

async function fetchChartSeries(query, rangeKey = '1d') {
  const resolvedQuote = await resolveQuote(query);
  const config = RANGE_CONFIG[rangeKey] || RANGE_CONFIG['1d'];

  const response = await yahooClient.get(`${YAHOO_CHART_URL}/${encodeURIComponent(resolvedQuote.yahooSymbol)}`, {
    params: {
      range: config.range,
      interval: config.interval,
      includePrePost: false,
      events: 'div,splits',
      lang: 'en-IN',
      region: 'IN'
    }
  });

  const result = response.data?.chart?.result?.[0];
  const error = response.data?.chart?.error;

  if (!result) {
    throw new Error(error?.description || 'Chart data unavailable');
  }

  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};

  const points = timestamps
    .map((timestamp, index) => {
      const close = quote.close?.[index];
      if (close == null) return null;

      const open = quote.open?.[index] ?? close;
      const high = quote.high?.[index] ?? close;
      const low = quote.low?.[index] ?? close;
      const volume = quote.volume?.[index] ?? 0;

      return {
        timestamp,
        label: formatChartLabel(timestamp, rangeKey),
        open: Number(open.toFixed(2)),
        high: Number(high.toFixed(2)),
        low: Number(low.toFixed(2)),
        close: Number(close.toFixed(2)),
        volume: Number(volume)
      };
    })
    .filter(Boolean);

  const highs = points.map((point) => point.high);
  const lows = points.map((point) => point.low);
  const latestPoint = points[points.length - 1];
  const firstPoint = points[0];

  return {
    symbol: resolvedQuote.symbol,
    yahooSymbol: resolvedQuote.yahooSymbol,
    range: rangeKey,
    interval: config.interval,
    currency: meta.currency || resolvedQuote.currency || 'INR',
    exchange: meta.exchangeName || resolvedQuote.exchange,
    previousClose: Number(meta.chartPreviousClose ?? resolvedQuote.regularMarketPreviousClose ?? 0),
    currentPrice: Number(meta.regularMarketPrice ?? latestPoint?.close ?? resolvedQuote.regularMarketPrice ?? 0),
    changePercent: Number(meta.regularMarketPrice && meta.chartPreviousClose ? (((meta.regularMarketPrice - meta.chartPreviousClose) / meta.chartPreviousClose) * 100).toFixed(2) : resolvedQuote.regularMarketChangePercent),
    stats: {
      open: Number(firstPoint?.open ?? 0),
      high: Number((highs.length ? Math.max(...highs) : 0).toFixed(2)),
      low: Number((lows.length ? Math.min(...lows) : 0).toFixed(2)),
      lastClose: Number(latestPoint?.close ?? 0)
    },
    points
  };
}

function getUserData(userId = 'default') {
  const user = db.getUser(userId) || { balance: 10000000 };
  const portfolio = db.getPortfolio(userId);
  const watchlist = db.getWatchlist(userId);

  return {
    balance: user.balance,
    portfolio,
    watchlist
  };
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
    res.status(404).json({ error: err.message });
  }
});

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
    // Allow users to only access their own watchlist or if userId matches
    if (req.params.userId !== 'default' && req.params.userId !== req.userId) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    const userId = req.userId;
    const userData = getUserData(userId);
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
    const userData = getUserData(userId);
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
      db.addToWatchlist(userId, quote.symbol, quote.yahooSymbol, quote.longName || quote.shortName || quote.symbol, quote.exchange);
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
    
    const userData = getUserData(userId);
    const normalizedSymbol = normalizeDisplaySymbol(symbol);
    const nextWatchlist = (userData.watchlist || []).filter((item) => item.symbol !== normalizedSymbol);
    // Save to database
    db.removeFromWatchlist(userId, normalizedSymbol);

    const enriched = await enrichWatchlist(nextWatchlist);
    io.emit('watchlistUpdate', { userId, watchlist: enriched });
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/trade', verifyToken, (req, res) => {
  const { symbol, action, qty, price } = req.body;
  const userId = req.userId;
  const parsedQty = Number(qty);
  const parsedPrice = Number(price);

  if (!symbol || !Number.isFinite(parsedQty) || parsedQty <= 0 || !Number.isFinite(parsedPrice) || parsedPrice <= 0) {
    return res.status(400).json({ error: 'Invalid trade payload' });
  }

  const userData = getUserData(userId);
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
    db.updatePortfolio(userId, symbol, userData.portfolio[symbol].qty, userData.portfolio[symbol].avgPrice);
  } else if (action === 'sell') {
    if (!userData.portfolio[symbol] || userData.portfolio[symbol].qty < parsedQty) {
      return res.status(400).json({ error: 'Insufficient shares' });
    }

    userData.balance += totalCost;
    userData.portfolio[symbol].qty -= parsedQty;
    
    // Persist sell to database
    if (userData.portfolio[symbol].qty <= 0) {
      // Complete position closure
      db.clearPortfolioPosition(userId, symbol);
      delete userData.portfolio[symbol];
    } else {
      // Partial sell - update with remaining qty
      db.updatePortfolio(userId, symbol, userData.portfolio[symbol].qty, userData.portfolio[symbol].avgPrice);
    }
  } else {
    return res.status(400).json({ error: 'Unsupported trade action' });
  }

  // Save balance to database
  db.updateUserBalance(userId, userData.balance);
  
  // Save order to history
  db.saveOrder(userId, symbol, `${symbol}.NS`, action, parsedQty, parsedPrice, totalCost);
  
  io.emit('userUpdate', { userId, ...userData });
  res.json(userData);
});

app.get('/api/portfolio/:userId', verifyToken, async (req, res) => {
  const { userId } = req.params;
  
  // Verify user can only access their own portfolio or if userId matches
  if (userId !== 'default' && userId !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const actualUserId = req.userId;
  const userData = getUserData(actualUserId);
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
      currentPrice,
      pnl,
      pnlPercent: position.avgPrice ? ((currentPrice / position.avgPrice - 1) * 100) : 0,
      dayChange: quote?.regularMarketChange || 0,
      dayChangePercent: quote?.regularMarketChangePercent || 0
    };
  });

res.json({ ...userData, portfolio: enrichedPortfolio });
});

app.get('/api/orders/:userId', verifyToken, (req, res) => {
  const { userId } = req.params;
  
  // Verify user can only access their own orders
  if (userId !== req.userId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const limit = parseInt(req.query.limit) || 50;
  const orders = db.getOrderHistory(userId, limit);
  res.json(orders);
});

// Delete/cancel order and reverse the trade
app.delete('/api/orders/:orderId', verifyToken, (req, res) => {
  const { orderId } = req.params;
  const userId = req.userId;
  
  // Get the order first to verify it belongs to the user
  const orders = db.getOrderHistory(userId, 999);
  const order = orders.find(o => o.id == orderId);
  
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  // Just delete the order record - do NOT reverse the trade
  // Portfolio state is the source of truth, not order history
  const result = db.deleteOrderHistoryRecord(orderId, userId);
  
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Order not found' });
  }
  
  res.json({ success: true, message: 'Order record deleted' });
});

// Delete/cancel all orders and reverse trades
app.delete('/api/orders/user/:userId/all', verifyToken, (req, res) => {
  try {
    // Only allow users to clear their own history
    if (req.params.userId !== req.userId && req.params.userId !== 'default') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const userId = req.userId;
    
    const result = db.deleteAllOrders(userId);
    
    // Return updated user data after deletion
    const userData = getUserData(userId);
    io.emit('userUpdate', { userId, ...userData });
    res.json({ success: true, message: `Cleared ${result.changes} orders` });
  } catch (err) {
    console.error('Clear all orders error:', err);
    res.status(500).json({ error: err.message || 'Failed to clear orders' });
  }
});

// Get user profile
app.get('/api/user/profile', verifyToken, (req, res) => {
  const user = db.getUserById(req.userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  res.json(user);
});

// Update user balance (add or set)
app.put('/api/user/balance', verifyToken, (req, res) => {
  try {
    const { balance, add } = req.body;
    const userId = req.userId;
    
    const user = db.getUser(userId);
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
    
    db.updateUserBalance(userId, newBalance);
    
    const updatedUser = db.getUser(userId);
    io.emit('userUpdate', { userId, balance: updatedUser.balance });
    res.json({ success: true, balance: updatedUser.balance });
  } catch (err) {
    console.error('Balance update error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

setInterval(async () => {
  try {
    const sampleQuote = await resolveQuote('RELIANCE');
    io.emit('stockUpdate', sampleQuote);
  } catch (err) {
    console.error('Realtime quote broadcast failed:', err.message);
  }
}, 30000);

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.emit('initData', getUserData());

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

app.get('/api/market-movers', async (req, res) => {
  try {
    const sample = allIndianStocks.slice(0, 35);
    const quotes = await Promise.all(
      sample.map(async (stock) => {
        try {
          return await resolveQuote(stock.symbol);
        } catch {
          return null;
        }
      })
    );

    const valid = quotes.filter(Boolean).filter((q) => q.regularMarketPrice > 0);

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

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

