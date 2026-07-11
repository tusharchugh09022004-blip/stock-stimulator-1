import { createContext, useCallback, useContext, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback(({ type = 'success', message }) => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={addToast}>
      {children}
      <div style={{
        position: 'fixed', top: 16, right: 16, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 8
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            padding: '12px 20px', borderRadius: 8, minWidth: 280,
            color: '#fff', fontSize: 14, fontWeight: 500,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
            animation: 'slideIn 0.2s ease-out',
            background: t.type === 'success' ? 'var(--green)' : 'var(--red)'
          }}>
            {t.message}
            <button onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
              style={{
                marginLeft: 12, background: 'none', border: 'none',
                color: '#fff', cursor: 'pointer', fontSize: 16, float: 'right'
              }}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
