import { useCallback, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import { Card, CardContent } from '@/UI/card';
import { type GroupDetail as Group } from '../services/policy.service';
import GroupPanel from './GroupPanel';

export default function GroupDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [group, setGroup] = useState<Group | null>(null);

  const onLoaded = useCallback((g: Group) => setGroup(g), []);

  return (
    <div className="space-y-4 p-0 sm:p-6">
      <Button variant="ghost" size="sm" onClick={() => navigate('/access')}>
        <ArrowLeft className="mr-1 h-4 w-4" />{t('access.groups.back')}
      </Button>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{group?.name ?? t('common.loading')}</h1>
        {group?.is_default && (
          <Badge variant="secondary">{t('access.groups.default')}</Badge>
        )}
        {group && (
          <span className="text-muted-foreground text-sm">
            {t('access.groups.summary', {
              doors: group.doors.length,
              members: group.members.length,
            })}
          </span>
        )}
      </div>

      {group?.description && (
        <p className="text-muted-foreground text-sm">{group.description}</p>
      )}

      <Card><CardContent className="pt-6">
        <GroupPanel
          groupId={id ? Number(id) : null}
          onSaved={() => {}}
          onLoaded={onLoaded}
        />
      </CardContent></Card>
    </div>
  );
}
