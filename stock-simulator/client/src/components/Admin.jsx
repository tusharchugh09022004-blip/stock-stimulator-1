import { useState, useEffect } from 'react';
import axios from 'axios';

const Admin = ({ token, onClose }) => {
  const [loginHistory, setLoginHistory] = useState([]);
  const [username, setUsername] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    checkAdminStatus();
    fetchLoginHistory();
  }, [token]);

  const checkAdminStatus = async () => {
    try {
      const response = await axios.get('/api/auth/user', {
        headers: { Authorization: `Bearer ${token}` }
      });
      try {
        await axios.get('/api/admin/all-login-history?limit=1', {
          headers: { Authorization: `Bearer ${token}` }
        });
        setIsAdmin(true);
      } catch (err) {
        setIsAdmin(false);
      }
    } catch (err) {
      console.error('Error checking admin status:', err);
    }
  };

  const fetchLoginHistory = async () => {
    setIsLoading(true);
    try {
      const response = await axios.get('/api/admin/all-login-history?limit=100', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLoginHistory(response.data);
    } catch (err) {
      if (err.response?.status === 403) {
        setMessage('Admin access required');
      } else {
        setMessage('Failed to fetch login history');
      }
    }
    setIsLoading(false);
  };

  const setAdmin = async () => {
    if (!username) {
      setMessage('Please enter a username');
      return;
    }

    try {
      const response = await axios.post(
        '/api/admin/set-admin',
        { username },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setMessage(response.data.message);
      setUsername('');
      setTimeout(() => checkAdminStatus(), 1000);
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to set admin');
    }
  };

  const getActionColor = (action) => {
    if (action.includes('login')) return '#16a34a';
    if (action.includes('logout')) return '#dc2626';
    return '#64748b';
  };

  const getActionLabel = (action) => {
    if (action === 'login_password') return '🔐 Password Login';
    if (action === 'login_google') return '🔑 Google Login';
    if (action === 'logout') return '🚪 Logout';
    return action;
  };

  if (!isAdmin) {
    return (
      <div style={{ 
        position: 'fixed', 
        top: 0, 
        left: 0, 
        right: 0, 
        bottom: 0, 
        background: 'rgba(0,0,0,0.5)', 
        zIndex: 1000, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        padding: '20px'
      }}>
        <div style={{ 
          background: 'white', 
          padding: '40px', 
          borderRadius: '16px', 
          maxWidth: '450px', 
          width: '100%',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <h2 style={{ margin: 0, color: '#1e293b', fontSize: '24px' }}>Admin Panel</h2>
            <button 
              onClick={onClose} 
              style={{ 
                fontSize: '24px', 
                background: 'none', 
                border: 'none', 
                cursor: 'pointer',
                color: '#64748b',
                padding: '4px 8px',
                borderRadius: '4px'
              }}
            >✕</button>
          </div>
          <div style={{ 
            textAlign: 'center',
            padding: '24px',
            background: '#fef2f2',
            borderRadius: '8px',
            border: '1px solid #fecaca',
            marginBottom: '20px'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔒</div>
            <p style={{ color: '#dc2626', fontWeight: '600', marginBottom: '8px' }}>Admin Access Required</p>
            <p style={{ color: '#64748b', fontSize: '14px' }}>You don't have permission to access this panel.</p>
          </div>
          <div style={{ 
            padding: '16px',
            background: '#f8fafc',
            borderRadius: '8px',
            fontSize: '14px',
            color: '#475569'
          }}>
            <p style={{ marginBottom: '8px' }}><strong>To grant admin access:</strong></p>
            <ol style={{ marginLeft: '20px', lineHeight: '1.6' }}>
              <li>Enter your username below</li>
              <li>Click "Make Admin" button</li>
              <li>Refresh the page</li>
            </ol>
            <input
              type="text"
              placeholder="Enter username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                marginTop: '12px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '14px'
              }}
            />
            <button
              onClick={setAdmin}
              style={{
                width: '100%',
                padding: '10px',
                marginTop: '12px',
                background: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500'
              }}
            >
              Make Admin
            </button>
            {message && <p style={{ marginTop: '12px', color: message.includes('now an admin') ? '#16a34a' : '#dc2626', fontSize: '13px', textAlign: 'center' }}>{message}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      position: 'fixed', 
      top: 0, 
      left: 0, 
      right: 0, 
      bottom: 0, 
      background: 'rgba(0,0,0,0.5)', 
      zIndex: 1000, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      padding: '20px'
    }}>
      <div style={{ 
        background: 'white', 
        padding: '32px', 
        borderRadius: '16px', 
        maxWidth: '1100px', 
        width: '100%', 
        maxHeight: '90vh', 
        overflowY: 'auto',
        boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', paddingBottom: '16px', borderBottom: '2px solid #e2e8f0' }}>
          <div>
            <h2 style={{ margin: 0, color: '#1e293b', fontSize: '28px' }}>👤 Admin Panel</h2>
            <p style={{ margin: '4px 0 0 0', color: '#64748b', fontSize: '14px' }}>View and manage user login history</p>
          </div>
          <button 
            onClick={onClose} 
            style={{ 
              fontSize: '24px', 
              background: 'none', 
              border: 'none', 
              cursor: 'pointer',
              color: '#64748b',
              padding: '8px 12px',
              borderRadius: '6px'
            }}
          >✕</button>
        </div>

        <div style={{ 
          marginBottom: '32px', 
          padding: '20px', 
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', 
          borderRadius: '12px',
          color: 'white'
        }}>
          <h3 style={{ margin: '0 0 12px 0', fontSize: '18px' }}>Grant Admin Access</h3>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="Enter username to make admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                flex: 1,
                minWidth: '200px',
                padding: '12px 16px',
                borderRadius: '8px',
                border: 'none',
                fontSize: '14px'
              }}
            />
            <button
              onClick={setAdmin}
              style={{
                padding: '12px 24px',
                background: 'white',
                color: '#667eea',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '600'
              }}
            >
              Make Admin
            </button>
          </div>
          {message && (
            <p style={{ 
              marginTop: '12px', 
              background: message.includes('now an admin') ? 'rgba(22, 163, 74, 0.2)' : 'rgba(220, 38, 38, 0.2)',
              padding: '8px 12px',
              borderRadius: '6px',
              fontSize: '13px'
            }}>{message}</p>
          )}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, color: '#1e293b', fontSize: '20px' }}>Login History</h3>
            <span style={{ background: '#dbeafe', color: '#1e40af', padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' }}>
              {loginHistory.length} records
            </span>
          </div>
          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
              <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
              <p>Loading login history...</p>
            </div>
          ) : loginHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
              <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
              <p>No login history found</p>
            </div>
          ) : (
            <div style={{ 
              overflowX: 'auto',
              borderRadius: '8px',
              border: '1px solid #e2e8f0'
            }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>ID</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>Username</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>Action</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>IP Address</th>
                    <th style={{ padding: '12px 16px', textAlign: 'left', color: '#64748b', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {loginHistory.map((record, index) => (
                    <tr 
                      key={record.id} 
                      style={{ 
                        borderBottom: '1px solid #e2e8f0',
                        background: index % 2 === 0 ? 'white' : '#f8fafc'
                      }}
                    >
                      <td style={{ padding: '12px 16px', color: '#475569', fontSize: '14px' }}>#{record.id}</td>
                      <td style={{ padding: '12px 16px', color: '#1e293b', fontSize: '14px', fontWeight: '500' }}>{record.username}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <span style={{ 
                          padding: '4px 12px',
                          borderRadius: '20px',
                          fontSize: '12px',
                          fontWeight: '500',
                          background: getActionColor(record.action) + '20',
                          color: getActionColor(record.action)
                        }}>
                          {getActionLabel(record.action)}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', color: '#64748b', fontSize: '13px', fontFamily: 'monospace' }}>{record.ipAddress || 'N/A'}</td>
                      <td style={{ padding: '12px 16px', color: '#475569', fontSize: '13px' }}>
                        {new Date(record.loginTime).toLocaleString('en-IN', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Admin;
