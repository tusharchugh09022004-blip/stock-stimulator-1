const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const UPSTOX_API_KEY = process.env.UPSTOX_API_KEY;
const UPSTOX_API_SECRET = process.env.UPSTOX_API_SECRET;
const UPSTOX_REDIRECT_URI = process.env.UPSTOX_REDIRECT_URI;
const UPSTOX_ACCESS_TOKEN = process.env.UPSTOX_ACCESS_TOKEN || '';
const UPSTOX_REFRESH_TOKEN = process.env.UPSTOX_REFRESH_TOKEN || '';

let accessToken = null;
let refreshToken = null;
let tokenExpiryTime = null;
let refreshTimer = null;

// Upstox API Base URL
const UPSTOX_API_BASE = 'https://api.upstox.com/v2';

function formatExpiryDate(ts) {
  if (!ts) return null;
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Generate Upstox OAuth authorization URL
 */
function getAuthUrl() {
  const authUrl = `https://api.upstox.com/v2/login/authorization/dialog?response_type=code&client_id=${UPSTOX_API_KEY}&redirect_uri=${encodeURIComponent(UPSTOX_REDIRECT_URI)}&scope=offline_access`;
  return authUrl;
}

/**
 * Exchange authorization code for access token (updates global state for system use)
 */
async function exchangeCodeForToken(code) {
  const tokens = await exchangeCodeForTokens(code);
  accessToken = tokens.accessToken;
  refreshToken = tokens.refreshToken || null;
  tokenExpiryTime = tokens.expiry;
  scheduleTokenRefresh();
  saveTokensToEnv();
  console.log('[Upstox] System access token obtained' + (refreshToken ? ' (with refresh_token)' : ''));
  return { accessToken, refreshToken };
}

/**
 * Exchange authorization code for tokens (returns raw data, no global state change)
 * Used for per-user OAuth
 */
async function exchangeCodeForTokens(code) {
  try {
    const params = new URLSearchParams();
    params.append('code', code);
    params.append('client_id', UPSTOX_API_KEY);
    params.append('client_secret', UPSTOX_API_SECRET);
    params.append('redirect_uri', UPSTOX_REDIRECT_URI);
    params.append('grant_type', 'authorization_code');

    const response = await axios.post(`${UPSTOX_API_BASE}/login/authorization/token`, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      }
    });

    if (response.data && response.data.access_token) {
      const jwtExp = decodeJwtExpiry(response.data.access_token);
      return {
        accessToken: response.data.access_token,
        refreshToken: response.data.refresh_token || null,
        expiry: jwtExp || null
      };
    } else {
      throw new Error('No access token in response');
    }
  } catch (error) {
    console.error('[Upstox] Token exchange failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Schedule automatic token refresh before 3:30 AM
 */
function scheduleTokenRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  const now = Date.now();
  const refreshTime = tokenExpiryTime - (5 * 60 * 1000); // Refresh 5 minutes before expiry

  if (refreshTime > now) {
    const delay = refreshTime - now;
    console.log(`[Upstox] Scheduled token refresh in ${Math.floor(delay / 1000 / 60)} minutes`);
    refreshTimer = setTimeout(() => {
      console.log('[Upstox] Triggering automatic token refresh');
      triggerTokenRefresh();
    }, delay);
  } else {
    console.log('[Upstox] Token refresh window passed, refreshing now');
    triggerTokenRefresh();
  }
}

/**
 * Trigger token refresh (requires user to re-authorize)
 */
async function triggerTokenRefresh() {
  if (refreshToken) {
    try {
      const params = new URLSearchParams();
      params.append('refresh_token', refreshToken);
      params.append('client_id', UPSTOX_API_KEY);
      params.append('client_secret', UPSTOX_API_SECRET);
      params.append('grant_type', 'refresh_token');

      const response = await axios.post(`${UPSTOX_API_BASE}/login/authorization/token`, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json'
        }
      });

      if (response.data && response.data.access_token) {
        accessToken = response.data.access_token;
        refreshToken = response.data.refresh_token || refreshToken;
        const jwtExp = decodeJwtExpiry(accessToken);
        if (jwtExp) {
          tokenExpiryTime = jwtExp;
        } else {
          const now = new Date();
          const tomorrow = new Date(now);
          tomorrow.setDate(tomorrow.getDate() + 1);
          tomorrow.setHours(3, 30, 0, 0);
          tokenExpiryTime = tomorrow.getTime();
        }
        scheduleTokenRefresh();
        saveTokensToEnv();
        console.log('[Upstox] Token refreshed automatically');
        return;
      }
    } catch (err) {
      console.error('[Upstox] Auto-refresh failed:', err.response?.data || err.message);
    }
  }
  console.log('[Upstox] Token refresh failed - user needs to re-authorize');
  accessToken = null;
  refreshToken = null;
}

