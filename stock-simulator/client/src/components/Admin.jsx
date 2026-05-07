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
      // Check if user has admin status by trying to access admin endpoint
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
    } catch (err) {
      setMessage(err.response?.data?.error || 'Failed to set admin');
    }
  };

  if (!isAdmin) {
    return (
      <div style={{ padding: '20px', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'white', padding: '30px', borderRadius: '8px', maxWidth: '400px', width: '100%' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <h2 style={{ margin: 0 }}>Admin Panel</h2>
            <button onClick={onClose} style={{ fontSize: '20px', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
          </div>
          <p style={{ color: 'red' }}>Admin access required</p>
          <p>Contact the system administrator to grant admin access.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: 'white', padding: '30px', borderRadius: '8px', maxWidth: '900px', width: '100%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0 }}>Admin Panel</h2>
          <button onClick={onClose} style={{ fontSize: '20px', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={{ marginBottom: '30px', padding: '15px', background: '#f5f5f5', borderRadius: '8px' }}>
          <h3>Grant Admin Access</h3>
          <input
            type="text"
            placeholder="Enter username to make admin"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{
              padding: '8px',
              marginRight: '10px',
              width: '250px',
              borderRadius: '4px',
              border: '1px solid #ddd'
            }}
          />
          <button
            onClick={setAdmin}
            style={{
              padding: '8px 16px',
              background: '#007bff',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Make Admin
          </button>
          {message && <p style={{ marginTop: '10px', color: message.includes('now an admin') ? 'green' : 'red' }}>{message}</p>}
        </div>

        <div>
          <h3>Login History</h3>
          {isLoading ? (
            <p>Loading...</p>
          ) : loginHistory.length === 0 ? (
            <p>No login history found</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#007bff', color: 'white' }}>
                  <th style={{ padding: '10px', textAlign: 'left' }}>ID</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Username</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Action</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>IP Address</th>
                  <th style={{ padding: '10px', textAlign: 'left' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {loginHistory.map((record) => (
                  <tr key={record.id} style={{ borderBottom: '1px solid #ddd' }}>
                    <td style={{ padding: '10px' }}>{record.id}</td>
                    <td style={{ padding: '10px' }}>{record.username}</td>
                    <td style={{ padding: '10px' }}>{record.action}</td>
                    <td style={{ padding: '10px' }}>{record.ipAddress || 'N/A'}</td>
                    <td style={{ padding: '10px' }}>{new Date(record.loginTime).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default Admin;
