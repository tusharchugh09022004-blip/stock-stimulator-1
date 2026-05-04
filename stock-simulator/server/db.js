const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, 'stock-simulator.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
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

// Default balance
const DEFAULT_BALANCE = 10000000;

// User operations
function getUser(userId) {
  let user = db.prepare('SELECT * FROM users WHERE userId = ?').get(userId);
  
  if (!user) {
    return null;
  }
  
  return user;
}

function updateUserBalance(userId, balance) {
  const stmt = db.prepare('UPDATE users SET balance = ?, updatedAt = CURRENT_TIMESTAMP WHERE userId = ?');
  return stmt.run(balance, userId);
}

// Portfolio operations
function getPortfolio(userId) {
  const positions = db.prepare('SELECT symbol, qty, avgPrice FROM portfolios WHERE userId = ?').all(userId);
  const portfolio = {};
  
  for (const pos of positions) {
    portfolio[pos.symbol] = {
      qty: pos.qty,
      avgPrice: pos.avgPrice
    };
  }
  
  return portfolio;
}

function updatePortfolio(userId, symbol, qty, avgPrice) {
  if (qty <= 0) {
    // Remove position
    db.prepare('DELETE FROM portfolios WHERE userId = ? AND symbol = ?').run(userId, symbol);
    return;
  }
  
  const upsert = db.prepare(`
    INSERT INTO portfolios (userId, symbol, qty, avgPrice) VALUES (?, ?, ?, ?)
    ON CONFLICT(userId, symbol) DO UPDATE SET
      qty = excluded.qty,
      avgPrice = excluded.avgPrice,
      updatedAt = CURRENT_TIMESTAMP
  `);
  
  return upsert.run(userId, symbol, qty, avgPrice);
}

function clearPortfolioPosition(userId, symbol) {
  return db.prepare('DELETE FROM portfolios WHERE userId = ? AND symbol = ?').run(userId, symbol);
}

// Watchlist operations
function getWatchlist(userId) {
  const items = db.prepare(`
    SELECT symbol, yahooSymbol, name, exchange 
    FROM watchlists 
    WHERE userId = ? 
    ORDER BY id
  `).all(userId);
  
  return items;
}

function addToWatchlist(userId, symbol, yahooSymbol, name, exchange) {
  const upsert = db.prepare(`
    INSERT INTO watchlists (userId, symbol, yahooSymbol, name, exchange) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(userId, symbol) DO NOTHING
  `);
  
  return upsert.run(userId, symbol, yahooSymbol, name, exchange);
}

function removeFromWatchlist(userId, symbol) {
  return db.prepare('DELETE FROM watchlists WHERE userId = ? AND symbol = ?').run(userId, symbol);
}

// Order operations
function saveOrder(userId, symbol, yahooSymbol, action, qty, price, total) {
  const stmt = db.prepare(`
    INSERT INTO orders (userId, symbol, yahooSymbol, action, qty, price, total)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  return stmt.run(userId, symbol, yahooSymbol, action, qty, price, total);
}

function getOrderHistory(userId, limit = 50) {
  const orders = db.prepare(`
    SELECT * FROM orders 
    WHERE userId = ? 
    ORDER BY orderTime DESC 
    LIMIT ?
  `).all(userId, limit);
  return orders;
}

function deleteOrder(orderId, userId) {
  // Verify the order belongs to the user before deleting
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND userId = ?').get(orderId, userId);
  if (!order) return { changes: 0 };
  
  // Refund balance if it was a buy order (reverse the trade)
  if (order.action === 'buy') {
    const refund = order.total;
    db.prepare('UPDATE users SET balance = balance + ? WHERE userId = ?').run(refund, userId);
  } else if (order.action === 'sell') {
    // For sell orders, we need to add back the shares to portfolio
    const existing = db.prepare('SELECT * FROM portfolios WHERE userId = ? AND symbol = ?').get(userId, order.symbol);
    if (existing) {
      db.prepare('UPDATE portfolios SET qty = qty + ? WHERE userId = ? AND symbol = ?').run(order.qty, userId, order.symbol);
    } else {
      db.prepare('INSERT INTO portfolios (userId, symbol, qty, avgPrice) VALUES (?, ?, ?, ?)').run(userId, order.symbol, order.qty, order.price);
    }
  }
  
  return db.prepare('DELETE FROM orders WHERE id = ? AND userId = ?').run(orderId, userId);
}

function deleteOrderHistoryRecord(orderId, userId) {
  // Delete order record without reversing the trade
  // Portfolio state is the source of truth, not order history
  return db.prepare('DELETE FROM orders WHERE id = ? AND userId = ?').run(orderId, userId);
}

function deleteAllOrders(userId) {
  // Just delete all order records - do NOT reverse trades
  // Order history is just a log; clearing it shouldn't affect portfolio state
  return db.prepare('DELETE FROM orders WHERE userId = ?').run(userId);
}

// Auth operations
function createUser(username, password) {
  const crypto = require('crypto');
  const userId = crypto.randomUUID();
  const hashedPassword = bcrypt.hashSync(password, 10);
  
  try {
    const stmt = db.prepare(`
      INSERT INTO users (userId, username, password, balance)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(userId, username, hashedPassword, DEFAULT_BALANCE);
    return { userId, username, balance: DEFAULT_BALANCE };
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return null; // Username already exists
    }
    throw err;
  }
}

function verifyUser(username, password) {
  const user = db.prepare(`
    SELECT * FROM users WHERE username = ?`).get(username);
  
  if (!user) return null;
  
  const passwordMatch = bcrypt.compareSync(password, user.password);
  if (!passwordMatch) return null;
  
  return user;
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function saveLoginHistory(userId, username, action, ipAddress, userAgent) {
  const stmt = db.prepare(`
    INSERT INTO login_history (userId, username, action, ipAddress, userAgent)
    VALUES (?, ?, ?, ?, ?)
  `);
  return stmt.run(userId, username, action, ipAddress || null, userAgent || null);
}

function getLoginHistory(userId, limit = 50) {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 50;
  return db.prepare(`
    SELECT id, userId, username, action, ipAddress, userAgent, loginTime
    FROM login_history
    WHERE userId = ?
    ORDER BY loginTime DESC
    LIMIT ?
  `).all(userId, safeLimit);
}

function createSession(userId) {
  const crypto = require('crypto');
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days
  
  db.prepare(`
    INSERT INTO sessions (sessionId, userId, expiresAt)
    VALUES (?, ?, ?)
  `).run(sessionId, userId, expiresAt);
  
  return sessionId;
}

function validateSession(sessionId) {
  const session = db.prepare(`
    SELECT s.*, u.username, u.balance
    FROM sessions s
    JOIN users u ON s.userId = u.userId
    WHERE s.sessionId = ?
  `).get(sessionId);
  
  if (!session) return null;
  
  // Check if expired
  if (new Date(session.expiresAt) < new Date()) {
    deleteSession(sessionId);
    return null;
  }
  
  return session;
}

function deleteSession(sessionId) {
  return db.prepare('DELETE FROM sessions WHERE sessionId = ?').run(sessionId);
}

function getUserById(userId) {
  return db.prepare('SELECT userId, username, balance FROM users WHERE userId = ?').get(userId);
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
  deleteOrder,
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
