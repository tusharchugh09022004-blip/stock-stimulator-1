import { Component, useEffect, useMemo, useRef, useState } from 'react';
import io from 'socket.io-client';
import axios from 'axios';
import { useToast } from './components/Toast.jsx';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

import Auth from './components/Auth';
import Portfolio from './components/Portfolio';
import MarketMovers from './components/MarketMovers';
import OrderHistory from './components/OrderHistory';
import PnlCalendar from './components/PnlCalendar';
import TradeHistory from './components/TradeHistory';
import Settings from './components/Settings';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import NiftyOptionsPage from './components/NiftyOptionsPage';
import SensexOptionsPage from './components/SensexOptionsPage';
import OptionContractPage from './components/OptionContractPage';

const API_URL = import.meta.env.VITE_API_URL || '';

axios.defaults.baseURL = API_URL;
axios.defaults.timeout = 15000;

const CHART_RANGES = ['1d', '1w', '1m', '3m', '1y'];

// Setup axios interceptor to add auth token
const setupAuthInterceptor = (token) => {
  if (token) {
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  } else {
    delete axios.defaults.headers.common['Authorization'];
  }
};

// Initialize auth interceptor if token exists
const savedToken = localStorage.getItem('token');
if (savedToken) {
  setupAuthInterceptor(savedToken);
}

