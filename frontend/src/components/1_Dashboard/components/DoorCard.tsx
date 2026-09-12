import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Cpu, Clock, ChevronRight } from 'lucide-react';
import { Badge } from '@/UI/badge';
import { Card, CardContent } from '@/UI/card';
import UnlockButton from '@/components/105_doors/components/UnlockButton';
import type { DoorCard as DoorCardData } from '../services/dashboard.service';

interface Props {
  door: DoorCardData;
  onUnlocked: () => void;
}

function lastOpened(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
}

export default function DoorCardTile({ door, onUnlocked }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const last = lastOpened(door.last_opened_at, i18n.language);

  return (
    <Card className={door.active ? undefined : 'opacity-70'}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            className="group min-w-0 text-left"
            onClick={() => navigate(`/doors/${door.id}`)}
          >
            <span className="flex items-center gap-1 font-medium group-hover:underline">
              <span className="truncate">{door.name}</span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </span>
            <span className="text-muted-foreground block font-mono text-xs">
              {door.door_code}
            </span>
          </button>
          {!door.active && (
            <Badge variant="secondary" className="shrink-0">
              {t('dashboard.doors.outOfService')}
            </Badge>
          )}
        </div>

        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-1 tabular-nums">
            <Clock className="h-3.5 w-3.5" />
            {last
              ? t('dashboard.doors.lastOpened', {
                  time: last,
                  who: door.last_opened_by ?? t('dashboard.doors.unknownWho'),
                })
              : t('dashboard.doors.notOpenedToday')}
          </span>
          <span className="tabular-nums">
            {t('dashboard.doors.opensToday', { count: door.opens_today })}
          </span>
          {door.denials_today > 0 && (
            <span className="tabular-nums">
              {t('dashboard.doors.denialsToday', { count: door.denials_today })}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          {door.lock ? (
            <span className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-xs">
              <Cpu className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{door.lock.name}</span>
              <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                {door.lock.profile}
              </Badge>
              {!door.lock.active && (
                <Badge variant="secondary" className="shrink-0">
                  {t('dashboard.doors.lockInactive')}
                </Badge>
              )}
            </span>
          ) : (
            <span
              className="text-muted-foreground flex items-center gap-1.5 text-xs"
              title={t('dashboard.doors.noLockHint', { topic: door.mqtt_topic })}
            >
              <CircleAlert className="h-3.5 w-3.5 shrink-0" />
              {t('dashboard.doors.noLock')}
            </span>
          )}

          <div className="shrink-0">
            <UnlockButton door={door} onUnlocked={onUnlocked} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