/**
 * Get current access token
 */
function getAccessToken() {
  if (!accessToken) {
    return null;
  }
  
  // Check if token is expired
  if (Date.now() >= tokenExpiryTime) {
    console.log('[Upstox] Access token expired');
    accessToken = null;
    return null;
  }
  
  return accessToken;
}

/**
 * Decode JWT access token to get real expiry time
 */
function decodeJwtExpiry(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    return decoded.exp ? decoded.exp * 1000 : null;
  } catch (e) {
    return null;
  }
}

/**
 * Set access token manually (loading from .env)
 */
function setAccessToken(token, refreshTok) {
  accessToken = token;
  if (refreshTok) refreshToken = refreshTok;
  
  const jwtExp = decodeJwtExpiry(token);
  if (jwtExp) {
    tokenExpiryTime = jwtExp;
  } else {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(3, 30, 0, 0);
    tokenExpiryTime = tomorrow.getTime();
  }
  
  if (tokenExpiryTime <= Date.now() && refreshToken) {
    console.log('[Upstox] Token expired, attempting auto-refresh...');
    triggerTokenRefresh();
  } else if (tokenExpiryTime > Date.now()) {
    scheduleTokenRefresh();
  }
}

// Auto-load token from environment variable if present
if (UPSTOX_ACCESS_TOKEN) {
  setAccessToken(UPSTOX_ACCESS_TOKEN, UPSTOX_REFRESH_TOKEN || null);
}

/**
 * Save current tokens to .env for persistence across restarts
 */
function saveTokensToEnv() {
  try {
    const envPath = __dirname + '/.env';
    let envContent = fs.readFileSync(envPath, 'utf8');
    const setOrReplace = (key, val) => {
      const re = new RegExp(`^${key}=.*$`, 'm');
      const line = `${key}=${val}`;
      if (re.test(envContent)) {
        envContent = envContent.replace(re, line);
      } else {
        envContent += `\n${line}`;
      }
    };
    setOrReplace('UPSTOX_ACCESS_TOKEN', accessToken || '');
    setOrReplace('UPSTOX_REFRESH_TOKEN', refreshToken || '');
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log('[Upstox] Tokens saved to .env');
  } catch (err) {
    console.error('[Upstox] Failed to save tokens to .env:', err.message);
  }
}

/**
 * Fetch options chain from Upstox
 */
