import { useEffect, useState, useMemo } from 'react';
import axios from 'axios';

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })}`;

const formatCurrencyFull = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year, month) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function PnlCalendar({ userId }) {
  const [trades, setTrades] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      if (!userId) return;
      try {
        const [tradesRes, ordersRes] = await Promise.all([
          axios.get(`/api/trades/${userId}`),
          axios.get(`/api/orders/${userId}`)
        ]);
        setTrades(tradesRes.data || []);
        setOrders(ordersRes.data || []);
      } catch (err) {
        console.error('PnL Calendar fetch failed:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [userId]);

  const dailyData = useMemo(() => {
    const map = {};
    for (const t of trades) {
      const key = toDateKey(new Date(t.tradeTime + 'Z'));
      if (!map[key]) map[key] = { pnl: 0, tradeCount: 0, wins: 0, trades: [], invested: 0 };
      map[key].pnl += Number(t.realizedPnL) || 0;
      map[key].tradeCount += 1;
      if ((Number(t.realizedPnL) || 0) > 0) map[key].wins += 1;
      map[key].trades.push(t);
    }
    for (const o of orders) {
      if (o.action && o.action.toLowerCase() === 'buy') {
        const key = toDateKey(new Date((o.orderTime || o.time) + 'Z'));
        if (!map[key]) map[key] = { pnl: 0, tradeCount: 0, wins: 0, trades: [], invested: 0 };
        map[key].invested += Number(o.total) || 0;
      }
    }
    return map;
  }, [trades, orders]);

  const summary = useMemo(() => {
    let totalPnl = 0, totalTrades = 0, totalWins = 0;
    for (const key in dailyData) {
      totalPnl += dailyData[key].pnl;
      totalTrades += dailyData[key].tradeCount;
      totalWins += dailyData[key].wins;
    }
    return {
      totalPnl,
      totalTrades,
      winRate: totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0.0'
    };
  }, [dailyData]);

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfWeek(currentYear, currentMonth);
    const cells = [];
    for (let i = 0; i < firstDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    return cells;
  }, [currentMonth, currentYear]);

  const prevMonth = () => {
    setSelectedDay(null);
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
  };

  const nextMonth = () => {
    setSelectedDay(null);
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
  };

  const selectedDayData = selectedDay ? dailyData[selectedDay] : null;

  if (loading) {
    return (
      <section className="orders-section pnl-calendar">
        <div className="pnl-calendar__header">
          <div className="pnl-calendar__header-left">
            <p className="pnl-calendar__eyebrow">P&L CALENDAR</p>
            <p className="pnl-calendar__subtitle">Monthly performance overview</p>
          </div>
        </div>
        <div className="orders-loading">Loading calendar data...</div>
      </section>
    );
  }

  return (
    <section className="orders-section pnl-calendar">
      <div className="pnl-calendar__header">
        <div className="pnl-calendar__header-left">
          <p className="pnl-calendar__eyebrow">P&L CALENDAR</p>
          <p className="pnl-calendar__subtitle">Monthly performance overview</p>
        </div>
        <div className="pnl-calendar__summary">
          <div className={`pnl-calendar__summary-item ${summary.totalPnl >= 0 ? 'pnl-calendar__summary-item--pnl' : 'pnl-calendar__summary-item--pnl pnl-calendar__summary-item--negative'}`}>
            <span className="pnl-calendar__summary-label">Total P&L</span>
            <span className="pnl-calendar__summary-value" style={{ color: summary.totalPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {summary.totalPnl >= 0 ? '+' : ''}{formatCurrencyFull(summary.totalPnl)}
            </span>
          </div>
          <div className="pnl-calendar__summary-item pnl-calendar__summary-item--trades">
            <span className="pnl-calendar__summary-label">Trades</span>
            <span className="pnl-calendar__summary-value" style={{ color: 'var(--blue)' }}>{summary.totalTrades}</span>
          </div>
          <div className="pnl-calendar__summary-item pnl-calendar__summary-item--winrate">
            <span className="pnl-calendar__summary-label">Win Rate</span>
            <span className="pnl-calendar__summary-value" style={{ color: parseFloat(summary.winRate) >= 50 ? 'var(--green)' : 'var(--red)' }}>
              {summary.winRate}%
            </span>
          </div>
        </div>
      </div>

      <div className="pnl-calendar__nav">
        <button className="pnl-calendar__nav-btn" onClick={prevMonth}>&#9664;</button>
        <span className="pnl-calendar__nav-title">{MONTHS[currentMonth]} {currentYear}</span>
        <button className="pnl-calendar__nav-btn" onClick={nextMonth}>&#9654;</button>
      </div>

      <div className="pnl-calendar__grid">
        {DAYS.map(day => (
          <div key={day} className="pnl-calendar__day-header">{day}</div>
        ))}
        {calendarDays.map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} className="pnl-calendar__cell pnl-calendar__cell--empty" />;
          const key = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const data = dailyData[key];
          const isSelected = selectedDay === key;
          let cellClass = 'pnl-calendar__cell';
          if (data) {
            cellClass += data.pnl > 0 ? ' pnl-calendar__cell--profit' : data.pnl < 0 ? ' pnl-calendar__cell--loss' : ' pnl-calendar__cell--neutral';
          }
          if (isSelected) cellClass += ' pnl-calendar__cell--selected';

          return (
            <div key={key} className={cellClass} onClick={() => setSelectedDay(isSelected ? null : key)}>
              <span className="pnl-calendar__day-num">{day}</span>
              {data && <span className={`pnl-calendar__dot ${data.pnl >= 0 ? 'pnl-calendar__dot--profit' : 'pnl-calendar__dot--loss'}`} />}
            </div>
          );
        })}
      </div>

      {selectedDay && selectedDayData && (
        <div className="pnl-calendar__detail">
          <div className="pnl-calendar__detail-header">
            <h3>
              {new Date(selectedDay + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </h3>
            <button className="pnl-calendar__detail-close" onClick={() => setSelectedDay(null)}>&#10005;</button>
          </div>

          <div className="pnl-calendar__detail-summary">
            <div className={`pnl-calendar__detail-stat ${selectedDayData.pnl >= 0 ? 'pnl-calendar__detail-stat--pnl' : 'pnl-calendar__detail-stat--pnl pnl-calendar__detail-stat--negative'}`}>
              <span className="pnl-calendar__detail-stat-label">Day P&L</span>
              <span className="pnl-calendar__detail-stat-value" style={{ color: selectedDayData.pnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                {selectedDayData.pnl >= 0 ? '+' : ''}{formatCurrencyFull(selectedDayData.pnl)}
              </span>
            </div>
            <div className="pnl-calendar__detail-stat">
              <span className="pnl-calendar__detail-stat-label">Trades</span>
              <span className="pnl-calendar__detail-stat-value" style={{ color: 'var(--blue)' }}>{selectedDayData.tradeCount}</span>
            </div>
            <div className="pnl-calendar__detail-stat">
              <span className="pnl-calendar__detail-stat-label">Win / Loss</span>
              <span className="pnl-calendar__detail-stat-value">
                <span style={{ color: 'var(--green)' }}>{selectedDayData.wins}</span>
                <span style={{ color: 'var(--text-muted)', margin: '0 2px' }}>/</span>
                <span style={{ color: 'var(--red)' }}>{selectedDayData.tradeCount - selectedDayData.wins}</span>
              </span>
            </div>
            <div className={`pnl-calendar__detail-stat ${selectedDayData.tradeCount > 0 && (selectedDayData.wins / selectedDayData.tradeCount) >= 0.5 ? 'pnl-calendar__detail-stat--winrate' : ''}`}>
              <span className="pnl-calendar__detail-stat-label">Win Rate</span>
              <span className="pnl-calendar__detail-stat-value" style={{ color: selectedDayData.tradeCount > 0 && (selectedDayData.wins / selectedDayData.tradeCount) >= 0.5 ? 'var(--green)' : 'var(--red)' }}>
                {selectedDayData.tradeCount > 0 ? ((selectedDayData.wins / selectedDayData.tradeCount) * 100).toFixed(1) : '0.0'}%
              </span>
            </div>
            <div className="pnl-calendar__detail-stat">
              <span className="pnl-calendar__detail-stat-label">Invested</span>
              <span className="pnl-calendar__detail-stat-value" style={{ color: 'var(--orange)' }}>{formatCurrencyFull(selectedDayData.invested)}</span>
            </div>
          </div>

          {selectedDayData.tradeCount > 0 && (
            <div className="pnl-calendar__detail-winbar">
              <div className="pnl-calendar__detail-winbar-track">
                <div className="pnl-calendar__detail-winbar-fill" style={{ width: `${(selectedDayData.wins / selectedDayData.tradeCount) * 100}%` }} />
              </div>
              <span className="pnl-calendar__detail-winbar-label">{selectedDayData.wins}W / {selectedDayData.tradeCount - selectedDayData.wins}L</span>
            </div>
          )}

          {selectedDayData.trades.length > 0 ? (
            <div className="pnl-calendar__detail-trades">
              <div className="pnl-calendar__detail-table-header">
                <span>Time</span>
                <span>Instrument</span>
                <span>Type</span>
                <span>Qty</span>
                <span>Entry</span>
                <span>Exit</span>
                <span>P&L</span>
              </div>
              {selectedDayData.trades.map((t, i) => (
                <div key={t.id || i} className="pnl-calendar__detail-table-row">
                  <span>{new Date(t.tradeTime + 'Z').toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="pnl-calendar__detail-symbol">{t.symbol}</span>
                  <span className="orders-type-badge">{t.instrumentType || 'EQUITY'}</span>
                  <span>{t.qty}</span>
                  <span>{formatCurrencyFull(t.entryPrice)}</span>
                  <span>{formatCurrencyFull(t.exitPrice)}</span>
                  <span style={{ fontWeight: 800, color: t.realizedPnL >= 0 ? 'var(--green)' : 'var(--red)' }}>
                    {t.realizedPnL >= 0 ? '+' : ''}{formatCurrencyFull(t.realizedPnL)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="pnl-calendar__detail-empty">No closed trades on this day. Orders placed but positions may still be open.</p>
          )}
        </div>
      )}
    </section>
  );
}

export default PnlCalendar;
