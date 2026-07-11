import { useEffect, useRef, useCallback, useState } from 'react';
import { io } from 'socket.io-client';

const API_URL = import.meta.env.VITE_API_URL || '';
const socket = io(API_URL || undefined, { transports: ['websocket', 'polling'] });

export default function useLiveOptionPrices(index, strikes = []) {
  const pricesRef = useRef({});
  const subsRef = useRef({});
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!index || !strikes.length) return;

    const key = `${index}:${strikes.sort().join(',')}`;
    if (subsRef.current[key]) return;
    subsRef.current[key] = true;

    socket.emit('subscribeOptionStrikes', { index, strikes });

    return () => {
      socket.emit('unsubscribeOptionStrikes', { index, strikes });
      delete subsRef.current[key];
    };
  }, [index, strikes]);

  useEffect(() => {
    const handler = (tick) => {
      if (tick.index !== index) return;
      const k = `${tick.strike}_${tick.type}`;
      pricesRef.current[k] = {
        ltp: tick.ltp,
        change: tick.change,
        oi: tick.oi,
        volume: tick.volume,
        bid: tick.bid,
        ask: tick.ask,
        timestamp: tick.timestamp
      };
      setTick(v => v + 1);
    };

    socket.on('optionPriceUpdate', handler);
    return () => socket.off('optionPriceUpdate', handler);
  }, [index]);

  const getLivePrice = useCallback((strike, type) => {
    const key = `${strike}_${type}`;
    return pricesRef.current[key] || null;
  }, []);

  const getLiveLTP = useCallback((strike, type) => {
    const entry = pricesRef.current[`${strike}_${type}`];
    return entry ? entry.ltp : null;
  }, []);

  return { getLivePrice, getLiveLTP, pricesRef };
}
