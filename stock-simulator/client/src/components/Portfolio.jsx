import { useState } from 'react';
import axios from 'axios';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const formatPercent = (value) => `${value >= 0 ? '+' : '-'}${Math.abs(value || 0).toFixed(2)}%`;

export default function Portfolio({ data, onRefresh }) {
  const [sortBy, setSortBy] = useState('symbol');
  const [sortDir, setSortDir] = useState('asc');
  const [filter, setFilter] = useState('all');
  const [sellQty, setSellQty] = useState({});
  const [returnMode, setReturnMode] = useState('total');

  const entries = Object.entries(data ?? {});
  const totalValue = entries.reduce((sum, [, pos]) => sum + ((pos.qty || 0) * (pos.currentPrice || 0)), 0);
  const totalInvested = entries.reduce((sum, [, pos]) => sum + ((pos.qty || 0) * (pos.avgPrice || 0)), 0);
  const totalPnL = totalValue - totalInvested;
  const totalPnLPercent = totalInvested ? ((totalValue / totalInvested - 1) * 100) : 0;

  const pieData = entries
    .map(([symbol, pos]) => ({
      name: symbol,
      value: (pos.qty || 0) * (pos.currentPrice || 0),
      pnlPercent: pos.pnlPercent || 0
    }))
    .filter((item) => item.value > 0);

  const colors = pieData.map((item) => (item.pnlPercent >= 0 ? '#22c55e' : '#f97316'));

  let sortedData = [...entries];
  if (filter === 'gainers') {
    sortedData = sortedData.filter(([, pos]) =>
      returnMode === 'total' ? (pos.pnlPercent || 0) >= 0 : (pos.dayChangePercent || 0) >= 0
    );
  }
  if (filter === 'losers') {
    sortedData = sortedData.filter(([, pos]) =>
      returnMode === 'total' ? (pos.pnlPercent || 0) < 0 : (pos.dayChangePercent || 0) < 0
    );
  }

  sortedData.sort(([aSymbol, aPos], [bSymbol, bPos]) => {
    const direction = sortDir === 'asc' ? 1 : -1;

    if (sortBy === 'symbol') {
      return aSymbol.localeCompare(bSymbol) * direction;
    }

    const aValueMap = {
      qty: aPos.qty || 0,
      avgPrice: aPos.avgPrice || 0,
      currentPrice: aPos.currentPrice || 0,
      value: (aPos.qty || 0) * (aPos.currentPrice || 0),
      pnl: aPos.pnl || 0,
      pnlPercent: aPos.pnlPercent || 0,
      dayChangePercent: aPos.dayChangePercent || 0
    };

    const bValueMap = {
      qty: bPos.qty || 0,
      avgPrice: bPos.avgPrice || 0,
      currentPrice: bPos.currentPrice || 0,
      value: (bPos.qty || 0) * (bPos.currentPrice || 0),
      pnl: bPos.pnl || 0,
      pnlPercent: bPos.pnlPercent || 0,
      dayChangePercent: bPos.dayChangePercent || 0
    };

    return ((aValueMap[sortBy] || 0) - (bValueMap[sortBy] || 0)) * direction;
  });

  const holdings = sortedData.length;
  const totalQty = entries.reduce((sum, [, pos]) => sum + (pos.qty || 0), 0);
  const performanceTone = totalPnL >= 0 ? 'positive' : 'negative';

  const handleSort = (key) => {
    if (sortBy === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(key);
      setSortDir('asc');
    }
  };

  const handleReturnSort = () => {
    const nextMode = returnMode === 'total' ? '1d' : 'total';
    setReturnMode(nextMode);
    setSortBy(nextMode === 'total' ? 'pnlPercent' : 'dayChangePercent');
    setSortDir('desc');
  };

  const handleQuickSell = async (symbol, qtyToSell) => {
    try {
      await axios.post('/api/trade', {
        userId: 'default',
        symbol,
        action: 'sell',
        qty: qtyToSell,
        price: data[symbol].currentPrice
      });
      await onRefresh?.();
    } catch (err) {
      alert('Sell failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const getSellQty = (symbol, maxQty) => {
    const value = Number(sellQty[symbol]);
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.min(value, maxQty || 1);
  };

  const updateSellQty = (symbol, value, maxQty) => {
    const parsed = Number(value);
    setSellQty((prev) => ({
      ...prev,
      [symbol]: Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maxQty || 1) : 1
    }));
  };

  const sortMarker = (key) => (sortBy === key ? (sortDir === 'asc' ? '↑' : '↓') : '');

  return (
    <aside className="portfolio-panel">
      <div className="portfolio-hero">
        <div className="portfolio-hero__badge">Portfolio Hub</div>
        <div className="portfolio-hero__header">
          <div>
            <p className="portfolio-eyebrow">Live holdings overview</p>
            <h2 className="portfolio-title">My Portfolio</h2>
            <p className="portfolio-subtitle">{holdings} active holdings tracked in real time</p>
          </div>
          <div className={`portfolio-performance portfolio-performance--${performanceTone}`}>
            <span className="portfolio-performance__label">Net return</span>
            <strong>{formatPercent(totalPnLPercent)}</strong>
          </div>
        </div>

        <div className="portfolio-value-card">
          <div>
            <p className="portfolio-value-card__label">Current value</p>
            <p className="portfolio-value-card__amount">{formatCurrency(totalValue)}</p>
          </div>
          <div className="portfolio-value-card__delta">
            <span>{totalPnL >= 0 ? 'UPSIDE' : 'DRAWDOWN'}</span>
            <strong>{formatCurrency(Math.abs(totalPnL))}</strong>
          </div>
        </div>
      </div>

      <div className="portfolio-stats">
        <div className="portfolio-stat">
          <span className="portfolio-stat__label">Invested</span>
          <strong className="portfolio-stat__value">{formatCurrency(totalInvested)}</strong>
        </div>
        <div className={`portfolio-stat portfolio-stat--${performanceTone}`}>
          <span className="portfolio-stat__label">Profit &amp; loss</span>
          <strong className="portfolio-stat__value">
            {totalPnL >= 0 ? '+' : '-'}{formatCurrency(Math.abs(totalPnL))}
          </strong>
        </div>
        <div className="portfolio-stat">
          <span className="portfolio-stat__label">Total units</span>
          <strong className="portfolio-stat__value">{totalQty}</strong>
        </div>
      </div>

      {pieData.length > 0 && (
        <section className="portfolio-allocation">
          <div className="portfolio-section-heading">
            <div>
              <p className="portfolio-section-heading__eyebrow">Diversification</p>
              <h3>Allocation mix</h3>
            </div>
          </div>
          <div className="portfolio-allocation__body">
            <div className="portfolio-allocation__chart">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={42}
                    outerRadius={68}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                  >
                    {pieData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value) => formatCurrency(value)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="portfolio-allocation__legend">
              {pieData.slice(0, 4).map((item, index) => (
                <div key={item.name} className="portfolio-legend-item">
                  <span className="portfolio-legend-item__dot" style={{ backgroundColor: colors[index % colors.length] }}></span>
                  <div>
                    <strong>{item.name}</strong>
                    <span>{formatCurrency(item.value)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="portfolio-holdings-card">
        <div className="portfolio-section-heading portfolio-section-heading--row">
          <div>
            <p className="portfolio-section-heading__eyebrow">Portfolio holdings</p>
            <h3>Your positions</h3>
          </div>
          <div className="portfolio-toolbar">
            <span className="portfolio-toolbar__count">{holdings} active</span>
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="portfolio-filter"
            >
              <option value="all">All</option>
              <option value="gainers">Gainers</option>
              <option value="losers">Losers</option>
            </select>
          </div>
        </div>

        {holdings === 0 ? (
          <div className="portfolio-empty">
            <div className="portfolio-empty__orb"></div>
            <div className="portfolio-empty__icon">↗</div>
            <h3>Build your first position</h3>
            <p>Search a stock on the left and start with one focused trade. This panel will then turn into your live performance dashboard.</p>
            <div className="portfolio-empty__highlights">
              <span>Live P&amp;L</span>
              <span>Quick exits</span>
              <span>Allocation tracking</span>
            </div>
            <button className="portfolio-empty-cta">Buy First Stock</button>
          </div>
        ) : (
          <div className="portfolio-table-wrap">
            <table className="portfolio-table">
              <thead>
                <tr>
                  <th onClick={() => handleSort('symbol')}>Symbol {sortMarker('symbol')}</th>
                  <th onClick={() => handleSort('qty')}>Qty {sortMarker('qty')}</th>
                  <th onClick={() => handleSort('avgPrice')}>Avg {sortMarker('avgPrice')}</th>
                  <th onClick={() => handleSort('currentPrice')}>Current {sortMarker('currentPrice')}</th>
                  <th onClick={() => handleSort('value')}>Value {sortMarker('value')}</th>
                  <th onClick={() => handleSort('pnl')}>P&amp;L {sortMarker('pnl')}</th>
                  <th onClick={handleReturnSort}>Return {returnMode === 'total' ? '(Total)' : '(1D)'} {sortMarker(sortBy)}</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sortedData.map(([symbol, pos]) => {
                  const returnValue = returnMode === 'total' ? (pos.pnlPercent || 0) : (pos.dayChangePercent || 0);
                  const returnPositive = returnValue >= 0;
                  const selectedSellQty = getSellQty(symbol, pos.qty || 1);
                  return (
                    <tr key={symbol}>
                      <td data-label="Symbol">
                        <div className="portfolio-symbol">
                          <span className="portfolio-symbol__avatar">{symbol.slice(0, 1)}</span>
                          <div>
                            <strong>{symbol}</strong>
                            <span>{returnPositive ? 'Momentum up' : 'Pressure down'}</span>
                          </div>
                        </div>
                      </td>
                      <td data-label="Qty">{pos.qty || 0}</td>
                      <td data-label="Avg">{formatCurrency(pos.avgPrice || 0)}</td>
                      <td data-label="Current">{formatCurrency(pos.currentPrice || 0)}</td>
                      <td data-label="Value">{formatCurrency((pos.qty || 0) * (pos.currentPrice || 0))}</td>
                      <td data-label="P&L">
                        <span className={`portfolio-pill portfolio-pill--${returnPositive ? 'positive' : 'negative'}`}>
                          {returnPositive ? '+' : '-'}{formatCurrency(Math.abs(pos.pnl || 0))}
                        </span>
                      </td>
                      <td data-label="Return">
                        <span className={`portfolio-pill portfolio-pill--${returnPositive ? 'positive' : 'negative'}`}>
                          {formatPercent(returnValue)}
                        </span>
                      </td>
                      <td data-label="Action">
                        <div className="portfolio-sell-action">
                          <input
                            type="number"
                            min="1"
                            max={pos.qty || 1}
                            value={selectedSellQty}
                            onChange={(e) => updateSellQty(symbol, e.target.value, pos.qty || 1)}
                            className="portfolio-sell-input"
                          />
                          <button className="portfolio-sell-btn" onClick={() => handleQuickSell(symbol, selectedSellQty)}>
                            Sell
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="portfolio-summary">
              <span>Total exposure</span>
              <strong>{formatCurrency(totalValue)}</strong>
            </div>
          </div>
        )}
      </section>
    </aside>
  );
}

