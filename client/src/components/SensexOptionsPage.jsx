import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import axios from 'axios';
import useLiveOptionPrices from '../hooks/useLiveOptionPrices';

const STEP = 100;
const ATM_RANGE = 15;

export default function SensexOptionsPage({ onBack, onOptionClick }) {
  const [expiries, setExpiries] = useState([]);
  const [selectedExpiry, setSelectedExpiry] = useState('');
  const [searchStrike, setSearchStrike] = useState('');
  const [spotPrice, setSpotPrice] = useState(79500);
  const [optionChain, setOptionChain] = useState([]);
  const [loading, setLoading] = useState(false);
  const tableRef = useRef(null);

  const strikes = useMemo(() => optionChain.map(item => item.strike), [optionChain]);
  const { getLiveLTP } = useLiveOptionPrices('SENSEX', strikes);

  useEffect(() => {
    const fetchExpiries = async () => {
      try {
        const res = await axios.get('/api/options/expiries/SENSEX');
        setExpiries(res.data || []);
        if (res.data?.length && !selectedExpiry) {
          setSelectedExpiry(res.data[0].timestamp.toString());
        }
      } catch (err) {
        console.error('Failed to fetch expiries:', err);
      }
    };
    fetchExpiries();
  }, []);

  const fetchChain = useCallback(async () => {
    if (!selectedExpiry) return;
    try {
      setLoading(true);
      const res = await axios.get(`/api/options/chain/SENSEX?expiry=${selectedExpiry}`);
      setSpotPrice(res.data.spot);

      const chain = res.data.chain.map(item => ({
        strike: item.strike,
        callPremium: item.call.ltp.toFixed(2),
        putPremium: item.put.ltp.toFixed(2),
        isATM: item.isATM,
        callOI: item.call.oi,
        putOI: item.put.oi,
        callVolume: item.call.volume,
        putVolume: item.put.volume,
        callIV: item.call.iv,
        putIV: item.put.iv
      }));

      setOptionChain(chain);
      setLoading(false);
    } catch (err) {
      console.error('Failed to fetch options chain:', err);
      setLoading(false);
    }
  }, [selectedExpiry]);

  useEffect(() => {
    if (!selectedExpiry) return;
    setOptionChain([]);
    fetchChain();

    const interval = setInterval(fetchChain, 3000);
    return () => clearInterval(interval);
  }, [selectedExpiry]);

  const handleSearch = (value) => {
    setSearchStrike(value);
    if (value && tableRef.current) {
      const row = tableRef.current.querySelector(`[data-strike="${value}"]`);
      if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const atmFilteredChain = optionChain.filter(item => {
    if (!item || typeof item.strike !== 'number') return true;
    const atmStrike = Math.round(spotPrice / STEP) * STEP;
    const minStrike = atmStrike - STEP * ATM_RANGE;
    const maxStrike = atmStrike + STEP * ATM_RANGE;
    return item.strike >= minStrike && item.strike <= maxStrike;
  });

  const filteredChain = atmFilteredChain.filter(item => {
    if (!searchStrike) return true;
    return item.strike.toString().includes(searchStrike);
  });

  return (
    <div className="options-page">
      <header className="options-page__header">
        <div className="options-page__header-left">
          <button className="options-page__back" onClick={onBack}>
            ← Dashboard
          </button>
          <h1 className="options-page__title">SENSEX OPTIONS</h1>
        </div>

        <div className="options-page__header-center">
          <span className="options-page__spot-label">Spot</span>
          <span className="options-page__spot-value">₹{spotPrice.toFixed(2)}</span>
        </div>

        <div className="options-page__header-right">
          <select
            className="options-page__expiry"
            value={selectedExpiry}
            onChange={(e) => setSelectedExpiry(e.target.value)}
          >
            {expiries.map((exp) => (
              <option key={exp.timestamp} value={exp.timestamp}>{exp.label}</option>
            ))}
          </select>
          <input
            type="text"
            className="options-page__search"
            placeholder="Search Strike"
            value={searchStrike}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <button className="options-page__refresh" onClick={fetchChain}>
            ↻
          </button>
        </div>
      </header>

      <div className="options-page__chain">
        <div className="options-chain-table" ref={tableRef}>
          <div className="options-chain-table__header">
            <div className="options-chain-table__cell options-chain-table__cell--call">CALL PRICE</div>
            <div className="options-chain-table__cell options-chain-table__cell--strike">STRIKE</div>
            <div className="options-chain-table__cell options-chain-table__cell--put">PUT PRICE</div>
          </div>

          <div className="options-chain-table__body">
            {filteredChain.map((item) => (
              <div
                key={item.strike}
                data-strike={item.strike}
                className={`options-chain-table__row ${item.isATM ? 'options-chain-table__row--atm' : ''}`}
              >
                <div
                  className="options-chain-table__cell options-chain-table__cell--call options-chain-table__cell--clickable"
                  onClick={() => onOptionClick({
                    contract: `SENSEX ${item.strike} CE`,
                    strike: item.strike,
                    type: 'CE',
                    index: 'SENSEX',
                    expiry: expiries.find(e => e.timestamp.toString() === selectedExpiry)?.date || '',
                    premium: item.callPremium,
                    spotPrice: spotPrice
                  })}
                >
                  ₹{getLiveLTP(item.strike, 'CE')?.toFixed(2) ?? item.callPremium}
                </div>
                <div className="options-chain-table__cell options-chain-table__cell--strike">
                  {item.strike}
                </div>
                <div
                  className="options-chain-table__cell options-chain-table__cell--put options-chain-table__cell--clickable"
                  onClick={() => onOptionClick({
                    contract: `SENSEX ${item.strike} PE`,
                    strike: item.strike,
                    type: 'PE',
                    index: 'SENSEX',
                    expiry: expiries.find(e => e.timestamp.toString() === selectedExpiry)?.date || '',
                    premium: item.putPremium,
                    spotPrice: spotPrice
                  })}
                >
                  ₹{getLiveLTP(item.strike, 'PE')?.toFixed(2) ?? item.putPremium}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}