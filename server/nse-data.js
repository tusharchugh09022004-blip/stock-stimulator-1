const axios = require('axios');

const NSE_HOME = 'https://www.nseindia.com';
const NSE_OPTION_CHAIN = 'https://www.nseindia.com/api/option-chain-v3';

let axiosInstance = null;
let lastRefresh = 0;
let sessionReady = false;
let sessionPromise = null;
let sessionRetryAfter = 0;
let nifty50QuoteCache = new Map();
let nifty50QuoteCacheAt = 0;
let nifty50QuoteRequest = null;
let indicesQuoteCache = null;
let indicesQuoteCacheAt = 0;

function getNextTuesday() {
  const d = new Date();
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
  return d;
}

function formatNseDate(date) {
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const dd = String(date.getDate()).padStart(2, '0');
  return `${dd}-${months[date.getMonth()]}-${date.getFullYear()}`;
}

function parseNseDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const months = { 'JAN':0,'FEB':1,'MAR':2,'APR':3,'MAY':4,'JUN':5,'JUL':6,'AUG':7,'SEP':8,'OCT':9,'NOV':10,'DEC':11 };
  const month = months[parts[1]?.toUpperCase()];
  if (month === undefined) return null;
  return new Date(parseInt(parts[2]), month, parseInt(parts[0]));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function normalizeObservationTime(value) {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

async function ensureSession() {
  const now = Date.now();
  if (sessionReady && lastRefresh && now - lastRefresh < 120000) return;
  if (!sessionReady && now < sessionRetryAfter) {
    throw new Error(`NSE session temporarily unavailable; retry in ${Math.ceil((sessionRetryAfter - now) / 1000)}s`);
  }

  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    if (!axiosInstance) {
      axiosInstance = axios.create({
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9'
        },
        timeout: 8000,
        withCredentials: true,
        maxRedirects: 5
      });
    }

    try {
      const home = await axiosInstance.get(NSE_HOME);
      const sc = home.headers['set-cookie'];
      if (sc) {
        axiosInstance.defaults.headers['Cookie'] = sc.map(c => c.split(';')[0]).join('; ');
      }

      await sleep(1000);
      await axiosInstance.get(`${NSE_HOME}/option-chain`, {
        headers: { 'Referer': `${NSE_HOME}/` }
      });

      lastRefresh = Date.now();
      sessionReady = true;
      console.log('[NSE] Session established');
    } catch (err) {
      console.warn(`[NSE] Session error: ${err.message}`);
      sessionReady = false;
      sessionRetryAfter = Date.now() + 60000;
      throw err;
    } finally {
      sessionPromise = null;
    }
  })();

  return sessionPromise;
}

async function fetchChain(symbol = 'NIFTY', expiryStr = '') {
  await ensureSession();

  if (Date.now() - lastRefresh < 5000) {
    // Session was just established, skip extra delay
  } else {
    await sleep(1000);
  }

  let url = `${NSE_OPTION_CHAIN}?symbol=${symbol}`;
  if (expiryStr) url += `&expiry=${expiryStr}`;

  const res = await axiosInstance.get(url, {
    headers: { 'Referer': `${NSE_HOME}/option-chain` }
  });

  return res.data;
}

function parseChain(rawData) {
  const records = rawData?.records;
  if (!records?.data?.length) return null;

  const underlyingValue = records.underlyingValue
    || records.data.find(d => d.CE?.underlyingValue)?.CE?.underlyingValue
    || 0;

  const expiryDates = records.expiryDates || [];
  const targetExpiry = expiryDates[0] || '';

  const chain = records.data
    .filter(item => item.CE && item.PE)
    .map(item => {
      const strike = item.strikePrice;
      const call = item.CE || {};
      const put = item.PE || {};
      const distance = Math.abs(strike - underlyingValue);
      const isATM = distance < 50;

      return {
        strike,
        isATM,
        call: {
          oi: call.openInterest || 0,
          ltp: call.lastPrice || 0,
          iv: call.impliedVolatility != null ? call.impliedVolatility.toFixed(2) : '0.00',
          volume: call.totalTradedVolume || 0,
          change: call.change != null ? call.change.toFixed(2) : '0.00',
          bid: call.buyPrice1 || 0,
          ask: call.sellPrice1 || 0
        },
        put: {
          oi: put.openInterest || 0,
          ltp: put.lastPrice || 0,
          iv: put.impliedVolatility != null ? put.impliedVolatility.toFixed(2) : '0.00',
          volume: put.totalTradedVolume || 0,
          change: put.change != null ? put.change.toFixed(2) : '0.00',
          bid: put.buyPrice1 || 0,
          ask: put.sellPrice1 || 0
        }
      };
    })
    .sort((a, b) => a.strike - b.strike);

  if (!chain.length || !(underlyingValue > 0)) return null;

  const dateObj = parseNseDate(targetExpiry);
  const expiryLabel = dateObj
    ? dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : targetExpiry;

  return {
    chain,
    spotPrice: underlyingValue,
    expiry: expiryLabel,
    expiryTimestamp: dateObj ? Math.floor(dateObj.getTime() / 1000) : 0,
    source: 'nse'
  };
}

