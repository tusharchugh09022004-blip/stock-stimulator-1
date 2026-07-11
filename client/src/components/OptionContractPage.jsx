import { useState, useEffect } from 'react';
import { ResponsiveContainer, AreaChart, Area, CartesianGrid, XAxis, YAxis, Tooltip } from 'recharts';
import useLiveOptionPrices from '../hooks/useLiveOptionPrices';

const LOT_SIZES = { NIFTY: 65, SENSEX: 20 };
const getLotSize = (index) => LOT_SIZES[index] || 1;

export default function OptionContractPage({ contractData, onBack, onTrade }) {
  const lotSize = getLotSize(contractData.index);
  const { getLivePrice, getLiveLTP } = useLiveOptionPrices(contractData.index, [contractData.strike]);
  const [premium, setPremium] = useState(parseFloat(contractData.premium));
  const [quantity, setQuantity] = useState('1');
  const [orderType, setOrderType] = useState('market');
  const [limitPrice, setLimitPrice] = useState('');
  const [action, setAction] = useState('buy');
  const [chartData, setChartData] = useState([]);
  const [interval, setInterval] = useState('5m');

  const rawQty = Math.max(1, parseInt(quantity) || 0);

  // Generate mock chart data
  const generateChartData = () => {
    const data = [];
    const basePrice = premium;
    for (let i = 0; i < 50; i++) {
      data.push({
        time: `${i * 5}m`,
        close: basePrice + (Math.random() - 0.5) * 20
      });
    }
    return data;
  };

  useEffect(() => {
    setChartData(generateChartData());
    const ticker = setInterval(() => {
      const live = getLiveLTP(contractData.strike, contractData.type);
      if (live != null) setPremium(live);
    }, 1000);
    return () => clearInterval(ticker);
  }, [interval, contractData.strike, contractData.type]);

  // Live Greeks and Stats
  const livePrice = getLivePrice(contractData.strike, contractData.type);
  const liveIV = livePrice?.iv != null ? livePrice.iv : null;

  const greeks = {
    delta: (0.5 + Math.random() * 0.3).toFixed(3),
    gamma: (0.01 + Math.random() * 0.02).toFixed(4),
    theta: (-0.5 - Math.random() * 0.3).toFixed(3),
    vega: (liveIV != null ? (liveIV * 0.01).toFixed(3) : (0.1 + Math.random() * 0.2).toFixed(3)),
    rho: (0.05 + Math.random() * 0.05).toFixed(4)
  };

  const stats = {
    bid: livePrice?.bid != null ? livePrice.bid.toFixed(2) : (premium * 0.98).toFixed(2),
    ask: livePrice?.ask != null ? livePrice.ask.toFixed(2) : (premium * 1.02).toFixed(2),
    openInterest: livePrice?.oi != null ? livePrice.oi : Math.floor(Math.random() * 1000000 + 500000),
    volume: livePrice?.volume != null ? livePrice.volume : Math.floor(Math.random() * 500000 + 100000),
    iv: liveIV != null ? liveIV.toFixed(2) : (15 + Math.random() * 10).toFixed(2),
    change: livePrice?.change != null ? livePrice.change.toFixed(2) : ((Math.random() - 0.5) * 10).toFixed(2)
  };

  const contracts = rawQty * lotSize;
  const totalValue = contracts * (orderType === 'market' ? premium : parseFloat(limitPrice) || premium);

  const handleTrade = () => {
    onTrade({
      contract: contractData.contract,
      action,
      quantity: rawQty,
      premium: orderType === 'market' ? premium : parseFloat(limitPrice) || premium,
      totalValue,
      strike: contractData.strike,
      type: contractData.type,
      index: contractData.index,
      expiry: contractData.expiry
    });
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2
    }).format(value);
  };

  const formatNumber = (value) => {
    if (value >= 10000000) return (value / 10000000).toFixed(2) + ' Cr';
    if (value >= 100000) return (value / 100000).toFixed(2) + ' L';
    return value.toLocaleString();
  };

  return (
    <div className="contract-page">
      <header className="contract-page__header">
        <div className="contract-page__header-left">
          <button className="contract-page__back" onClick={onBack}>
            ← Option Chain
          </button>
          <div className="contract-page__title">
            <h1>{contractData.contract}</h1>
            <span className="contract-page__expiry">Expiry: {contractData.expiry}</span>
          </div>
        </div>
        
        <div className="contract-page__header-right">
          <span className="contract-page__premium-label">Premium</span>
          <span className={`contract-page__premium-value ${parseFloat(stats.change) >= 0 ? 'positive' : 'negative'}`}>
            ₹{premium.toFixed(2)}
            <span className="contract-page__change">
              ({parseFloat(stats.change) >= 0 ? '+' : ''}{stats.change}%)
            </span>
          </span>
        </div>
      </header>

      <div className="contract-page__content">
        <div className="contract-page__main">
          <div className="contract-page__chart">
            <div className="contract-page__chart-header">
              <h3>Price Chart</h3>
              <div className="contract-page__intervals">
                {['1m', '5m', '15m', '30m', '1h', '1d'].map(int => (
                  <button
                    key={int}
                    className={`contract-page__interval ${interval === int ? 'contract-page__interval--active' : ''}`}
                    onClick={() => setInterval(int)}
                  >
                    {int}
                  </button>
                ))}
              </div>
            </div>
            <div className="contract-page__chart-container">
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="contractFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.38} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                  <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '0.5rem' }}
                    itemStyle={{ color: '#e2e8f0' }}
                  />
                  <Area type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} fill="url(#contractFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="contract-page__greeks">
            <h3>Greeks</h3>
            <div className="greeks-grid">
              <div className="greek-card">
                <span className="greek-card__label">Delta</span>
                <span className="greek-card__value">{greeks.delta}</span>
              </div>
              <div className="greek-card">
                <span className="greek-card__label">Gamma</span>
                <span className="greek-card__value">{greeks.gamma}</span>
              </div>
              <div className="greek-card">
                <span className="greek-card__label">Theta</span>
                <span className="greek-card__value">{greeks.theta}</span>
              </div>
              <div className="greek-card">
                <span className="greek-card__label">Vega</span>
                <span className="greek-card__value">{greeks.vega}</span>
              </div>
              <div className="greek-card">
                <span className="greek-card__label">Rho</span>
                <span className="greek-card__value">{greeks.rho}</span>
              </div>
            </div>
          </div>

          <div className="contract-page__stats">
            <h3>Statistics</h3>
            <div className="stats-grid">
              <div className="stat-row">
                <span className="stat-row__label">Bid</span>
                <span className="stat-row__value">₹{stats.bid}</span>
              </div>
              <div className="stat-row">
                <span className="stat-row__label">Ask</span>
                <span className="stat-row__value">₹{stats.ask}</span>
              </div>
              <div className="stat-row">
                <span className="stat-row__label">Open Interest</span>
                <span className="stat-row__value">{formatNumber(stats.openInterest)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-row__label">Volume</span>
                <span className="stat-row__value">{formatNumber(stats.volume)}</span>
              </div>
              <div className="stat-row">
                <span className="stat-row__label">IV</span>
                <span className="stat-row__value">{stats.iv}%</span>
              </div>
              <div className="stat-row">
                <span className="stat-row__label">Spot Price</span>
                <span className="stat-row__value">₹{contractData.spotPrice.toFixed(2)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="contract-page__sidebar">
          <div className="trade-panel">
            <h3>Trade {contractData.contract}</h3>
            
            <div className="trade-panel__actions">
              <button
                className={`trade-panel__action ${action === 'buy' ? 'trade-panel__action--buy' : ''}`}
                onClick={() => setAction('buy')}
              >
                BUY
              </button>
              <button
                className={`trade-panel__action ${action === 'sell' ? 'trade-panel__action--sell' : ''}`}
                onClick={() => setAction('sell')}
              >
                SELL
              </button>
            </div>

            <div className="trade-panel__field">
              <label>Quantity (Lots)</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') { setQuantity(''); return; }
                  const num = parseInt(val);
                  if (!isNaN(num)) setQuantity(Math.max(1, num).toString());
                }}
              />
              <small style={{ color: '#94a3b8', display: 'block', marginTop: '4px' }}>
                1 Lot = {lotSize} contracts
              </small>
            </div>

            <div className="trade-panel__field">
              <label>Order Type</label>
              <div className="trade-panel__order-types">
                <button
                  className={`trade-panel__order-type ${orderType === 'market' ? 'trade-panel__order-type--active' : ''}`}
                  onClick={() => setOrderType('market')}
                >
                  Market Order
                </button>
                <button
                  className={`trade-panel__order-type ${orderType === 'limit' ? 'trade-panel__order-type--active' : ''}`}
                  onClick={() => setOrderType('limit')}
                >
                  Limit Order
                </button>
              </div>
            </div>

            {orderType === 'limit' && (
              <div className="trade-panel__field">
                <label>Limit Price</label>
                <input
                  type="number"
                  step="0.05"
                  value={limitPrice}
                  onChange={(e) => setLimitPrice(e.target.value)}
                  placeholder="Enter limit price"
                />
              </div>
            )}

            <div className="trade-panel__summary">
              <div className="trade-panel__summary-row">
                <span>Premium per Contract</span>
                <span>₹{(orderType === 'market' ? premium : parseFloat(limitPrice) || premium).toFixed(2)}</span>
              </div>
              <div className="trade-panel__summary-row">
                <span>Contracts</span>
                <span>{contracts}</span>
              </div>
              <div className="trade-panel__summary-row">
                <span>Total Value</span>
                <span className="trade-panel__summary-row--highlight">{formatCurrency(totalValue)}</span>
              </div>
            </div>

            <button className="trade-panel__submit" onClick={handleTrade}>
              {action.toUpperCase()} {contractData.contract}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
