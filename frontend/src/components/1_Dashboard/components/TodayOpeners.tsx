import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/UI/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/UI/card';
import type { OpenerRow } from '../services/dashboard.service';

interface Props {
  openers: OpenerRow[];
}

/**
 * Who came in today, most recent first.
 *
 * One row per person rather than one per event: the useful reading is "who is
 * in the building and when did they last pass a door", not a raw event stream.
 * The full stream already exists on the audit page, and duplicating it here
 * would make this panel long and say less.
 *
 * A row with no person_id is a dashboard override — it keeps its own row rather
 * than folding into an unnamed group, because "somebody was let in by hand
 * today" is precisely the line an operator should not have to hunt for.
 */
export default function TodayOpeners({ openers }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{t('dashboard.openers.title')}</CardTitle>
        <CardDescription>
          {t('dashboard.openers.subtitle', { count: openers.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {openers.length === 0 ? (
          <p className="text-muted-foreground py-10 text-center text-sm">
            {t('dashboard.openers.empty')}
          </p>
        ) : (
          <div className="divide-y">
            {openers.map((o) => (
              <div
                key={o.person_id ?? o.full_name}
                className={`flex items-center justify-between gap-3 py-2 ${
                  o.person_id ? 'cursor-pointer hover:bg-muted/40' : ''
                }`}
                onClick={() => o.person_id && navigate(`/people/${o.person_id}`)}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{o.full_name}</p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {new Date(o.last_at).toLocaleTimeString(i18n.language, {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}
                    {o.last_door}
                  </p>
                </div>
                <Badge variant="outline" className="shrink-0 tabular-nums">
                  {t('dashboard.openers.opens', { count: o.opens })}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
