-- stocksim_schema.sql
-- Run with: psql -U postgres -d stocksim -f stocksim_schema.sql

CREATE TABLE IF NOT EXISTS users (
    userId UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    balance NUMERIC(15,2) DEFAULT 10000000,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS portfolios (
    id SERIAL PRIMARY KEY,
    userId UUID NOT NULL REFERENCES users(userId) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    qty NUMERIC(15,4) NOT NULL,
    avgPrice NUMERIC(12,2) NOT NULL,
    updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(userId, symbol)
);

CREATE TABLE IF NOT EXISTS watchlists (
    id SERIAL PRIMARY KEY,
    userId UUID NOT NULL REFERENCES users(userId) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    yahooSymbol TEXT NOT NULL,
    name TEXT,
    exchange TEXT,
    createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(userId, symbol)
);

CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    userId UUID NOT NULL REFERENCES users(userId) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    yahooSymbol TEXT,
    action TEXT NOT NULL,
    qty NUMERIC(15,4) NOT NULL,
    price NUMERIC(12,2) NOT NULL,
    total NUMERIC(15,2) NOT NULL,
    orderTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS login_history (
    id SERIAL PRIMARY KEY,
    userId UUID NOT NULL REFERENCES users(userId) ON DELETE CASCADE,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    ipAddress TEXT,
    userAgent TEXT,
    loginTime TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_portfolios_userId ON portfolios(userId);
CREATE INDEX idx_watchlists_userId ON watchlists(userId);
CREATE INDEX idx_orders_userId ON orders(userId);
CREATE INDEX idx_orders_time ON orders(orderTime);
CREATE INDEX idx_login_history_userId ON login_history(userId);
CREATE INDEX idx_login_history_time ON login_history(loginTime);

-- Default test user
INSERT INTO users (username, password, balance) VALUES ('test', '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 10000000) ON CONFLICT DO NOTHING;