function parseExpiries(rawData) {
  const dates = rawData?.records?.expiryDates;
  if (!dates?.length) return null;

  return dates.map(dateStr => {
    const d = parseNseDate(dateStr);
    if (!d) return null;
    return {
      timestamp: Math.floor(d.getTime() / 1000),
      date: d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
      label: d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
    };
  }).filter(Boolean);
}


async function getNifty50QuoteMap() {
  if (Date.now() - nifty50QuoteCacheAt < 60000) return nifty50QuoteCache;
  if (nifty50QuoteRequest) return nifty50QuoteRequest;

  nifty50QuoteRequest = (async () => {
    await ensureSession();
    const response = await axiosInstance.get(`${NSE_HOME}/api/equity-stock-indices`, {
      params: { index: 'NIFTY 50' },
      headers: { 'Referer': `${NSE_HOME}/market-data/live-equity-market` }
    });
    const rows = response.data?.data;
    if (!Array.isArray(rows)) throw new Error('NSE returned an invalid NIFTY 50 quote response');
    const quotes = new Map();
    for (const row of rows) {
      const symbol = String(row.symbol || '').toUpperCase();
      const price = Number(row.lastPrice ?? row.last);
      const previousClose = Number(row.previousClose ?? row.previousDayClose);
      if (!symbol || !(price > 0)) continue;
      quotes.set(symbol, {
        symbol,
        yahooSymbol: `${symbol}.NS`,
        longName: row.companyName || row.meta?.companyName || symbol,
        shortName: symbol,
        exchange: 'NSE',
        regularMarketPrice: price,
        regularMarketChange: Number(row.change ?? (previousClose > 0 ? price - previousClose : 0)),
        regularMarketChangePercent: Number(row.pChange ?? row.percentChange ?? 0),
        regularMarketVolume: Number(row.totalTradedVolume ?? row.totalTradedVolumeInLakhs ?? 0),
        observedAt: normalizeObservationTime(row.lastUpdateTime || row.timestamp),
        source: 'nse'
      });
    }
    nifty50QuoteCache = quotes;
    nifty50QuoteCacheAt = Date.now();
    return quotes;
  })().catch(err => {
    nifty50QuoteCacheAt = Date.now();
    nifty50QuoteCache = new Map();
    console.warn(`[NSE] NIFTY 50 quote request failed: ${err.message}`);
    return nifty50QuoteCache;
  }).finally(() => { nifty50QuoteRequest = null; });

  return nifty50QuoteRequest;
}

async function getLiveQuote(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (normalized === '^BSESN' || (normalized.startsWith('^') && normalized !== '^NSEI')) return null;
  if (normalized === '^NSEI' || normalized === 'NIFTY' || normalized === 'NIFTY 50') {
    if (!indicesQuoteCache || Date.now() - indicesQuoteCacheAt >= 30000) {
      await ensureSession();
      const response = await axiosInstance.get(`${NSE_HOME}/api/allIndices`, {
        headers: { 'Referer': `${NSE_HOME}/market-data/live-equity-market` }
      });
      const rows = response.data?.data;
      if (!Array.isArray(rows)) throw new Error('NSE returned an invalid index quote response');
      indicesQuoteCache = rows;
      indicesQuoteCacheAt = Date.now();
    }
    const row = indicesQuoteCache.find(item =>
      String(item.index || item.indexSymbol || item.name || '').toUpperCase() === 'NIFTY 50'
    );
    const price = Number(row?.last ?? row?.lastPrice ?? row?.currentValue);
    if (!(price > 0)) return null;
    const change = Number(row.change ?? 0);
    return {
      symbol: '^NSEI', yahooSymbol: '^NSEI', longName: 'NIFTY 50', shortName: 'NIFTY',
      exchange: 'NSE', regularMarketPrice: price, regularMarketChange: change,
      regularMarketChangePercent: Number(row.percentChange ?? row.pChange ?? 0),
      regularMarketVolume: Number(row.totalTradedVolume ?? 0),
      observedAt: normalizeObservationTime(row.lastUpdateTime || row.timestamp), source: 'nse'
    };
  }

  const ticker = normalized.replace(/\.NS$/, '');
  const quote = (await getNifty50QuoteMap()).get(ticker);
  return quote || null;
}

async function getNiftyOptionChain(spotPrice) {
  try {
    const defaultExpiry = formatNseDate(getNextTuesday());
    const raw = await fetchChain('NIFTY', defaultExpiry);
    return parseChain(raw);
  } catch (err) {
    console.warn(`[NSE] Chain failed: ${err.message}`);
    return null;
  }
}

async function getNiftyExpiries() {
  try {
    const defaultExpiry = formatNseDate(getNextTuesday());
    const raw = await fetchChain('NIFTY', defaultExpiry);
    return parseExpiries(raw);
  } catch (err) {
    console.warn(`[NSE] Expiries failed: ${err.message}`);
    return null;
  }
}

async function warmSession() {
  try {
    await ensureSession();
  } catch (_) {
    // silent — will retry on first actual request
  }
}

module.exports = { getNiftyOptionChain, getNiftyExpiries, getLiveQuote, warmSession };
