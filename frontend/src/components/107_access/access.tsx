import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import SyncHealthPanel from './components/SyncHealthPanel';
import GroupsTable from './components/GroupsTable';
import SchedulesTable from './components/SchedulesTable';

type Tab = 'groups' | 'schedules';

export default function Access() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('groups');

  return (
    <div className="p-0 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold">{t('access.title')}</h1>
        <p className="text-muted-foreground text-sm">{t('access.subtitle')}</p>
      </div>

      <SyncHealthPanel />

      <div className="flex gap-2 border-b">
        <Button
          variant="ghost"
          className={`rounded-none border-b-2 ${tab === 'groups' ? 'border-primary' : 'border-transparent'}`}
          onClick={() => setTab('groups')}
        >
          {t('access.tabs.groups')}
        </Button>
        <Button
          variant="ghost"
          className={`rounded-none border-b-2 ${tab === 'schedules' ? 'border-primary' : 'border-transparent'}`}
          onClick={() => setTab('schedules')}
        >
          {t('access.tabs.schedules')}
        </Button>
      </div>

      {tab === 'groups' ? <GroupsTable /> : <SchedulesTable />}
    </div>
  );
}
