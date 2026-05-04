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
          <p className="orders-section__eyebrow">Transaction records</p>
          <h2>Order History</h2>
        </div>
        <div className="orders-loading">Loading order history...</div>
      </section>
    );
  }

  return (
    <section className="orders-section">
      <div className="orders-section__header">
        <div>
          <p className="orders-section__eyebrow">Transaction records</p>
          <h2>Order History</h2>
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
          <div className="orders-table-header">
            <span>Date & Time</span>
            <span>Symbol</span>
            <span>Action</span>
            <span>Quantity</span>
            <span>Price</span>
            <span>Total</span>
          </div>
          {orders.map((order, index) => (
            <div key={order.id || index} className="orders-table-row">
              <span className="orders-date">
                {new Date(order.orderTime).toLocaleString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
              <span className="orders-symbol">{order.symbol}</span>
              <span className={`orders-action orders-action--${order.action}`}>
                {order.action.toUpperCase()}
              </span>
              <span className="orders-qty">{order.qty}</span>
              <span className="orders-price">{formatCurrency(order.price)}</span>
              <span className="orders-total">{formatCurrency(order.total)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default OrderHistory;
