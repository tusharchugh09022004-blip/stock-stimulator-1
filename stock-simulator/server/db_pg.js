const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: 'postgresql://stocksim_user:stocksim123@localhost:5432/stocksim',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.stack);
});

// Test connection
pool.query('SELECT NOW()')
  .then(() => console.log('PostgreSQL connected'))
  .catch((err) => console.error('PostgreSQL connection failed:', err));

const DEFAULT_BALANCE = 10000000;

// User operations
async function getUser(userId) {
  const result = await pool.query('SELECT * FROM users WHERE userId = $1', [userId]);
  return result.rows[0] || null;
}

async function updateUserBalance(userId, balance) {
  const result = await pool.query(
    'UPDATE users SET balance = $1, updatedAt = CURRENT_TIMESTAMP WHERE userId = $2 RETURNING *',
    [balance, userId]
  );
  return result.rowCount > 0;
}

// Portfolio operations
async function getPortfolio(userId) {
  const result = await pool.query('SELECT symbol, qty, avgPrice FROM portfolios WHERE userId = $1', [userId]);
  const portfolio = {};
  for (const pos of result.rows) {
    portfolio[pos.symbol] = {
      qty: parseFloat(pos.qty),
      avgPrice: parseFloat(pos.avgPrice),
    };
  }
  return portfolio;
}

async function updatePortfolio(userId, symbol, qty, avgPrice) {
  if (qty <= 0) {
    await pool.query('DELETE FROM portfolios WHERE userId = $1 AND symbol = $2', [userId, symbol]);
    return;
  }
  
  await pool.query(`
    INSERT INTO portfolios (userId, symbol, qty, avgPrice) 
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (userId, symbol) DO UPDATE SET
      qty = $3, avgPrice = $4, updatedAt = CURRENT_TIMESTAMP
  `, [userId, symbol, qty, avgPrice]);
}

async function clearPortfolioPosition(userId, symbol) {
  await pool.query('DELETE FROM portfolios WHERE userId = $1 AND symbol = $2', [userId, symbol]);
}

// Watchlist operations
async function getWatchlist(userId) {
  const result = await pool.query(`
    SELECT symbol, yahooSymbol, name, exchange 
    FROM watchlists WHERE userId = $1 
    ORDER BY id
  `, [userId]);
  return result.rows;
}

async function addToWatchlist(userId, symbol, yahooSymbol, name, exchange) {
  await pool.query(`
    INSERT INTO watchlists (userId, symbol, yahooSymbol, name, exchange) 
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (userId, symbol) DO NOTHING
  `, [userId, symbol, yahooSymbol, name, exchange]);
}

async function removeFromWatchlist(userId, symbol) {
  await pool.query('DELETE FROM watchlists WHERE userId = $1 AND symbol = $2', [userId, symbol]);
}

// Order operations
async function saveOrder(userId, symbol, yahooSymbol, action, qty, price, total) {
  await pool.query(`
    INSERT INTO orders (userId, symbol, yahooSymbol, action, qty, price, total)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [userId, symbol, yahooSymbol, action, qty, price, total]);
}

async function getOrderHistory(userId, limit = 50) {
  const result = await pool.query(`
    SELECT * FROM orders WHERE userId = $1 
    ORDER BY orderTime DESC LIMIT $2
  `, [userId, limit]);
  return result.rows;
}

async function deleteOrderHistoryRecord(orderId, userId) {
  const result = await pool.query(
    'DELETE FROM orders WHERE id = $1 AND userId = $2 RETURNING *',
    [orderId, userId]
  );
  return { changes: result.rowCount };
}

async function deleteAllOrders(userId) {
  const result = await pool.query('DELETE FROM orders WHERE userId = $1 RETURNING *', [userId]);
  return { changes: result.rowCount };
}

// Auth operations
async function createUser(username, password) {
  const userId = crypto.randomUUID();
  const hashedPassword = bcrypt.hashSync(password, 10);
  
  try {
    await pool.query(`
      INSERT INTO users (userId, username, password, balance)
      VALUES ($1, $2, $3, $4)
    `, [userId, username, hashedPassword, DEFAULT_BALANCE]);
    return { userId, username, balance: DEFAULT_BALANCE };
  } catch (err) {
    if (err.code === '23505') { // unique violation
      return null;
    }
    throw err;
  }
}

async function verifyUser(username, password) {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  const user = result.rows[0];
  if (!user) return null;
  
  const passwordMatch = bcrypt.compareSync(password, user.password);
  return passwordMatch ? user : null;
}

async function getUserByUsername(username) {
  const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
  return result.rows[0];
}

async function saveLoginHistory(userId, username, action, ipAddress, userAgent) {
  await pool.query(`
    INSERT INTO login_history (userId, username, action, ipAddress, userAgent)
    VALUES ($1, $2, $3, $4, $5)
  `, [userId, username, action, ipAddress || null, userAgent || null]);
}

async function getLoginHistory(userId, limit = 50) {
  const safeLimit = Math.max(1, Math.min(200, limit));
  const result = await pool.query(`
    SELECT id, userId, username, action, ipAddress, userAgent, loginTime
    FROM login_history WHERE userId = $1
    ORDER BY loginTime DESC LIMIT $2
  `, [userId, safeLimit]);
  return result.rows;
}

async function getUserById(userId) {
  const result = await pool.query('SELECT userId, username, balance FROM users WHERE userId = $1', [userId]);
  return result.rows[0];
}

module.exports = {
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
  getUserById,
};

