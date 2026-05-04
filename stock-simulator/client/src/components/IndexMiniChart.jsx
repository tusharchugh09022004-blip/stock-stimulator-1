import { useEffect, useState } from 'react';
import axios from 'axios';
import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';

export default function IndexMiniChart({ symbol, range }) {
  const [data, setData] = useState([]);
  const [positive, setPositive] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const decodedSymbol = decodeURIComponent(symbol);
        const res = await axios.get(`/api/chart/${encodeURIComponent(decodedSymbol)}`, {
          params: { range }
        });
        const points = res.data?.points || [];
        if (!cancelled) {
          setData(points);
          const first = points[0]?.close || 0;
          const last = points[points.length - 1]?.close || 0;
          setPositive(last >= first);
        }
      } catch (err) {
        if (!cancelled) setData([]);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [symbol, range]);

  if (data.length === 0) {
    return <div className="index-mini-loading" />;
  }

  return (
    <div className="index-mini-chart">
      <ResponsiveContainer width="100%" height={80}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
          <YAxis domain={['dataMin', 'dataMax']} hide />
          <Area
            type="monotone"
            dataKey="close"
            stroke={positive ? '#16a34a' : '#ea580c'}
            strokeWidth={2}
            fill={positive ? '#16a34a' : '#ea580c'}
            fillOpacity={0.12}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

