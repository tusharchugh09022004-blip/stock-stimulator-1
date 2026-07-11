const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

const DEFAULT_BALANCE = 10000000;

async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        userId TEXT PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT NOT NULL,
        balance REAL DEFAULT 10000000,
        googleId TEXT,
        email TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sessions (
        sessionId TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        expiresAt TEXT,
        FOREIGN KEY(userId) REFERENCES users(userId)
      );

      CREATE TABLE IF NOT EXISTS portfolios (
        id SERIAL PRIMARY KEY,
        userId TEXT NOT NULL,
        symbol TEXT NOT NULL,
        qty REAL NOT NULL,
        avgPrice REAL NOT NULL,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(userId, symbol)
      );

      CREATE TABLE IF NOT EXISTS watchlists (
        id SERIAL PRIMARY KEY,
        userId TEXT NOT NULL,
        symbol TEXT NOT NULL,
        yahooSymbol TEXT NOT NULL,
        name TEXT,
        exchange TEXT,
        createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(userId, symbol)
      );

      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        userId TEXT NOT NULL,
        symbol TEXT NOT NULL,
        yahooSymbol TEXT,
        action TEXT NOT NULL,
        qty REAL NOT NULL,
        price REAL NOT NULL,
        total REAL NOT NULL,
        orderTime TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS login_history (
        id SERIAL PRIMARY KEY,
        userId TEXT NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        ipAddress TEXT,
        userAgent TEXT,
        loginTime TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(userId)
      );

      CREATE TABLE IF NOT EXISTS options_portfolios (
        id SERIAL PRIMARY KEY,
        userId TEXT NOT NULL,
        contract TEXT NOT NULL,
        strike REAL NOT NULL,
        type TEXT NOT NULL,
        underlyingIndex TEXT NOT NULL,
        expiry TEXT NOT NULL,
        qty REAL NOT NULL,
        avgPremium REAL NOT NULL,
        updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(userId, contract)
      );

      CREATE TABLE IF NOT EXISTS options_trades (
        id SERIAL PRIMARY KEY,
        userId TEXT NOT NULL,
        contract TEXT NOT NULL,
        strike REAL NOT NULL,
        type TEXT NOT NULL,
        underlyingIndex TEXT NOT NULL,
        expiry TEXT NOT NULL,
        action TEXT NOT NULL,
        quantity REAL NOT NULL,
        premium REAL NOT NULL,
        total REAL NOT NULL,
        tradeTime TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(userId)
      );

      CREATE TABLE IF NOT EXISTS trades (
        id SERIAL PRIMARY KEY,
        userId TEXT NOT NULL,
        symbol TEXT NOT NULL,
        instrumentType TEXT NOT NULL,
        qty REAL NOT NULL,
        entryPrice REAL NOT NULL,
        exitPrice REAL NOT NULL,
        realizedPnL REAL NOT NULL,
        tradeTime TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(userId) REFERENCES users(userId)
      );

      CREATE INDEX IF NOT EXISTS idx_portfolios_userId ON portfolios(userId);
      CREATE INDEX IF NOT EXISTS idx_watchlists_userId ON watchlists(userId);
      CREATE INDEX IF NOT EXISTS idx_orders_userId ON orders(userId);
      CREATE INDEX IF NOT EXISTS idx_orders_time ON orders(orderTime);
      CREATE INDEX IF NOT EXISTS idx_login_history_userId ON login_history(userId);
      CREATE INDEX IF NOT EXISTS idx_login_history_time ON login_history(loginTime);
      CREATE INDEX IF NOT EXISTS idx_options_portfolios_userId ON options_portfolios(userId);
      CREATE INDEX IF NOT EXISTS idx_options_trades_userId ON options_trades(userId);
      CREATE INDEX IF NOT EXISTS idx_options_trades_contract ON options_trades(contract);
      CREATE INDEX IF NOT EXISTS idx_options_trades_time ON options_trades(tradeTime);
      CREATE INDEX IF NOT EXISTS idx_trades_userId ON trades(userId);
      CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(tradeTime);
    `);

    // Add Upstox per-user columns if they don't exist
    try { await client.query(`ALTER TABLE users ADD COLUMN upstoxAccessToken TEXT`); } catch (_) {}
    try { await client.query(`ALTER TABLE users ADD COLUMN upstoxRefreshToken TEXT`); } catch (_) {}
    try { await client.query(`ALTER TABLE users ADD COLUMN upstoxTokenExpiry BIGINT`); } catch (_) {}
    try { await client.query(`ALTER TABLE users ADD COLUMN upstoxConnectedAt TEXT`); } catch (_) {}

    console.log('[DB] Schema initialized successfully');
  } finally {
    client.release();
  }
}

// User operations
async function getUser(userId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE userId = $1', [userId]);
  return rows[0] || null;
}

async function updateUserBalance(userId, balance) {
  const { rowCount } = await pool.query(
    'UPDATE users SET balance = $1, updatedAt = CURRENT_TIMESTAMP WHERE userId = $2',
    [balance, userId]
  );
  return rowCount > 0;
}

// Portfolio operations
async function getPortfolio(userId) {
  const { rows } = await pool.query(
    'SELECT symbol, qty, avgPrice FROM portfolios WHERE userId = $1',
    [userId]
  );
  const portfolio = {};
  for (const pos of rows) {
    portfolio[pos.symbol] = { qty: Number(pos.qty), avgPrice: Number(pos.avgPrice) };
  }
  return portfolio;
}

async function updatePortfolio(userId, symbol, qty, avgPrice) {
  if (qty <= 0) {
    await pool.query('DELETE FROM portfolios WHERE userId = $1 AND symbol = $2', [userId, symbol]);
    return;
  }
  await pool.query(`
    INSERT INTO portfolios (userId, symbol, qty, avgPrice, updatedAt)
    VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    ON CONFLICT(userId, symbol) DO UPDATE SET
      qty = EXCLUDED.qty,
      avgPrice = EXCLUDED.avgPrice,
      updatedAt = CURRENT_TIMESTAMP
  `, [userId, symbol, qty, avgPrice]);
}

async function clearPortfolioPosition(userId, symbol) {
  await pool.query('DELETE FROM portfolios WHERE userId = $1 AND symbol = $2', [userId, symbol]);
}

// Watchlist operations
async function getWatchlist(userId) {
  const { rows } = await pool.query(
    'SELECT symbol, yahooSymbol, name, exchange FROM watchlists WHERE userId = $1 ORDER BY id',
    [userId]
  );
  return rows;
}

async function addToWatchlist(userId, symbol, yahooSymbol, name, exchange) {
  await pool.query(`
    INSERT INTO watchlists (userId, symbol, yahooSymbol, name, exchange, createdAt)
    VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
    ON CONFLICT(userId, symbol) DO NOTHING
  `, [userId, symbol, yahooSymbol, name, exchange]);
}

async function removeFromWatchlist(userId, symbol) {
  await pool.query('DELETE FROM watchlists WHERE userId = $1 AND symbol = $2', [userId, symbol]);
}

// Order operations
async function saveOrder(userId, symbol, yahooSymbol, action, qty, price, total) {
  await pool.query(`
    INSERT INTO orders (userId, symbol, yahooSymbol, action, qty, price, total, orderTime)
    VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
  `, [userId, symbol, yahooSymbol, action, qty, price, total]);
}

async function getOrderHistory(userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const { rows } = await pool.query(
    'SELECT * FROM orders WHERE userId = $1 ORDER BY orderTime DESC LIMIT $2',
    [userId, safeLimit]
  );
  return rows;
}

async function deleteOrderHistoryRecord(orderId, userId) {
  const { rowCount } = await pool.query(
    'DELETE FROM orders WHERE id = $1 AND userId = $2',
    [orderId, userId]
  );
  return { changes: rowCount };
}

async function deleteAllOrders(userId) {
  const { rowCount } = await pool.query('DELETE FROM orders WHERE userId = $1', [userId]);
  await pool.query('DELETE FROM options_trades WHERE userId = $1', [userId]);
  await pool.query('DELETE FROM trades WHERE userId = $1', [userId]);
  console.log(`[DB] deleteAllOrders userId=${userId}, orders_deleted=${rowCount}`);
  return { changes: rowCount };
}

async function clearPortfolio(userId) {
  await pool.query('DELETE FROM portfolios WHERE userId = $1', [userId]);
  await pool.query('DELETE FROM options_portfolios WHERE userId = $1', [userId]);
}

async function resetBalance(userId) {
  await pool.query('UPDATE users SET balance = 10000000 WHERE userId = $1', [userId]);
}

// Auth operations
async function createUser(username, password) {
  const userId = crypto.randomUUID();
  const hashedPassword = bcrypt.hashSync(password, 10);

  try {
    await pool.query(
      'INSERT INTO users (userId, username, password, balance) VALUES ($1, $2, $3, $4)',
      [userId, username, hashedPassword, DEFAULT_BALANCE]
    );
    return { userId, username, balance: DEFAULT_BALANCE };
  } catch (err) {
    if (err.code === '23505') return null;
    throw err;
  }
}

async function verifyUser(username, password) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = rows[0];
  if (!user) return null;
  const ok = bcrypt.compareSync(password, user.password);
  return ok ? user : null;
}

async function getUserByUsername(username) {
  const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return rows[0] || null;
}

async function getUserById(userId) {
  const { rows } = await pool.query(
    'SELECT userId, username, balance FROM users WHERE userId = $1',
    [userId]
  );
  return rows[0] || null;
}

async function saveLoginHistory(userId, username, action, ipAddress, userAgent) {
  await pool.query(`
    INSERT INTO login_history (userId, username, action, ipAddress, userAgent, loginTime)
    VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
  `, [userId, username, action, ipAddress || null, userAgent || null]);
}

async function getLoginHistory(userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const { rows } = await pool.query(
    'SELECT id, userId, username, action, ipAddress, userAgent, loginTime FROM login_history WHERE userId = $1 ORDER BY loginTime DESC LIMIT $2',
    [userId, safeLimit]
  );
  return rows;
}

async function createSession(userId) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    'INSERT INTO sessions (sessionId, userId, createdAt, expiresAt) VALUES ($1, $2, CURRENT_TIMESTAMP, $3)',
    [sessionId, userId, expiresAt]
  );
  return sessionId;
}

async function validateSession(sessionId) {
  const { rows } = await pool.query(
    `SELECT s.*, u.username, u.balance
     FROM sessions s JOIN users u ON s.userId = u.userId
     WHERE s.sessionId = $1`,
    [sessionId]
  );
  const session = rows[0];
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    await deleteSession(sessionId);
    return null;
  }
  return session;
}

async function deleteSession(sessionId) {
  await pool.query('DELETE FROM sessions WHERE sessionId = $1', [sessionId]);
}

async function saveOptionsTrade(userId, contract, strike, type, underlyingIndex, expiry, action, quantity, premium, total) {
  await pool.query(`
    INSERT INTO options_trades (userId, contract, strike, type, underlyingIndex, expiry, action, quantity, premium, total, tradeTime)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
  `, [userId, contract, strike, type, underlyingIndex, expiry, action, quantity, premium, total]);
}

async function getOptionsTrades(userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const { rows } = await pool.query(
    'SELECT * FROM options_trades WHERE userId = $1 ORDER BY tradeTime DESC LIMIT $2',
    [userId, safeLimit]
  );
  return rows;
}

async function saveTrade(userId, symbol, instrumentType, qty, entryPrice, exitPrice, realizedPnL) {
  await pool.query(`
    INSERT INTO trades (userId, symbol, instrumentType, qty, entryPrice, exitPrice, realizedPnL, tradeTime)
    VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
  `, [userId, symbol, instrumentType, qty, entryPrice, exitPrice, realizedPnL]);
}

async function getTradeHistory(userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const { rows } = await pool.query(
    'SELECT * FROM trades WHERE userId = $1 ORDER BY tradeTime DESC LIMIT $2',
    [userId, safeLimit]
  );
  return rows;
}

async function getOptionsPortfolio(userId) {
  const { rows } = await pool.query('SELECT * FROM options_portfolios WHERE userId = $1', [userId]);
  const portfolio = {};
  for (const pos of rows) {
    portfolio[pos.contract] = {
      contract: pos.contract,
      strike: Number(pos.strike),
      type: pos.type,
      index: pos.underlyingindex,
      expiry: pos.expiry,
      quantity: Number(pos.qty),
      avgPremium: Number(pos.avgpremium)
    };
  }
  return portfolio;
}

async function updateOptionsPortfolio(userId, contract, strike, type, underlyingIndex, expiry, qty, avgPremium) {
  if (qty <= 0) {
    await pool.query('DELETE FROM options_portfolios WHERE userId = $1 AND contract = $2', [userId, contract]);
    return;
  }
  await pool.query(`
    INSERT INTO options_portfolios (userId, contract, strike, type, underlyingIndex, expiry, qty, avgPremium, updatedAt)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
    ON CONFLICT(userId, contract) DO UPDATE SET
      qty = EXCLUDED.qty,
      avgPremium = EXCLUDED.avgPremium,
      updatedAt = CURRENT_TIMESTAMP
  `, [userId, contract, strike, type, underlyingIndex, expiry, qty, avgPremium]);
}

// Google auth functions
async function getUserByGoogleId(googleId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE googleId = $1', [googleId]);
  return rows[0] || null;
}

async function getUserByEmail(email) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return rows[0] || null;
}

async function createGoogleUser(googleId, email, name) {
  const userId = crypto.randomUUID();
  const username = name || email.split('@')[0];
  const hashedPassword = bcrypt.hashSync(crypto.randomUUID(), 10);

  try {
    await pool.query(
      'INSERT INTO users (userId, username, password, balance, googleId, email) VALUES ($1, $2, $3, $4, $5, $6)',
      [userId, username, hashedPassword, DEFAULT_BALANCE, googleId, email]
    );
    return { userId, username, balance: DEFAULT_BALANCE };
  } catch (err) {
    if (err.code === '23505') {
      const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      return rows[0];
    }
    throw err;
  }
}

// Upstox per-user token functions
async function saveUpstoxTokens(userId, accessToken, refreshToken, expiry) {
  await pool.query(`
    UPDATE users SET
      upstoxAccessToken = $1,
      upstoxRefreshToken = $2,
      upstoxTokenExpiry = $3,
      upstoxConnectedAt = CURRENT_TIMESTAMP,
      updatedAt = CURRENT_TIMESTAMP
    WHERE userId = $4
  `, [accessToken, refreshToken || null, expiry || null, userId]);
}

async function getUpstoxTokens(userId) {
  const { rows } = await pool.query(
    'SELECT upstoxAccessToken, upstoxRefreshToken, upstoxTokenExpiry, upstoxConnectedAt FROM users WHERE userId = $1',
    [userId]
  );
  const row = rows[0];
  if (!row || !row.upstoxaccesstoken) return null;
  return {
    accessToken: row.upstoxaccesstoken,
    refreshToken: row.upstoxrefreshtoken,
    expiry: row.upstoxtokenexpiry ? Number(row.upstoxtokenexpiry) : null,
    connectedAt: row.upstoxconnectedat
  };
}

async function clearUpstoxTokens(userId) {
  await pool.query(`
    UPDATE users SET
      upstoxAccessToken = NULL,
      upstoxRefreshToken = NULL,
      upstoxTokenExpiry = NULL,
      upstoxConnectedAt = NULL,
      updatedAt = CURRENT_TIMESTAMP
    WHERE userId = $1
  `, [userId]);
}

module.exports = {
  pool,
  initSchema,
  getUser,
  updateUserBalance,
  getPortfolio,
  updatePortfolio,
  clearPortfolioPosition,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  saveOrder,
  getOrderHistory,
  deleteOrderHistoryRecord,
  deleteAllOrders,
  clearPortfolio,
  resetBalance,
  createUser,
  verifyUser,
  getUserByUsername,
  saveLoginHistory,
  getLoginHistory,
  createSession,
  validateSession,
  deleteSession,
  getUserById,
  saveOptionsTrade,
  getOptionsTrades,
  getOptionsPortfolio,
  updateOptionsPortfolio,
  saveTrade,
  getTradeHistory,
  getUserByGoogleId,
  getUserByEmail,
  createGoogleUser,
  saveUpstoxTokens,
  getUpstoxTokens,
  clearUpstoxTokens
};