async function getOptionsChain(index, expiryTimestamp = null, userToken = null) {
  const token = userToken || getAccessToken();
  if (!token) {
    throw new Error('No valid access token');
  }

  try {
    const idx = index.toUpperCase();
    const indexKey = idx === 'SENSEX' ? 'BSE_INDEX|SENSEX' : 'NSE_INDEX|Nifty 50';
    let expiryDate = expiryTimestamp ? formatExpiryDate(expiryTimestamp) : null;
    
    if (!expiryDate) {
      // Get next weekly expiry
      const d = new Date();
      while (d.getDay() !== (idx === 'SENSEX' ? 4 : 2)) d.setDate(d.getDate() + 1);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      expiryDate = `${d.getFullYear()}-${mm}-${dd}`;
    }

    const url = `${UPSTOX_API_BASE}/option/chain?instrument_key=${encodeURIComponent(indexKey)}&expiry_date=${expiryDate}`;

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (response.data && response.data.data) {
      return parseUpstoxOptionsChain(response.data.data, index);
    } else {
      throw new Error('Invalid response from Upstox');
    }
  } catch (error) {
    console.error('[Upstox] Options chain fetch failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Parse Upstox options chain response
 */
function parseUpstoxOptionsChain(data, index) {
  const chain = [];
  const step = index.toUpperCase() === 'SENSEX' ? 100 : 50;
  const spotPrice = data[0]?.underlying_spot_price || 0;

  data.forEach(contract => {
    const strike = contract.strike_price;
    const callMd = contract.call_options?.market_data || {};
    const callGk = contract.call_options?.option_greeks || {};
    const putMd = contract.put_options?.market_data || {};
    const putGk = contract.put_options?.option_greeks || {};

    const callLtp = callMd.ltp || callMd.close_price || 0;
    const putLtp = putMd.ltp || putMd.close_price || 0;
    const distance = Math.abs(strike - spotPrice);
    const isATM = distance < step;

    chain.push({
      strike,
      isATM,
      call: {
        ltp: callLtp,
        oi: callMd.oi || 0,
        volume: callMd.volume || 0,
        iv: callGk.iv != null ? callGk.iv.toFixed(2) : '0.00',
        bid: callMd.bid_price || 0,
        ask: callMd.ask_price || 0
      },
      put: {
        ltp: putLtp,
        oi: putMd.oi || 0,
        volume: putMd.volume || 0,
        iv: putGk.iv != null ? putGk.iv.toFixed(2) : '0.00',
        bid: putMd.bid_price || 0,
        ask: putMd.ask_price || 0
      }
    });
  });

  chain.sort((a, b) => a.strike - b.strike);

  return { chain, spotPrice, source: 'upstox' };
}

/**
 * Fetch spot price for index
 */
async function getSpotPrice(index, userToken = null) {
  const token = userToken || getAccessToken();
  if (!token) {
    throw new Error('No valid access token');
  }

  try {
    const indexKey = index.toUpperCase() === 'SENSEX' ? 'BSE_INDEX|SENSEX' : 'NSE_INDEX|Nifty 50';
    
    const response = await axios.get(`${UPSTOX_API_BASE}/market-quote/quotes?instrument_key=${encodeURIComponent(indexKey)}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (response.data && response.data.data && response.data.data[indexKey]) {
      return response.data.data[indexKey].last_price || 0;
    } else {
      throw new Error('Invalid response from Upstox');
    }
  } catch (error) {
    console.error('[Upstox] Spot price fetch failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Fetch expiry dates for index
 */
async function getExpiryDates(index, userToken = null) {
  const token = userToken || getAccessToken();
  if (!token) {
    throw new Error('No valid access token');
  }

  try {
    const indexKey = index.toUpperCase() === 'SENSEX' ? 'BSE_INDEX|SENSEX' : 'NSE_INDEX|Nifty 50';
    
    const response = await axios.get(`${UPSTOX_API_BASE}/option/chain?instrument_key=${encodeURIComponent(indexKey)}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json'
      }
    });

    if (response.data && response.data.data) {
      // Extract unique expiry dates
      const expirySet = new Set();
      response.data.data.forEach(contract => {
        if (contract.expiry_date) {
          expirySet.add(contract.expiry_date);
        }
      });

      const expiries = Array.from(expirySet).map(expiryStr => {
        const date = new Date(expiryStr);
        return {
          timestamp: Math.floor(date.getTime() / 1000),
          date: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
          label: date.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })
        };
      }).sort((a, b) => a.timestamp - b.timestamp);

      return expiries;
    } else {
      throw new Error('Invalid response from Upstox');
    }
  } catch (error) {
    console.error('[Upstox] Expiry dates fetch failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get instrument key for option
 */
function getOptionInstrumentKey(index, strike, type) {
  const indexName = index.toUpperCase() === 'SENSEX' ? 'SENSEX' : 'NIFTY';
  const year = new Date().getFullYear();
  const month = new Date().toLocaleString('en-US', { month: 'short' }).toUpperCase();
  return `NSE_FO|${indexName}${year}${month}${strike}${type}`;
}

/**
 * Refresh a per-user token using their refresh token
 * Returns new tokens, does NOT touch global state
 */
async function refreshUserToken(userRefreshToken) {
  const params = new URLSearchParams();
  params.append('refresh_token', userRefreshToken);
  params.append('client_id', UPSTOX_API_KEY);
  params.append('client_secret', UPSTOX_API_SECRET);
  params.append('grant_type', 'refresh_token');

  const response = await axios.post(`${UPSTOX_API_BASE}/login/authorization/token`, params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json'
    }
  });

  if (response.data && response.data.access_token) {
    const jwtExp = decodeJwtExpiry(response.data.access_token);
    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token || userRefreshToken,
      expiry: jwtExp || (Date.now() + 24 * 60 * 60 * 1000)
    };
  }
  throw new Error('No access token in refresh response');
}

module.exports = {
  getAuthUrl,
  exchangeCodeForToken,
  exchangeCodeForTokens,
  getAccessToken,
  setAccessToken,
  getOptionsChain,
  getSpotPrice,
  getExpiryDates,
  getOptionInstrumentKey,
  refreshUserToken
};
