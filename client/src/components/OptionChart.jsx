import React, { useState, useEffect, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  ReferenceLine
} from 'recharts';

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;

// Mock chart data generator
const generateChartData = (basePrice, points = 100) => {
  const data = [];
  let price = basePrice;
  const now = new Date();
  
  for (let i = points; i >= 0; i--) {
    const time = new Date(now - i * 60000); // 1 minute intervals
    const change = (Math.random() - 0.5) * (basePrice * 0.002);
    price = Math.max(1, price + change);
    
    data.push({
      time: time.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
      open: price,
      high: price + Math.random() * (basePrice * 0.001),
      low: price - Math.random() * (basePrice * 0.001),
      close: price + (Math.random() - 0.5) * (basePrice * 0.0005),
      volume: Math.floor(Math.random() * 1000) + 100
    });
  }
  
  return data;
};

// Calculate technical indicators
const calculateEMA = (data, period) => {
  const ema = [];
  const multiplier = 2 / (period + 1);
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      ema.push(null);
    } else if (i === period - 1) {
      const sum = data.slice(0, period).reduce((acc, val) => acc + val.close, 0);
      ema.push(sum / period);
    } else {
      ema.push((data[i].close - ema[i - 1]) * multiplier + ema[i - 1]);
    }
  }
  
  return ema;
};

const calculateVWAP = (data) => {
  const vwap = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;
  
  for (let i = 0; i < data.length; i++) {
    const typicalPrice = (data[i].high + data[i].low + data[i].close) / 3;
    cumulativeTPV += typicalPrice * data[i].volume;
    cumulativeVolume += data[i].volume;
    vwap.push(cumulativeTPV / cumulativeVolume);
  }
  
  return vwap;
};

const calculateRSI = (data, period = 14) => {
  const rsi = [];
  const gains = [];
  const losses = [];
  
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      rsi.push(null);
    } else {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }
  
  return rsi;
};

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.[0]) return null;
  
  const point = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{point.time}</strong>
      <span>O: {formatCurrency(point.open)}</span>
      <span>H: {formatCurrency(point.high)}</span>
      <span>L: {formatCurrency(point.low)}</span>
      <span>C: {formatCurrency(point.close)}</span>
      <span>Vol: {point.volume}</span>
    </div>
  );
}

export default function OptionChart({ optionData }) {
  const [interval, setInterval] = useState('1m');
  const [showEMA, setShowEMA] = useState(true);
  const [showVWAP, setShowVWAP] = useState(true);
  const [showRSI, setShowRSI] = useState(false);
  const [chartData, setChartData] = useState([]);

  const intervals = [
    { value: '1m', label: '1 Min' },
    { value: '5m', label: '5 Min' },
    { value: '15m', label: '15 Min' },
    { value: '30m', label: '30 Min' },
    { value: '1h', label: '1 Hour' },
    { value: '1d', label: '1 Day' }
  ];

  useEffect(() => {
    const basePrice = optionData?.ltp || 100;
    setChartData(generateChartData(basePrice));
  }, [optionData, interval]);

  const emaData = useMemo(() => calculateEMA(chartData, 9), [chartData]);
  const vwapData = useMemo(() => calculateVWAP(chartData), [chartData]);
  const rsiData = useMemo(() => calculateRSI(chartData, 14), [chartData]);

  const chartWithIndicators = chartData.map((point, i) => ({
    ...point,
    ema: emaData[i],
    vwap: vwapData[i],
    rsi: rsiData[i]
  }));

  const isPositive = chartData.length > 0 && chartData[chartData.length - 1]?.close >= chartData[0]?.open;

  return (
    <div className="option-chart-container">
      <div className="chart-controls">
        <div className="interval-selector">
          {intervals.map((int) => (
            <button
              key={int.value}
              className={`interval-btn ${interval === int.value ? 'interval-btn--active' : ''}`}
              onClick={() => setInterval(int.value)}
            >
              {int.label}
            </button>
          ))}
        </div>
        
        <div className="indicator-toggles">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showEMA}
              onChange={(e) => setShowEMA(e.target.checked)}
            />
            EMA
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showVWAP}
              onChange={(e) => setShowVWAP(e.target.checked)}
            />
            VWAP
          </label>
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showRSI}
              onChange={(e) => setShowRSI(e.target.checked)}
            />
            RSI
          </label>
        </div>
      </div>

      <div className="chart-wrapper">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartWithIndicators} margin={{ top: 16, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="chartFillPositive" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#16a34a" stopOpacity={0.38} />
                <stop offset="95%" stopColor="#16a34a" stopOpacity={0.03} />
              </linearGradient>
              <linearGradient id="chartFillNegative" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#ea580c" stopOpacity={0.38} />
                <stop offset="95%" stopColor="#ea580c" stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis 
              dataKey="time" 
              tick={{ fill: '#64748b', fontSize: 11 }} 
              axisLine={false} 
              tickLine={false} 
              minTickGap={30}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              domain={['dataMin - 5', 'dataMax + 5']}
              tickFormatter={(value) => `₹${Number(value).toFixed(0)}`}
            />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine 
              y={chartData[0]?.open} 
              stroke="#94a3b8" 
              strokeDasharray="4 4" 
              label="Open"
            />
            {showEMA && (
              <Area
                type="monotone"
                dataKey="ema"
                stroke="#8b5cf6"
                strokeWidth={2}
                fill="none"
                dot={false}
                name="EMA"
              />
            )}
            {showVWAP && (
              <Area
                type="monotone"
                dataKey="vwap"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="none"
                dot={false}
                name="VWAP"
              />
            )}
            <Area
              type="monotone"
              dataKey="close"
              stroke={isPositive ? '#16a34a' : '#ea580c'}
              strokeWidth={2}
              fill={isPositive ? 'url(#chartFillPositive)' : 'url(#chartFillNegative)'}
              dot={false}
              activeDot={{ r: 4, fill: isPositive ? '#16a34a' : '#ea580c' }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {showRSI && (
        <div className="rsi-chart">
          <ResponsiveContainer width="100%" height={100}>
            <AreaChart data={chartWithIndicators} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis 
                dataKey="time" 
                tick={{ fill: '#64748b', fontSize: 10 }} 
                axisLine={false} 
                tickLine={false}
                hide
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                domain={[0, 100]}
              />
              <ReferenceLine y={70} stroke="#ea580c" strokeDasharray="3 3" />
              <ReferenceLine y={30} stroke="#16a34a" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="rsi"
                stroke="#3b82f6"
                strokeWidth={2}
                fill="#3b82f6"
                fillOpacity={0.2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
