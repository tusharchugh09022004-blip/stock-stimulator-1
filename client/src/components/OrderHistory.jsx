import { useEffect, useState } from 'react';
import axios from 'axios';

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

function OrderHistory({ userId }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrders = async () => {
      if (!userId) return;
      
      try {
        const res = await axios.get(`/api/orders/${userId}`);
        setOrders(res.data || []);
      } catch (err) {
        console.error('Order history fetch failed:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, [userId]);

  if (loading) {
    return (
      <section className="orders-section">
        <div className="orders-section__header">
          <h2 className="orders-section__headline">TRANSACTION RECORDS</h2>
          <span className="orders-section__count">{orders.length} orders</span>
        </div>
        <div className="orders-loading">Loading order history...</div>
      </section>
    );
  }

  return (
    <section className="orders-section">
      <div className="orders-section__header">
        <div>
          <h2 className="orders-section__headline">TRANSACTION RECORDS</h2>
          <p className="orders-section__subtitle">Complete record of all your buy and sell orders.</p>
        </div>
        <span className="orders-section__count">{orders.length} orders</span>
      </div>

      {orders.length === 0 ? (
        <div className="orders-empty">
          <p>No orders yet. Start trading to see your order history here.</p>
        </div>
      ) : (
        <div className="orders-list">
          <div className="orders-table-header" style={{ display: 'grid', gridTemplateColumns: '1.5fr 2.5fr 1fr 1fr 1fr 1fr 1.5fr', gap: '1rem', padding: '1rem', background: 'var(--bg-hover)', fontWeight: 600, borderBottom: '1px solid var(--border-color)' }}>
            <span className="orders-col-highlight">Date & Time</span>
            <span className="orders-col-highlight">Instrument</span>
            <span className="orders-col-highlight">Type</span>
            <span className="orders-col-highlight">Action</span>
            <span className="orders-col-highlight">Qty</span>
            <span className="orders-col-highlight">Price</span>
            <span className="orders-col-highlight">Total</span>
          </div>
          {orders.map((order, index) => (
            <div key={order.id || index} className="orders-table-row" style={{ display: 'grid', gridTemplateColumns: '1.5fr 2.5fr 1fr 1fr 1fr 1fr 1.5fr', gap: '1rem', padding: '1rem', borderBottom: '1px solid var(--border-color)', alignItems: 'center' }}>
              <span className="orders-date orders-col-value">
                {new Date((order.time || order.orderTime) + 'Z').toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="orders-symbol orders-col-value" style={{ fontWeight: 700 }}>{order.symbol}</span>
              <span className="orders-type-badge">{order.instrumentType || 'EQUITY'}</span>
              <span className={`orders-action orders-action--${order.action}`}>
                {order.action.toUpperCase()}
              </span>
              <span className="orders-qty orders-col-value">{order.qty || order.quantity}</span>
              <span className="orders-price orders-col-value">{formatCurrency(order.price || order.premium)}</span>
              <span className="orders-total orders-col-value">{formatCurrency(order.total)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default OrderHistory;
