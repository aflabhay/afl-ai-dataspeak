/**
 * frontend/components/ChartView.jsx
 * Renders a bar, line, or pie chart from query results using Recharts.
 */
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

const COLORS = ['#2563EB', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16'];

const formatValue = v => {
  if (v === null || v === undefined) return '';
  const n = Number(v);
  if (!isNaN(n)) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  }
  return String(v);
};

export default function ChartView({ chart, results }) {
  if (!chart) return null;

  // For historical messages, results aren't stored — fall back to data embedded in chart config
  const data = (results && results.length > 0) ? results : (chart.data || []);
  if (data.length === 0) return null;

  const { type = 'bar', xKey, yKey, title } = chart;

  // Validate keys exist in data
  if (!xKey || !yKey || !(xKey in data[0]) || !(yKey in data[0])) return null;

  // Coerce yKey values to numbers
  const chartData = data.map(row => ({
    ...row,
    [yKey]: row[yKey] !== null && row[yKey] !== undefined ? Number(row[yKey]) : 0,
  }));

  return (
    <div className="message-row assistant" style={{ marginTop: -8 }}>
      <div style={{ width: 34, flexShrink: 0 }} />
      <div className="message-body" style={{ maxWidth: '90%', width: '100%' }}>
        <div className="chart-card">
          {title && <div className="chart-title">{title}</div>}
          <ResponsiveContainer width="100%" height={320}>
            {type === 'pie' ? (
              <PieChart>
                <Pie data={chartData} dataKey={yKey} nameKey={xKey} cx="50%" cy="50%"
                  outerRadius={110} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => formatValue(v)} />
                <Legend />
              </PieChart>
            ) : type === 'line' ? (
              <LineChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: '#64748B' }}
                  angle={-35} textAnchor="end" interval="preserveStartEnd" />
                <YAxis tickFormatter={formatValue} tick={{ fontSize: 12, fill: '#64748B' }} />
                <Tooltip formatter={v => formatValue(v)} />
                <Legend />
                <Line type="monotone" dataKey={yKey} stroke={COLORS[0]} strokeWidth={2.5}
                  dot={{ r: 3 }} activeDot={{ r: 5 }} />
              </LineChart>
            ) : (
              <BarChart data={chartData} margin={{ top: 8, right: 24, left: 8, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
                <XAxis dataKey={xKey} tick={{ fontSize: 12, fill: '#64748B' }}
                  angle={-35} textAnchor="end" interval={0} />
                <YAxis tickFormatter={formatValue} tick={{ fontSize: 12, fill: '#64748B' }} />
                <Tooltip formatter={v => formatValue(v)} cursor={{ fill: '#EFF6FF' }} />
                <Bar dataKey={yKey} radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Bar>
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
