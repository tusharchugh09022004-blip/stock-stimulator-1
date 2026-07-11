import { useEffect, useState } from 'react';
import axios from 'axios';

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

function TradeHistory({ userId }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrades = async () => {
      if (!userId) return;
      
      try {
        const res = await axios.get(`/api/trades/${userId}`);
        setTrades(res.data || []);
      } catch (err) {
        console.error('Trade history fetch failed:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchTrades();
  }, [userId]);

  const totalRealizedPnL = trades.reduce((sum, trade) => sum + (Number(trade.realizedPnL) || 0), 0);

  if (loading) {
    return (
      <section className="orders-section">
        <div className="orders-section__header">
          <h2 className="orders-section__headline">CLOSED POSITIONS</h2>
        </div>
        <div className="orders-loading">Loading trade history...</div>
      </section>
    );
  }

  return (
    <section className="orders-section">
      <div className="orders-section__header">
        <div>
          <h2 className="orders-section__headline">CLOSED POSITIONS</h2>
          <p className="orders-section__subtitle">Record of your completed round-trip trades and realized P/L.</p>
        </div>
        <div style={{ textAlign: 'right' }}>
            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Total Realized P/L</p>
            <strong style={{ fontSize: '1.25rem', color: totalRealizedPnL >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {totalRealizedPnL >= 0 ? '+' : ''}{formatCurrency(totalRealizedPnL)}
            </strong>
        </div>
      </div>

      {trades.length === 0 ? (
        <div className="orders-empty">
          <p>No completed trades yet. Close a position to see your realized P/L here.</p>
        </div>
      ) : (
        <div className="orders-list">
          <div className="orders-table-header" style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr 1fr 1fr 1fr 1fr 1.5fr', gap: '1rem', padding: '1rem', background: 'var(--bg-hover)', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>
            <span className="orders-col-highlight">Date & Time</span>
            <span className="orders-col-highlight">Instrument</span>
            <span className="orders-col-highlight">Type</span>
            <span className="orders-col-highlight">Qty</span>
            <span className="orders-col-highlight">Avg Entry</span>
            <span className="orders-col-highlight">Exit Price</span>
            <span className="orders-col-highlight">Realized P/L</span>
          </div>
          {trades.map((trade, index) => (
            <div key={trade.id || index} className="orders-table-row" style={{ display: 'grid', gridTemplateColumns: '1.5fr 2fr 1fr 1fr 1fr 1fr 1.5fr', gap: '1rem', padding: '1rem', borderBottom: '1px solid var(--border-color)', alignItems: 'center' }}>
              <span className="orders-date orders-col-value">
                {new Date(trade.tradeTime + 'Z').toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="orders-symbol orders-col-value" style={{ fontWeight: 700 }}>{trade.symbol}</span>
              <span className="orders-type-badge">{trade.instrumentType || 'EQUITY'}</span>
              <span className="orders-qty orders-col-value">{trade.qty}</span>
              <span className="orders-price orders-col-value">{formatCurrency(trade.entryPrice)}</span>
              <span className="orders-price orders-col-value">{formatCurrency(trade.exitPrice)}</span>
              <span className="orders-col-value" style={{ fontWeight: 700, color: trade.realizedPnL >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {trade.realizedPnL >= 0 ? '+' : ''}{formatCurrency(trade.realizedPnL)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default TradeHistory;
