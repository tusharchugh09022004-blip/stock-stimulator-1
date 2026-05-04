import { useEffect, useState } from 'react';
import axios from 'axios';

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

export default function Settings({ onBalanceChange, onClose }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [balanceInput, setBalanceInput] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [mode, setMode] = useState('add'); // 'add' or 'set'
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // Order history state
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [deletingOrder, setDeletingOrder] = useState(null);

  const userId = localStorage.getItem('userId') || 'default';

  useEffect(() => {
    fetchProfile();
    fetchOrders();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await axios.get('/api/user/profile');
      setUser(res.data);
    } catch (err) {
      console.error('Profile fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrders = async () => {
    try {
      const res = await axios.get(`/api/orders/${userId}`);
      setOrders(res.data || []);
    } catch (err) {
      console.error('Orders fetch failed:', err);
    } finally {
      setOrdersLoading(false);
    }
  };

  const handleBalanceUpdate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);

    try {
      let payload;
      if (mode === 'add') {
        payload = { add: Number(addAmount) };
      } else {
        payload = { balance: Number(balanceInput) };
      }

      const res = await axios.put('/api/user/balance', payload);
      setUser({ ...user, balance: res.data.balance });
      setMessage({ type: 'success', text: `Balance updated to ${formatCurrency(res.data.balance)}` });
      
      // Notify parent component of balance change
      if (onBalanceChange) {
        onBalanceChange(res.data.balance);
      }

      setBalanceInput('');
      setAddAmount('');
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to update balance' });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteOrder = async (orderId) => {
    if (!confirm('Are you sure you want to cancel this order? This will reverse the trade.')) {
      return;
    }

    setDeletingOrder(orderId);
    try {
      await axios.delete(`/api/orders/${orderId}`);
      setOrders(orders.filter(o => o.id !== orderId));
      setMessage({ type: 'success', text: 'Order cancelled successfully' });
      
      // Refresh the user data to get updated balance
      fetchProfile();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to cancel order' });
    } finally {
      setDeletingOrder(null);
    }
  };

  const handleClearAllOrders = async () => {
    if (!confirm('Are you sure you want to delete all order history? This will reverse all your past trades.')) {
      return;
    }

    setDeletingOrder('all');
    try {
      await axios.delete(`/api/orders/user/${userId}/all`);
      setOrders([]);
      setMessage({ type: 'success', text: 'All orders cleared successfully' });
      
      // Refresh the user data to get updated balance
      fetchProfile();
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Failed to clear orders' });
    } finally {
      setDeletingOrder(null);
    }
  };

  if (loading) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <section className="settings-section" onClick={(e) => e.stopPropagation()}>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">✕</button>
          <div className="settings-header">
            <p className="settings-eyebrow">Account Settings</p>
            <h2>Settings</h2>
          </div>
          <div className="settings-loading">Loading...</div>
        </section>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section className="settings-section" onClick={(e) => e.stopPropagation()}>
        <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">✕</button>
        <div className="settings-header">
          <p className="settings-eyebrow">Account Management</p>
          <h2>Settings & Account</h2>
          <p className="settings-subtitle">Manage your account balance and view order history.</p>
        </div>

        {message && (
          <div className={`settings-message settings-message--${message.type}`}>
            {message.text}
          </div>
        )}

        {/* Balance Editor Card */}
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>Account Balance</h3>
            <span className="settings-balance-display">{formatCurrency(user?.balance || 0)}</span>
          </div>

          <form onSubmit={handleBalanceUpdate} className="settings-form">
            <div className="settings-mode-toggle">
              <button
                type="button"
                className={`settings-mode-btn ${mode === 'add' ? 'settings-mode-btn--active' : ''}`}
                onClick={() => setMode('add')}
              >
                Add Funds
              </button>
              <button
                type="button"
                className={`settings-mode-btn ${mode === 'set' ? 'settings-mode-btn--active' : ''}`}
                onClick={() => setMode('set')}
              >
                Set Balance
              </button>
            </div>

            <div className="settings-input-group">
              <label className="settings-label">
                {mode === 'add' ? 'Amount to Add' : 'New Balance Amount'}
              </label>
              <div className="settings-input-wrapper">
                <span className="settings-input-prefix">₹</span>
                <input
                  type="number"
                  className="settings-input"
                  placeholder={mode === 'add' ? 'Enter amount to add' : 'Enter new balance'}
                  value={mode === 'add' ? addAmount : balanceInput}
                  onChange={(e) => mode === 'add' ? setAddAmount(e.target.value) : setBalanceInput(e.target.value)}
                  min="0"
                  step="100"
                  required
                />
              </div>
            </div>

            <button type="submit" className="settings-submit-btn" disabled={saving}>
              {saving ? 'Updating...' : mode === 'add' ? 'Add Funds' : 'Set Balance'}
            </button>
          </form>
        </div>

        {/* Order History Card */}
        <div className="settings-card settings-card--orders">
          <div className="settings-card__header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3>Order History</h3>
              <span className="settings-order-count">{orders.length} orders</span>
            </div>
            {orders.length > 0 && (
              <button 
                className="settings-clear-all-btn"
                onClick={handleClearAllOrders}
                disabled={deletingOrder === 'all'}
                style={{ fontSize: '0.85rem', padding: '6px 12px', background: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontWeight: '500' }}
              >
                {deletingOrder === 'all' ? 'Clearing...' : 'Clear All'}
              </button>
            )}
          </div>

          {ordersLoading ? (
            <div className="settings-loading">Loading orders...</div>
          ) : orders.length === 0 ? (
            <div className="settings-empty">
              <p>No orders yet. Start trading to see your order history here.</p>
            </div>
          ) : (
            <div className="settings-orders-list">
              <div className="settings-orders-header">
                <span>Date</span>
                <span>Symbol</span>
                <span>Action</span>
                <span>Qty</span>
                <span>Price</span>
                <span>Total</span>
                <span></span>
              </div>
              {orders.map((order) => (
                <div key={order.id} className="settings-order-row">
                  <span className="settings-order-date">
                    {new Date(order.orderTime).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </span>
                  <span className="settings-order-symbol">{order.symbol}</span>
                  <span className={`settings-order-action settings-order-action--${order.action}`}>
                    {order.action.toUpperCase()}
                  </span>
                  <span className="settings-order-qty">{order.qty}</span>
                  <span className="settings-order-price">{formatCurrency(order.price)}</span>
                  <span className="settings-order-total">{formatCurrency(order.total)}</span>
                  <button
                    className="settings-order-delete"
                    onClick={() => handleDeleteOrder(order.id)}
                    disabled={deletingOrder === order.id}
                    title="Cancel order"
                  >
                    {deletingOrder === order.id ? '...' : '✕'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* User Info */}
        <div className="settings-card settings-card--info">
          <div className="settings-card__header">
            <h3>Account Information</h3>
          </div>
          <div className="settings-info-grid">
            <div className="settings-info-item">
              <span className="settings-info-label">User ID</span>
              <strong>{user?.userId}</strong>
            </div>
            <div className="settings-info-item">
              <span className="settings-info-label">Username</span>
              <strong>{user?.username || 'N/A'}</strong>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
