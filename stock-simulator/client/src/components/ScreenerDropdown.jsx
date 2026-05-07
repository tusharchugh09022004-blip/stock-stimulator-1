import { useState, useRef, useEffect } from 'react';
import { NIFTY_500_STOCKS, searchStocks } from '../data/nifty500';

const ScreenerDropdown = ({ selectedStock, onStockSelect, onClose }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const dropdownRef = useRef(null);

  const filteredStocks = searchStocks(searchQuery);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStockClick = (stock) => {
    onStockSelect(stock);
    setIsOpen(false);
    if (onClose) onClose();
  };

  return (
    <div className="screener-dropdown" ref={dropdownRef}>
      <button
        className="screener-btn"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          padding: '0.5rem 1rem',
          background: isOpen ? '#2563eb' : 'white',
          color: isOpen ? 'white' : '#1e40af',
          border: '1px solid #2563eb',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: '500',
          transition: 'all 0.2s',
        }}
      >
        🔍 Screener
      </button>

      {isOpen && (
        <div
          className="screener-dropdown-menu"
          style={{
            position: 'absolute',
            top: '100%',
            right: '0',
            marginTop: '0.5rem',
            width: '320px',
            maxHeight: '400px',
            background: 'white',
            border: '1px solid #e2e8f0',
            borderRadius: '8px',
            boxShadow: '0 10px 40px rgba(0, 0, 0, 0.15)',
            zIndex: 1000,
            overflow: 'hidden',
          }}
        >
          <div
            className="screener-search"
            style={{
              padding: '1rem',
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <input
              type="text"
              placeholder="Search stocks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 0.75rem',
                border: '1px solid #cbd5e1',
                borderRadius: '6px',
                fontSize: '0.875rem',
                outline: 'none',
                transition: 'border-color 0.2s',
              }}
              onFocus={(e) => (e.target.style.borderColor = '#2563eb')}
              onBlur={(e) => (e.target.style.borderColor = '#cbd5e1')}
            />
          </div>

          <div
            className="screener-stock-list"
            style={{
              maxHeight: '320px',
              overflowY: 'auto',
            }}
          >
            {filteredStocks.length === 0 ? (
              <div
                style={{
                  padding: '2rem',
                  textAlign: 'center',
                  color: '#64748b',
                  fontSize: '0.875rem',
                }}
              >
                No stocks found
              </div>
            ) : (
              filteredStocks.map((stock) => (
                <div
                  key={stock.symbol}
                  onClick={() => handleStockClick(stock)}
                  className="screener-stock-item"
                  style={{
                    padding: '0.75rem 1rem',
                    cursor: 'pointer',
                    transition: 'background-color 0.15s',
                    borderBottom: '1px solid #f1f5f9',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.25rem',
                  }}
                  onMouseEnter={(e) => (e.target.style.backgroundColor = '#f8fafc')}
                  onMouseLeave={(e) => (e.target.style.backgroundColor = 'transparent')}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span
                      style={{
                        fontWeight: '600',
                        color: '#1e40af',
                        fontSize: '0.875rem',
                      }}
                    >
                      {stock.symbol}
                    </span>
                    {selectedStock?.symbol === stock.symbol && (
                      <span style={{ color: '#22c55e', fontSize: '0.75rem' }}>
                        ✓
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: '0.75rem',
                      color: '#64748b',
                    }}
                  >
                    {stock.name}
                  </span>
                </div>
              ))
            )}
          </div>

          <div
            className="screener-footer"
            style={{
              padding: '0.75rem 1rem',
              borderTop: '1px solid #e2e8f0',
              fontSize: '0.75rem',
              color: '#64748b',
              textAlign: 'center',
            }}
          >
            {filteredStocks.length} stocks
          </div>
        </div>
      )}
    </div>
  );
};

export default ScreenerDropdown;
