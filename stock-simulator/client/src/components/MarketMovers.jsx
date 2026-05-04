import { useState } from 'react';

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

export default function MarketMovers({ data, onStockClick }) {
  const [activeTab, setActiveTab] = useState('gainers');
  const { gainers = [], losers = [], trending = [] } = data || {};

  const tabs = [
    { key: 'gainers', label: 'Top Gainers', icon: '▲' },
    { key: 'losers', label: 'Top Losers', icon: '▼' },
    { key: 'trending', label: 'Trending', icon: '🔥' }
  ];

  const currentList = activeTab === 'gainers' ? gainers : activeTab === 'losers' ? losers : trending;

  return (
    <section className="market-movers-panel">
      <div className="market-movers__header">
        <div>
          <p className="market-movers__eyebrow">Market pulse</p>
          <h2>Today&apos;s Movers</h2>
          <p className="market-movers__subtitle">Real-time top performers, decliners, and most active stocks.</p>
        </div>
      </div>

      <div className="market-movers__tabs">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`market-movers__tab ${activeTab === tab.key ? 'market-movers__tab--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <span>{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="market-movers__grid">
        {currentList.length === 0 ? (
          <div className="market-movers__empty">Loading market data...</div>
        ) : (
          currentList.map((stock) => {
            const isPositive = (stock.regularMarketChangePercent || 0) >= 0;
            return (
              <div
                key={stock.symbol}
                className="market-mover-card"
                onClick={() => onStockClick?.(stock.yahooSymbol || stock.symbol)}
              >
                <div className="market-mover-card__top">
                  <div className="market-mover-card__avatar">{stock.symbol.slice(0, 1)}</div>
                  <div className="market-mover-card__info">
                    <strong>{stock.symbol}</strong>
                    <span>{stock.shortName || stock.longName || stock.symbol}</span>
                  </div>
                  <div className={`market-mover-card__badge ${isPositive ? 'market-mover-card__badge--up' : 'market-mover-card__badge--down'}`}>
                    {isPositive ? '▲' : '▼'} {Math.abs(stock.regularMarketChangePercent || 0).toFixed(2)}%
                  </div>
                </div>
                <div className="market-mover-card__bottom">
                  <span className="market-mover-card__price">{formatCurrency(stock.regularMarketPrice)}</span>
                  <span className="market-mover-card__vol">
                    Vol: {Number(stock.regularMarketVolume || 0).toLocaleString('en-IN')}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

