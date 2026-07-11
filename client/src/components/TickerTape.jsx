import { useEffect, useRef } from 'react';

export default function TickerTape({ stocks }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let animId;
    let paused = false;

    const tick = () => {
      if (!paused) {
        el.scrollLeft += 1;
        if (el.scrollLeft >= el.scrollWidth / 2) el.scrollLeft = 0;
      }
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    const onEnter = () => { paused = true; };
    const onLeave = () => { paused = false; };
    el.addEventListener('mouseenter', onEnter);
    el.addEventListener('mouseleave', onLeave);

    return () => {
      cancelAnimationFrame(animId);
      el.removeEventListener('mouseenter', onEnter);
      el.removeEventListener('mouseleave', onLeave);
    };
  }, [stocks]);

  if (!stocks || stocks.length === 0) return null;

  const items = stocks.slice(0, 20);

  return (
    <div className="ticker-tape" ref={scrollRef}>
      <div className="ticker-tape__track">
        {[...items, ...items].map((s, i) => {
          const change = s.change ?? 0;
          const pct = s.changePercent ?? 0;
          const positive = change >= 0;
          return (
            <span key={i} className="ticker-tape__item">
              <strong>{s.symbol}</strong>
              <span>₹{Number(s.price ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className={positive ? 'ticker-tape__change--positive' : 'ticker-tape__change--negative'}>
                {positive ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
