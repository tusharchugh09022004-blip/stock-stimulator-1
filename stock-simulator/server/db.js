const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const dbPath = path.join(__dirname, 'stock-simulator.db');
const db = new Database(dbPath, { fileMustExist: false });

// Pragmas for better performance
db.pragma('journal_mode = WAL');

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    userId TEXT PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT NOT NULL,
    balance REAL DEFAULT 10000000,
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    symbol TEXT NOT NULL,
    qty REAL NOT NULL,
    avgPrice REAL NOT NULL,
    updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(userId, symbol)
  );

  CREATE TABLE IF NOT EXISTS watchlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    symbol TEXT NOT NULL,
    yahooSymbol TEXT NOT NULL,
    name TEXT,
    exchange TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(userId, symbol)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT NOT NULL,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    loginTime TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(userId) REFERENCES users(userId)
  );

  CREATE INDEX IF NOT EXISTS idx_portfolios_userId ON portfolios(userId);
  CREATE INDEX IF NOT EXISTS idx_watchlists_userId ON watchlists(userId);
  CREATE INDEX IF NOT EXISTS idx_orders_userId ON orders(userId);
  CREATE INDEX IF NOT EXISTS idx_orders_time ON orders(orderTime);
  CREATE INDEX IF NOT EXISTS idx_login_history_userId ON login_history(userId);
  CREATE INDEX IF NOT EXISTS idx_login_history_time ON login_history(loginTime);
`);

const DEFAULT_BALANCE = 10000000;

// User operations
function getUser(userId) {
  return db.prepare('SELECT * FROM users WHERE userId = ?').get(userId) || null;
}

function updateUserBalance(userId, balance) {
  const stmt = db.prepare('UPDATE users SET balance = ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?');
  const info = stmt.run(balance, userId);
  return info.changes > 0;
}

// Portfolio operations
function getPortfolio(userId) {
  const rows = db
    .prepare('SELECT symbol, qty, avgPrice FROM portfolios WHERE userId = ?')
    .all(userId);

  const portfolio = {};
  for (const pos of rows) {
    portfolio[pos.symbol] = { qty: Number(pos.qty), avgPrice: Number(pos.avgPrice) };
  }
  return portfolio;
}

function updatePortfolio(userId, symbol, qty, avgPrice) {
  if (qty <= 0) {
    db.prepare('DELETE FROM portfolios WHERE userId = ? AND symbol = ?').run(userId, symbol);
    return;
  }

  db.prepare(`
    INSERT INTO portfolios (userId, symbol, qty, avgPrice, updatedAt)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(userId, symbol) DO UPDATE SET
      qty = excluded.qty,
      avgPrice = excluded.avgPrice,
      updatedAt = CURRENT_TIMESTAMP
  `).run(userId, symbol, qty, avgPrice);
}

function clearPortfolioPosition(userId, symbol) {
  db.prepare('DELETE FROM portfolios WHERE userId = ? AND symbol = ?').run(userId, symbol);
}

// Watchlist operations
function getWatchlist(userId) {
  return db
    .prepare(
      'SELECT symbol, yahooSymbol, name, exchange FROM watchlists WHERE userId = ? ORDER BY id'
    )
    .all(userId);
}

function addToWatchlist(userId, symbol, yahooSymbol, name, exchange) {
  db.prepare(`
    INSERT INTO watchlists (userId, symbol, yahooSymbol, name, exchange, createdAt)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(userId, symbol) DO NOTHING
  `).run(userId, symbol, yahooSymbol, name, exchange);
}

function removeFromWatchlist(userId, symbol) {
  db.prepare('DELETE FROM watchlists WHERE userId = ? AND symbol = ?').run(userId, symbol);
}

// Order operations
function saveOrder(userId, symbol, yahooSymbol, action, qty, price, total) {
  db.prepare(`
    INSERT INTO orders (userId, symbol, yahooSymbol, action, qty, price, total, orderTime)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(userId, symbol, yahooSymbol, action, qty, price, total);
}

function getOrderHistory(userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  return db
    .prepare('SELECT * FROM orders WHERE userId = ? ORDER BY orderTime DESC LIMIT ?')
    .all(userId, safeLimit);
}

function deleteOrderHistoryRecord(orderId, userId) {
  const info = db
    .prepare('DELETE FROM orders WHERE id = ? AND userId = ?')
    .run(orderId, userId);
  return { changes: info.changes };
}

function deleteAllOrders(userId) {
  const info = db.prepare('DELETE FROM orders WHERE userId = ?').run(userId);
  return { changes: info.changes };
}

// Auth operations
function createUser(username, password) {
  const userId = crypto.randomUUID();
  const hashedPassword = bcrypt.hashSync(password, 10);

  try {
    db.prepare(
      'INSERT INTO users (userId, username, password, balance) VALUES (?, ?, ?, ?)'
    ).run(userId, username, hashedPassword, DEFAULT_BALANCE);

    return { userId, username, balance: DEFAULT_BALANCE };
  } catch (err) {
    // unique violation
    if (String(err && err.message).toLowerCase().includes('unique')) return null;
    throw err;
  }
}

function verifyUser(username, password) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return null;

  const ok = bcrypt.compareSync(password, user.password);
  return ok ? user : null;
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
}

function getUserById(userId) {
  return db.prepare('SELECT userId, username, balance FROM users WHERE userId = ?').get(userId) || null;
}

function saveLoginHistory(userId, username, action, ipAddress, userAgent) {
  db.prepare(`
    INSERT INTO login_history (userId, username, action, ipAddress, userAgent, loginTime)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(userId, username, action, ipAddress || null, userAgent || null);
}

function getLoginHistory(userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  return db
    .prepare(
      'SELECT id, userId, username, action, ipAddress, userAgent, loginTime FROM login_history WHERE userId = ? ORDER BY loginTime DESC LIMIT ?'
    )
    .all(userId, safeLimit);
}

function createSession(userId) {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare('INSERT INTO sessions (sessionId, userId, createdAt, expiresAt) VALUES (?, ?, CURRENT_TIMESTAMP, ?)')
    .run(sessionId, userId, expiresAt);

  return sessionId;
}

function validateSession(sessionId) {
  const session = db
    .prepare(
      `SELECT s.*, u.username, u.balance
       FROM sessions s JOIN users u ON s.userId = u.userId
       WHERE s.sessionId = ?`
    )
    .get(sessionId);

  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) {
    deleteSession(sessionId);
    return null;
  }

  return session;
}

function deleteSession(sessionId) {
  db.prepare('DELETE FROM sessions WHERE sessionId = ?').run(sessionId);
}

module.exports = {
  db,
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
  createUser,
  verifyUser,
  getUserByUsername,
  saveLoginHistory,
  getLoginHistory,
  createSession,
  validateSession,
  deleteSession,
  getUserById
};