const popularStocks = [
  { symbol: 'RELIANCE', name: 'Reliance Industries' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank' },
  { symbol: 'TCS', name: 'Tata Consultancy Services' },
  { symbol: 'INFY', name: 'Infosys' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank' },
  { symbol: 'SBIN', name: 'State Bank of India' },
  { symbol: 'ITC', name: 'ITC' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel' }
];

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const formatCompactCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    maximumFractionDigits: 0
  })}`;

function TrendTooltip({ active, payload }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;

  return (
    <div className="trend-tooltip">
      <strong>{point.label}</strong>
      <span>Open: {formatCurrency(point.open)}</span>
      <span>High: {formatCurrency(point.high)}</span>
      <span>Low: {formatCurrency(point.low)}</span>
      <span>Close: {formatCurrency(point.close)}</span>
    </div>
  );
}

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center', fontFamily: 'sans-serif' }}>
          <h2>Something went wrong</h2>
          <p style={{ color: 'var(--text-secondary)' }}>An unexpected error occurred. Please try refreshing the page.</p>
          <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
            style={{ padding: '0.5rem 1.5rem', marginTop: '1rem', cursor: 'pointer' }}>
            Refresh Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const addToast = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));
  const [user, setUser] = useState({
    userId: localStorage.getItem('userId'),
    username: localStorage.getItem('username')
  });
  
  const [userData, setUserData] = useState({ balance: 10000000, portfolio: {} });
  const [stocks, setStocks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [watchlist, setWatchlist] = useState([]);
  const [tradeQty, setTradeQty] = useState({});
  const [chartRange, setChartRange] = useState('1d');
  const [chartData, setChartData] = useState([]);
  const [chartMeta, setChartMeta] = useState(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [indexData, setIndexData] = useState({ nifty: null, sensex: null });
  const [indexChartRange, setIndexChartRange] = useState('1d');
  const [indexChartData, setIndexChartData] = useState({ nifty: { data: [], meta: null, loading: false }, sensex: { data: [], meta: null, loading: false } });
const [marketMovers, setMarketMovers] = useState({ gainers: [], losers: [], trending: [] });
  const [showSettings, setShowSettings] = useState(false);
  const [currentPage, setCurrentPage] = useState('dashboard'); // dashboard, niftyOptions, sensexOptions, optionDetails
  const [currentOptionChain, setCurrentOptionChain] = useState(null); // 'NIFTY' or 'SENSEX'
  const [selectedContract, setSelectedContract] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  const [upstoxConnected, setUpstoxConnected] = useState(false);
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);
  const searchRef = useRef(null);

  const activeStock = stocks[0] || null;
  const chartPositive = useMemo(() => (chartMeta?.changePercent ?? 0) >= 0, [chartMeta]);

  const refreshPortfolioData = async () => {
    if (!user.userId) return;
    
    try {
      const [portfolioRes, watchlistRes] = await Promise.all([
        axios.get(`/api/portfolio/${user.userId}`),
        axios.get(`/api/watchlist/${user.userId}`)
      ]);
      setUserData(portfolioRes.data);
      setWatchlist(watchlistRes.data);
    } catch (err) {
      if (err.response?.status === 401) {
        // Token expired or invalid
        handleLogout();
      } else {
        console.error('Failed to fetch dashboard:', err);
      }
    }
  };

  const handleAuthSuccess = (authData) => {
    setupAuthInterceptor(authData.token);
    setUser({
      userId: authData.userId,
      username: authData.username
    });
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    localStorage.removeItem('username');
    delete axios.defaults.headers.common['Authorization'];
    setIsAuthenticated(false);
    setUser({ userId: null, username: null });
    setUserData({ balance: 10000000, portfolio: {} });
    setWatchlist([]);
  };

  useEffect(() => {
    if (!isAuthenticated) return;

    const s = io(API_URL || undefined);

    s.on('userUpdate', (data) => {
      if (data?.userId === user.userId) {
        setUserData((prev) => ({ ...prev, ...data }));
      }
    });
    s.on('watchlistUpdate', (payload) => {
      if (payload?.userId === user.userId) {
        setWatchlist(payload.watchlist || []);
      }
    });

    refreshPortfolioData().catch((err) => console.error('Failed to fetch dashboard:', err));

    return () => {
      s.off('userUpdate');
      s.off('watchlistUpdate');
      s.close();
    };
  }, [isAuthenticated, user.userId]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSuggestions([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await axios.get('/api/search', { params: { q: query } });
        setSuggestions(res.data || []);
      } catch (err) {
        console.error('Suggestion fetch failed:', err);
        setSuggestions([]);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (!activeStock?.yahooSymbol && !activeStock?.symbol) {
      setChartData([]);
      setChartMeta(null);
      return undefined;
    }

    let cancelled = false;

    const loadChart = async () => {
      try {
        setChartLoading(true);
        const res = await axios.get(`/api/chart/${encodeURIComponent(activeStock.yahooSymbol || activeStock.symbol)}`, {
          params: { range: chartRange }
        });

        if (!cancelled) {
          setChartData(res.data.points || []);
          setChartMeta(res.data);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Chart fetch failed:', err);
          setChartData([]);
          setChartMeta(null);
        }
      } finally {
        if (!cancelled) setChartLoading(false);
      }
    };

    loadChart();
    return () => {
      cancelled = true;
    };
  }, [activeStock?.yahooSymbol, activeStock?.symbol, chartRange]);

  useEffect(() => {
    if (!activeStock?.yahooSymbol && !activeStock?.symbol) return undefined;

    const refreshQuote = async () => {
      try {
        const res = await axios.get(`/api/quote/${encodeURIComponent(activeStock.yahooSymbol || activeStock.symbol)}`);
        setStocks([res.data]);
      } catch (err) {
        console.error('Quote refresh failed:', err);
      }
    };

    const intervalId = setInterval(refreshQuote, 3000);
    return () => clearInterval(intervalId);
  }, [activeStock?.yahooSymbol, activeStock?.symbol]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      refreshPortfolioData().catch((err) => console.error('Dashboard refresh failed:', err));
    }, 10000);
    return () => clearInterval(intervalId);
  }, []);

  // Fast options P&L refresh every 3s (merges into portfolio without touching equities)
  useEffect(() => {
    if (!user.userId) return;
    const fetchOptionsLive = async () => {
      try {
        const res = await axios.get(`/api/options/portfolio/live/${user.userId}`);
        setUserData(prev => ({
          ...prev,
          portfolio: { ...prev.portfolio, ...res.data }
        }));
      } catch (_) {}
    };
    fetchOptionsLive();
    const id = setInterval(fetchOptionsLive, 3000);
    return () => clearInterval(id);
  }, [user.userId]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setSuggestions([]);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle Upstox OAuth callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const upstoxStatus = params.get('upstox');
    if (upstoxStatus === 'success') {
      addToast({ type: 'success', message: 'Upstox connected successfully! Option chain prices will now be live.' });
      setUpstoxConnected(true);
      window.history.replaceState({}, '', window.location.pathname);
    } else if (upstoxStatus === 'error') {
      addToast({ type: 'error', message: params.get('message') || 'Upstox authentication failed' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Fetch Upstox connection status
  useEffect(() => {
    if (!isAuthenticated) return;
    const fetchUpstoxStatus = async () => {
      try {
        const res = await axios.get('/auth/upstox/status');
        setUpstoxConnected(res.data.authenticated);
      } catch (_) {}
    };
    fetchUpstoxStatus();
  }, [isAuthenticated]);

  // Live Index refresh
  useEffect(() => {
    const fetchIndexQuote = async (symbol, key) => {
      try {
        const res = await axios.get(`/api/quote/${encodeURIComponent(symbol)}`);
        setIndexData((prev) => ({ ...prev, [key]: res.data }));
      } catch (err) {
        console.error(`${key} quote fetch failed:`, err.message);
      }
    };

    fetchIndexQuote('^NSEI', 'nifty');
    fetchIndexQuote('^BSESN', 'sensex');

    const intervalId = setInterval(() => {
      fetchIndexQuote('^NSEI', 'nifty');
      fetchIndexQuote('^BSESN', 'sensex');
    }, 3000);
    return () => clearInterval(intervalId);
  }, []);

  // Load Index Chart Data
  useEffect(() => {
    let cancelled = false;

    const loadIndexChart = async (symbol, indexKey) => {
      try {
        setIndexChartData(prev => ({
          ...prev,
          [indexKey]: { ...prev[indexKey], loading: true }
        }));

        const res = await axios.get(`/api/chart/${encodeURIComponent(symbol)}`, {
          params: { range: indexChartRange }
        });

        if (!cancelled) {
          setIndexChartData(prev => ({
            ...prev,
            [indexKey]: {
              data: res.data.points || [],
              meta: res.data,
              loading: false
            }
          }));
        }
      } catch (err) {
        if (!cancelled) {
          console.error(`${indexKey} chart fetch failed:`, err);
          setIndexChartData(prev => ({
            ...prev,
            [indexKey]: { data: [], meta: null, loading: false }
          }));
        }
      }
    };

    loadIndexChart('^NSEI', 'nifty');
    loadIndexChart('^BSESN', 'sensex');

    return () => { cancelled = true; };
  }, [indexChartRange]);

  // Market Movers
  useEffect(() => {
    let cancelled = false;

    const fetchMovers = async () => {
      try {
        const res = await axios.get('/api/market-movers');
        if (!cancelled) setMarketMovers(res.data);
      } catch (err) {
        console.error('Market movers fetch failed:', err);
      }
    };

    fetchMovers();
    const intervalId = setInterval(fetchMovers, 15000);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, []);

  const getTradeQty = (symbol) => {
    const val = tradeQty[symbol];
    return val !== undefined ? val : '10';
  };

  const setTradeQtyForSymbol = (symbol, value) => {
    setTradeQty((prev) => ({
      ...prev,
      [symbol]: value
    }));
  };

  const loadStock = async (queryOrSymbol) => {
    const value = String(queryOrSymbol || '').trim();
    if (!value) {
      setStocks([]);
      setChartData([]);
      setChartMeta(null);
      return;
    }

    try {
      const res = await axios.get(`/api/quote/${encodeURIComponent(value)}`);
      setStocks([res.data]);
      setSearchQuery(res.data.symbol || value);
      setSuggestions([]);
      setChartRange('1d');
    } catch (err) {
      console.error('Stock load failed:', err);
      setStocks([]);
      setChartData([]);
      setChartMeta(null);
      addToast({ type: 'error', message: err.response?.data?.error || 'Unable to find that stock' });
    }
  };

  const handleTrade = async (action, stock) => {
    const qty = Math.max(1, Number(getTradeQty(stock.symbol) || 0));

    try {
      await axios.post('/api/trade', {
        symbol: stock.symbol,
        action,
        qty,
        price: stock.regularMarketPrice
      });

      const [_, quoteRes] = await Promise.all([
        refreshPortfolioData(),
        axios.get(`/api/quote/${encodeURIComponent(stock.yahooSymbol || stock.symbol)}`)
      ]);

      setStocks([quoteRes.data]);
    } catch (err) {
      addToast({ type: 'error', message: err.response?.data?.error || 'Trade failed' });
    }
  };

  const addToWatchlist = async (stock) => {
    try {
      const res = await axios.post('/api/watchlist', {
        symbol: stock.yahooSymbol || stock.symbol
      });
      setWatchlist(res.data || []);
    } catch (err) {
      addToast({ type: 'error', message: err.response?.data?.error || 'Failed to add to watchlist' });
    }
  };

  const removeFromWatchlist = async (symbol) => {
    try {
      const res = await axios.delete(`/api/watchlist/${user.userId}/${encodeURIComponent(symbol)}`);
      setWatchlist(res.data || []);
    } catch (err) {
      addToast({ type: 'error', message: err.response?.data?.error || 'Failed to remove from watchlist' });
    }
  };

  const inWatchlist = (symbol) => watchlist.some((item) => item.symbol === symbol);

  const handleBalanceUpdate = (newBalance) => {
    setUserData((prev) => ({ ...prev, balance: newBalance }));
  };

  const handleOptionClick = (optionData) => {
    setSelectedContract(optionData);
    setCurrentPage('optionDetails');
  };

  const handleOptionTrade = async (tradeData) => {
    try {
      const lotSize = tradeData.index === 'SENSEX' ? 20 : 65;
      const contracts = tradeData.quantity * lotSize;
      const totalValue = contracts * tradeData.premium;

      await axios.post('/api/options/trade', {
        contract: tradeData.contract,
        action: tradeData.action,
        quantity: contracts,
        premium: tradeData.premium,
        strike: tradeData.strike,
        type: tradeData.type,
        index: tradeData.index,
        expiry: tradeData.expiry
      });

      // Refresh portfolio data to get updated balance
      await refreshPortfolioData();
      
      addToast({ type: 'success', message: `${tradeData.action.toUpperCase()} ${tradeData.quantity} Lot(s) of ${tradeData.contract} — Total: ${formatCurrency(totalValue)}` });
    } catch (err) {
      addToast({ type: 'error', message: err.response?.data?.error || 'Options trade failed' });
    }
  };

  const handleNiftyOptionsClick = () => {
    setCurrentOptionChain('NIFTY');
    setCurrentPage('niftyOptions');
  };

  const handleSensexOptionsClick = () => {
    setCurrentOptionChain('SENSEX');
    setCurrentPage('sensexOptions');
  };

  const handleBackToDashboard = () => {
    setCurrentPage('dashboard');
    setCurrentOptionChain(null);
    setSelectedContract(null);
  };

  const handleBackToOptionChain = () => {
    setCurrentPage(currentOptionChain === 'NIFTY' ? 'niftyOptions' : 'sensexOptions');
    setSelectedContract(null);
  };

  if (!isAuthenticated) {
    return <ErrorBoundary><Auth onAuthSuccess={handleAuthSuccess} /></ErrorBoundary>;
  }

  // Render full-screen options pages
  if (currentPage === 'niftyOptions') {
    return <ErrorBoundary><NiftyOptionsPage onBack={handleBackToDashboard} onOptionClick={handleOptionClick} /></ErrorBoundary>;
  }

  if (currentPage === 'sensexOptions') {
    return <ErrorBoundary><SensexOptionsPage onBack={handleBackToDashboard} onOptionClick={handleOptionClick} /></ErrorBoundary>;
  }

  if (currentPage === 'optionDetails' && selectedContract) {
    return (
      <ErrorBoundary>
        <OptionContractPage 
          contractData={selectedContract}
          onBack={handleBackToOptionChain}
          onTrade={handleOptionTrade}
        />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
    <div className="app-shell">
      <Sidebar active={currentPage} onNavigate={setCurrentPage} onSettingsOpen={() => setShowSettings(true)} />
      <div className="app-main">
        <TopBar
          theme={theme}
          onThemeChange={setTheme}
          searchQuery={searchQuery}
          onSearchChange={(v) => { setSearchQuery(v); }}
          suggestions={suggestions}
          onSelectStock={(s) => loadStock(s.yahooSymbol || s.symbol)}
          searchRef={searchRef}
          balance={userData.balance}
          username={user.username}
          onSettingsOpen={() => setShowSettings(true)}
          onLogout={handleLogout}
          onUpstox={async () => { try { const res = await axios.get('/api/auth/upstox'); const url = new URL(res.data.url); url.searchParams.set('state', user.userId); window.open(url.toString(), '_blank'); } catch (e) { addToast({ type: 'error', message: 'Failed to get Upstox auth URL' }); } }}
          upstoxConnected={upstoxConnected}
        />

      <main className="content-shell">
        <section className="search-panel">
          <div className="search-panel__header">
            <div>
              <p className="search-panel__eyebrow">Discover Indian stocks</p>
              <h2>Search any NSE or BSE stock</h2>
            </div>
            <div className="search-panel__status">Prices are source-dependent and refresh automatically.</div>
          </div>

          <div className="search-container">
            <div className="search-layout">
              <div className="search-input-wrapper search-layout__input" ref={searchRef}>
                <input
                  type="text"
                  placeholder="Search by company name or symbol, e.g. RELIANCE, HDFC Bank, TCS"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') loadStock(searchQuery);
                  }}
                  autoComplete="off"
                  className="search-input"
                />

                {suggestions.length > 0 && (
                  <div className="suggestions-dropdown">
                    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '4px 8px 0' }}>
                      <button
                        onClick={() => { setSearchQuery(''); setSuggestions([]); }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: 'var(--text-muted)', padding: '2px 6px' }}
                        title="Close"
                      >
                        ✕
                      </button>
                    </div>
                    {suggestions.map((suggestion) => (
                      <div
                        key={suggestion.yahooSymbol || suggestion.symbol}
                        className="suggestion-item"
                        onClick={() => loadStock(suggestion.yahooSymbol || suggestion.symbol)}
                      >
                        <div className="search-suggestion__dot"></div>
                        <div>
                          <div className="search-suggestion__symbol">{suggestion.symbol}</div>
                          <div className="search-suggestion__name">{suggestion.name}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button onClick={() => loadStock(searchQuery)} className="search-btn search-layout__button">
                Search
              </button>
            </div>

            <div className="popular-strip">
              {popularStocks.map((stock) => (
                <button key={stock.symbol} className="popular-chip" onClick={() => loadStock(stock.symbol)}>
                  {stock.symbol}
                </button>
              ))}
            </div>
          </div>
        </section>

        <div className="dashboard-grid">
          <section className="dashboard-main">
            <div className="market-panel">
              <div className="market-panel__hero">
                <div>
                  <p className="market-panel__eyebrow">Trading desk</p>
                  <h2 className="market-panel__title">Market Results</h2>
                  <p className="market-panel__subtitle">Search for stocks, inspect momentum, and place your next simulated trade.</p>
                </div>
                <div className="market-panel__badge">Live quotes</div>
              </div>

              <div className="market-panel__body">
                {!activeStock ? (
                  <div className="market-empty">
                    <div className="market-empty__icon">⌕</div>
                    <h3>Pick a stock to start</h3>
                    <p>Use the search above to bring up a live quote, review price movement, and place a quick virtual trade.</p>
                    <div className="market-empty__chips">
                      <span>Search by company name</span>
                      <span>Live price refresh</span>
                      <span>Quick buy and sell</span>
                    </div>
                    <button onClick={() => loadStock('RELIANCE')} className="market-empty__cta">
                      Try Searching "RELIANCE"
                    </button>
                  </div>
                ) : (
                  <div className="market-results-list">
                    {stocks.map((stock) => {
                      const rawQty = getTradeQty(stock.symbol);
                      const effectiveQty = Math.max(1, Number(rawQty || 0));
                      const tradeValue = effectiveQty * (stock.regularMarketPrice || 0);
                      const isPositive = (stock.regularMarketChangePercent || 0) >= 0;

                      return (
                        <article key={stock.yahooSymbol || stock.symbol} className="market-stock-card">
                          <div className="market-stock-card__top">
                            <div>
                              <div className="market-stock-card__tag">{stock.exchange || 'Indian Market'}</div>
                              <h3 className="market-stock-card__symbol">{stock.symbol}</h3>
                              <p className="market-stock-card__company">{stock.longName || stock.shortName}</p>
                              <p className="market-stock-card__label">Current market price</p>
                            </div>
                            <div className="market-stock-card__price-block">
                              <p className="market-stock-card__price">{formatCurrency(stock.regularMarketPrice)}</p>
                              <p className={`market-stock-card__change market-stock-card__change--${isPositive ? 'positive' : 'negative'}`}>
                                {isPositive ? '▲' : '▼'} {Math.abs(stock.regularMarketChangePercent || 0).toFixed(2)}%
                              </p>
                            </div>
                          </div>

                          <div className="market-stock-card__metrics">
                            <div className="market-metric market-metric--input">
                              <label className="market-metric__label" htmlFor={`qty-${stock.symbol}`}>Quantity</label>
                              <input
                                id={`qty-${stock.symbol}`}
                                type="number"
                                min="1"
                                value={rawQty}
                                onChange={(e) => setTradeQtyForSymbol(stock.symbol, e.target.value)}
                                className="market-qty-input"
                              />
                            </div>
                            <div className="market-metric market-metric--buy">
                              <p className="market-metric__label">Buy cost</p>
                              <p className="market-metric__value">{formatCompactCurrency(tradeValue)}</p>
                            </div>
                            <div className="market-metric market-metric--sell">
                              <p className="market-metric__label">Sell value</p>
                              <p className="market-metric__value">{formatCompactCurrency(tradeValue)}</p>
                            </div>
                          </div>

                          <div className="market-stock-card__footer">
                            <div className="market-stock-card__note">
                              Executing <strong>{effectiveQty}</strong> shares at <strong>{formatCurrency(stock.regularMarketPrice)}</strong>
                            </div>
                            <div className="market-stock-card__actions">
                              <button
                                className={`market-action-btn market-action-btn--watch ${inWatchlist(stock.symbol) ? 'market-action-btn--watch-active' : ''}`}
                                onClick={() => addToWatchlist(stock)}
                                disabled={inWatchlist(stock.symbol)}
                              >
                                {inWatchlist(stock.symbol) ? 'In Watchlist' : 'Add to Watchlist'}
                              </button>
                              <button className="market-action-btn market-action-btn--buy" onClick={() => handleTrade('buy', stock)}>
                                Buy Shares
                              </button>
                              <button className="market-action-btn market-action-btn--sell" onClick={() => handleTrade('sell', stock)}>
                                Sell Shares
                              </button>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {activeStock && (
              <section className="trend-panel">
                <div className="trend-panel__header">
                  <div>
                    <p className="trend-panel__eyebrow">Trend analysis</p>
                    <h2>{activeStock.symbol} price history</h2>
                    <p className="trend-panel__subtitle">Interactive range view inspired by financial chart dashboards.</p>
                  </div>
                  <div className="trend-range-switcher">
                    {CHART_RANGES.map((range) => (
                      <button
                        key={range}
                        className={`trend-range-chip ${chartRange === range ? 'trend-range-chip--active' : ''}`}
                        onClick={() => setChartRange(range)}
                      >
                        {range.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="trend-hero">
                  <div>
                    <div className="trend-hero__price">{formatCurrency(chartMeta?.currentPrice || activeStock.regularMarketPrice)}</div>
                    <div className={`trend-hero__change trend-hero__change--${chartPositive ? 'positive' : 'negative'}`}>
                      {chartPositive ? '▲' : '▼'} {Math.abs(chartMeta?.changePercent ?? activeStock.regularMarketChangePercent ?? 0).toFixed(2)}%
                    </div>
                  </div>
                  <div className="trend-stats">
                    <div className="trend-stat">
                      <span>Open</span>
                      <strong>{formatCurrency(chartMeta?.stats?.open)}</strong>
                    </div>
                    <div className="trend-stat">
                      <span>High</span>
                      <strong>{formatCurrency(chartMeta?.stats?.high)}</strong>
                    </div>
                    <div className="trend-stat">
                      <span>Low</span>
                      <strong>{formatCurrency(chartMeta?.stats?.low)}</strong>
                    </div>
                    <div className="trend-stat">
                      <span>Prev Close</span>
                      <strong>{formatCurrency(chartMeta?.previousClose)}</strong>
                    </div>
                  </div>
                </div>

                <div className="trend-chart-shell">
                  {chartLoading ? (
                    <div className="trend-loading">Loading chart...</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={420}>
                      <AreaChart data={chartData} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="trendFillPositive" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#16a34a" stopOpacity={0.38} />
                            <stop offset="95%" stopColor="#16a34a" stopOpacity={0.03} />
                          </linearGradient>
                          <linearGradient id="trendFillNegative" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#ea580c" stopOpacity={0.38} />
                            <stop offset="95%" stopColor="#ea580c" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={24} />
                        <YAxis
                          tick={{ fill: '#64748b', fontSize: 12 }}
                          axisLine={false}
                          tickLine={false}
                          domain={['dataMin - 5', 'dataMax + 5']}
                          tickFormatter={(value) => `₹${Number(value).toFixed(0)}`}
                        />
                        <Tooltip content={<TrendTooltip />} />
                        <ReferenceLine y={chartMeta?.previousClose} stroke="#94a3b8" strokeDasharray="4 4" />
                        <Area
                          type="monotone"
                          dataKey="close"
                          stroke={chartPositive ? '#16a34a' : '#ea580c'}
                          strokeWidth={3}
                          fill={chartPositive ? 'url(#trendFillPositive)' : 'url(#trendFillNegative)'}
                          dot={false}
                          activeDot={{ r: 5, fill: chartPositive ? '#16a34a' : '#ea580c' }}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </section>
            )}
          </section>

          <aside className="dashboard-side">
            <section className="index-panel">
              <div className="index-panel__header">
                <div className="index-panel__title-group">
                  <p className="index-panel__eyebrow">INDIAN INDICES</p>
                  <h3 className="index-panel__heading">Nifty 50 & Sensex Live</h3>
                </div>
                <div className="index-range-switcher">
                  {CHART_RANGES.map((range) => (
                    <button
                      key={range}
                      className={`index-range-chip ${indexChartRange === range ? 'index-range-chip--active' : ''}`}
                      onClick={() => setIndexChartRange(range)}
                    >
                      {range.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              
              {indexData.nifty || indexData.sensex ? (
                <div className="index-grid">
                  {[ { key: 'nifty', data: indexData.nifty, title: 'NIFTY 50', symbol: '^NSEI', color: '#3b82f6' }, { key: 'sensex', data: indexData.sensex, title: 'SENSEX', symbol: '^BSESN', color: '#8b5cf6' } ].map(({ key, data, title, symbol, color }) => {
                    if (!data) return null;
                    const chartMeta = indexChartData[key]?.meta;
                    const chartPoints = indexChartData[key]?.data || [];
                    const chartLoading = indexChartData[key]?.loading || false;
                    const isPositive = (chartMeta?.changePercent ?? data.regularMarketChangePercent ?? 0) >= 0;
                    
                    return (
                      <div key={key} className="index-chart-card">
                        <div className="index-chart-card__header">
                          <h3>{title}</h3>
                          <div className={`index-chart-card__change index-chart-card__change--${isPositive ? 'positive' : 'negative'}`}>
                            {isPositive ? '▲' : '▼'} {Math.abs(chartMeta?.changePercent ?? data.regularMarketChangePercent ?? 0).toFixed(2)}%
                          </div>
                        </div>
                        
                        <div className="index-chart-card__price">{formatCurrency(chartMeta?.currentPrice || data.regularMarketPrice)}</div>
                        
                        <div className="index-chart-card__stats">
                          <div className="index-stat">
                            <span>Open</span>
                            <strong>{formatCurrency(chartMeta?.stats?.open)}</strong>
                          </div>
                          <div className="index-stat">
                            <span>High</span>
                            <strong>{formatCurrency(chartMeta?.stats?.high)}</strong>
                          </div>
                          <div className="index-stat">
                            <span>Low</span>
                            <strong>{formatCurrency(chartMeta?.stats?.low)}</strong>
                          </div>
                        </div>
                        
                        <button 
                          className="index-options-button"
                          onClick={() => key === 'nifty' ? handleNiftyOptionsClick() : handleSensexOptionsClick()}
                        >
                          {key === 'nifty' ? 'NIFTY Options' : 'SENSEX Options'}
                        </button>
                        
                        {chartLoading ? (
                          <div className="index-chart-loading">Loading chart...</div>
                        ) : chartPoints.length > 0 ? (
                          <div className="index-chart-shell">
                            <ResponsiveContainer width="100%" height={250}>
                              <AreaChart data={chartPoints} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                                <defs>
                                  <linearGradient id={`indexFill${key}`} x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={isPositive ? '#16a34a' : '#ea580c'} stopOpacity={0.38} />
                                    <stop offset="95%" stopColor={isPositive ? '#16a34a' : '#ea580c'} stopOpacity={0.03} />
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                                <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={20} />
                                <YAxis
                                  tick={{ fill: '#64748b', fontSize: 11 }}
                                  axisLine={false}
                                  tickLine={false}
                                  domain={['dataMin - 10', 'dataMax + 10']}
                                  tickFormatter={(value) => `₹${Number(value).toFixed(0)}`}
                                />
                                <Tooltip content={<TrendTooltip />} />
                                <Area
                                  type="monotone"
                                  dataKey="close"
                                  stroke={isPositive ? '#16a34a' : '#ea580c'}
                                  strokeWidth={2}
                                  fill={`url(#indexFill${key})`}
                                  dot={false}
                                  activeDot={{ r: 4, fill: isPositive ? '#16a34a' : '#ea580c' }}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        ) : (
                          <div className="index-chart-empty">No chart data available</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="index-loading">Loading indices...</div>
              )}
            </section>
            <section className="watchlist-panel">
              <div className="watchlist-panel__header">
                <div>
                  <p className="watchlist-panel__eyebrow">SAVED IDEAS</p>
                  <h3 className="watchlist-panel__heading">Watchlist</h3>
                </div>
                <span className="watchlist-panel__count">{watchlist.length}</span>
              </div>

              {watchlist.length === 0 ? (
                <div className="watchlist-empty">
                  <p>Add stocks from the market results card to keep a live shortlist here.</p>
                </div>
              ) : (
                <div className="watchlist-list">
                  {watchlist.map((item) => {
                    const positive = (item.regularMarketChangePercent || 0) >= 0;
                    return (
                      <div key={item.yahooSymbol || item.symbol} className="watchlist-item">
                        <button className="watchlist-item__main" onClick={() => loadStock(item.yahooSymbol || item.symbol)}>
                          <div className="watchlist-item__avatar">{item.symbol.slice(0, 1)}</div>
                          <div className="watchlist-item__content">
                            <strong>{item.symbol}</strong>
                            <span>{item.name}</span>
                          </div>
                          <div className="watchlist-item__quote">
                            <strong>{formatCompactCurrency(item.regularMarketPrice)}</strong>
                            <span className={positive ? 'watchlist-item__change watchlist-item__change--positive' : 'watchlist-item__change watchlist-item__change--negative'}>
                              {positive ? '▲' : '▼'} {Math.abs(item.regularMarketChangePercent || 0).toFixed(2)}%
                            </span>
                          </div>
                        </button>
                        <button className="watchlist-item__remove" onClick={() => removeFromWatchlist(item.symbol)}>
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </aside>
        </div>

        <PnlCalendar userId={user.userId} />

        <MarketMovers data={marketMovers} onStockClick={loadStock} />

        <section className="holdings-section" id="portfolio-section">
          <div className="holdings-section__header">
            <div>
              <p className="holdings-section__eyebrow">Dedicated holdings view</p>
              <h2>Your Holdings</h2>
              <p className="holdings-section__subtitle">A wider portfolio section so you can view all position details clearly.</p>
            </div>
          </div>
<Portfolio data={userData.portfolio} onRefresh={refreshPortfolioData} />
        </section>

<div id="orders-section"><OrderHistory userId={user.userId} /></div>

<div id="trade-history-section"><TradeHistory userId={user.userId} /></div>

        {showSettings && (
<Settings 
            userId={user.userId}
            onBalanceChange={handleBalanceUpdate}
            onClose={() => setShowSettings(false)}
            onOrdersCleared={refreshPortfolioData}
          />
        )}
      </main>

      <footer className="app-footer">
        <p>MADE BY TUSHAR CHUGH</p>
      </footer>
      </div>
    </div>
    </ErrorBoundary>
  );
}

export default App;
