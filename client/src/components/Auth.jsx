import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import axios from 'axios';
import '../styles/Auth.css';

export default function Auth({ onAuthSuccess }) {
  const googleEnabled = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleError, setGoogleError] = useState('');

  const saveAndContinue = (data) => {
    localStorage.setItem('token', data.token);
    localStorage.setItem('userId', data.userId);
    localStorage.setItem('username', data.username);
    onAuthSuccess(data);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setGoogleError('');

    if (mode === 'signup') {
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      if (password.length < 6) {
        setError('Password must be at least 6 characters');
        return;
      }
    }

    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const response = await axios.post(endpoint, { username, password });
      saveAndContinue(response.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSuccess = async (credentialResponse) => {
    setError('');
    setGoogleError('');
    setLoading(true);

    try {
      const response = await axios.post('/api/auth/google-token', {
        token: credentialResponse.credential
      });
      saveAndContinue(response.data);
    } catch (err) {
      setGoogleError(err.response?.data?.error || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleError = () => {
    setGoogleError('Google sign-in failed. Please try again.');
    setLoading(false);
  };

  return (
    <div className="auth-container">
      <div className="auth-bg-shapes">
        <div className="auth-shape auth-shape--1"></div>
        <div className="auth-shape auth-shape--2"></div>
        <div className="auth-shape auth-shape--3"></div>
      </div>

      <div className="auth-card">
        <div className="auth-logo-section">
          <img src="/logo.png?v=2" alt="VSS" className="auth-logo-img" />
          <h1 className="auth-brand">Virtual Stock Simulator</h1>
          <p className="auth-tagline">Practice. Learn. Trade.</p>
        </div>

        <div className="auth-tabs">
          <button
            className={`tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => {
              setMode('login');
              setError('');
              setConfirmPassword('');
              setGoogleError('');
            }}
          >
            Login
          </button>
          <button
            className={`tab ${mode === 'signup' ? 'active' : ''}`}
            onClick={() => {
              setMode('signup');
              setError('');
              setGoogleError('');
            }}
          >
            Sign Up
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="error-message">{error}</div>}

          <div className="form-group">
            <label htmlFor="username">Username</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              required
            />
          </div>

          {mode === 'signup' && (
            <div className="form-group">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                required
              />
            </div>
          )}

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Loading...' : mode === 'login' ? 'Login' : 'Sign Up'}
          </button>
        </form>

        {googleEnabled && (
          <>
            <div className="divider-container">
              <div className="divider-line"></div>
              <span className="divider-text">or</span>
              <div className="divider-line"></div>
            </div>

            {googleError && <div className="error-message">{googleError}</div>}

            <GoogleLogin
              onSuccess={handleGoogleSuccess}
              onError={handleGoogleError}
              text={mode === 'signup' ? 'signup_with' : 'signin_with'}
              size="large"
              theme="outline"
            />
          </>
        )}

        <p className="demo-tip">
          {googleEnabled
            ? 'Use Google to create an account instantly and sign in securely.'
            : 'Use username/password now. Add Google client ID in .env to enable Google sign-in.'}
        </p>
      </div>
    </div>
  );
}
