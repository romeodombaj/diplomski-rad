import { useTranslation } from 'react-i18next';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/UI/card';

interface Props {
  data: { hour: number; granted: number; denied: number }[];
}

/**
 * When doors were opened today, by hour.
 *
 * Stacked rather than grouped because granted + denied is a meaningful total —
 * every attempt at a door — and the question the panel answers first is "when
 * was there traffic", with the split as the second read.
 *
 * COLOUR. Blue for granted, amber for denied, from --chart-granted /
 * --chart-denied in index.css. Deliberately not green/red: red-green is the one
 * pair a deuteranope cannot separate, and separating those two categories is
 * this chart's entire job. Both pairs were checked with the palette validator
 * (protanopia ΔE 29.3 light, 25.7 dark, against a floor of 8) and the dark steps
 * were re-picked rather than lightened, because the dark lightness band is lower
 * than the light one.
 *
 * The legend is always present, and the tooltip names each series in text, so
 * identity never rests on colour alone.
 */
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
            {/* Legend above the plot, not floating in it — two series, always
                shown, so identity is never colour-alone. */}
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
                {/* Recessive grid: horizontal only, so the bars read as the marks. */}
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
                {/* 2px surface gap between the stacked segments, and rounded
                    ends only on the top of the stack. */}
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
