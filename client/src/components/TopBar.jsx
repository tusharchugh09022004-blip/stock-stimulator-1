import { useRef } from 'react';
import ThemeToggle from './ThemeToggle';

export default function TopBar({
  theme,
  onThemeChange,
  searchQuery,
  onSearchChange,
  suggestions,
  onSelectStock,
  searchRef: externalSearchRef,
  balance,
  username,
  onSettingsOpen,
  onLogout,
  onUpstox,
  upstoxConnected,
}) {
  const innerRef = useRef(null);
  const ref = externalSearchRef || innerRef;
  const showSuggestions = suggestions && suggestions.length > 0 && searchQuery.length > 0;
  const userInitial = username ? username.charAt(0).toUpperCase() : 'U';

  return (
    <header className="topbar">
      <div className="topbar__left">
        <img src="/logo.png?v=2" alt="VSS" className="topbar__logo" />
        <span className="topbar__brand">Virtual Stock Simulator</span>
      </div>

      <div className="topbar__right">
        <div className="topbar__balance-card">
          <span className="topbar__balance-label">BALANCE</span>
          <strong className="topbar__balance-value">
            ₹{Number(balance || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
          </strong>
        </div>

        <ThemeToggle current={theme} onChange={onThemeChange} />

        <div className="topbar__user-pill">
          <span className="topbar__user-avatar">{userInitial}</span>
          <span className="topbar__user-name">{username}</span>
        </div>

        <button className="topbar__icon-btn" onClick={onSettingsOpen} title="Settings">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        <button className={`topbar__btn topbar__btn--upstox ${upstoxConnected ? 'topbar__btn--upstox-connected' : ''}`} onClick={onUpstox}>
          {upstoxConnected ? '● Upstox' : '○ Upstox'}
        </button>
        <button className="topbar__btn topbar__btn--logout" onClick={onLogout}>Logout</button>
      </div>
    </header>
  );
}
