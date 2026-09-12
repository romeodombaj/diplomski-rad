import { useTranslation } from 'react-i18next';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/UI/card';

interface Props {
  data: { hour: number; granted: number; denied: number }[];
}

export default function ActivityChart({ data }: Props) {
  const { t } = useTranslation();
  const total = data.reduce((n, d) => n + d.granted + d.denied, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('dashboard.activity.title')}</CardTitle>
        <CardDescription>{t('dashboard.activity.subtitle')}</CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-muted-foreground py-16 text-center text-sm">
            {t('dashboard.activity.empty')}
          </p>
        ) : (
          <>
            {
}
            <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: 'hsl(var(--chart-granted))' }}
                />
                {t('dashboard.activity.granted')}
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: 'hsl(var(--chart-denied))' }}
                />
                {t('dashboard.activity.denied')}
              </span>
            </div>

            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid
                  vertical={false}
                  stroke="hsl(var(--border))"
                  strokeOpacity={0.6}
                />
                <XAxis
                  dataKey="hour"
                  tickLine={false}
                  axisLine={false}
                  interval={2}
                  tickFormatter={(h: number) => `${String(h).padStart(2, '0')}`}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                  contentStyle={{
                    background: 'hsl(var(--popover))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 6,
                    fontSize: 12,
                    color: 'hsl(var(--popover-foreground))',
                  }}
                  labelFormatter={(h) => t('dashboard.activity.hourLabel', { hour: String(h).padStart(2, '0') })}
                  formatter={(value, key) => [
                    Number(value ?? 0),
                    key === 'granted' ? t('dashboard.activity.granted') : t('dashboard.activity.denied'),
                  ]}
                />
                {
}
                <Bar
                  dataKey="granted"
                  stackId="a"
                  fill="hsl(var(--chart-granted))"
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                  maxBarSize={22}
                />
                <Bar
                  dataKey="denied"
                  stackId="a"
                  fill="hsl(var(--chart-denied))"
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={22}
                />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </CardContent>
    </Card>
  );
}
