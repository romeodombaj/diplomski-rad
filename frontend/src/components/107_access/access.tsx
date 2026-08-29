import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import SyncHealthPanel from './components/SyncHealthPanel';
import GroupsTable from './components/GroupsTable';
import SchedulesTable from './components/SchedulesTable';

type Tab = 'groups' | 'schedules';

/**
 * Access control: what the chain enforces, and where it disagrees with what
 * this dashboard authored.
 *
 * The health panel is above the tabs on purpose. A group that reads correctly
 * here but has not reached the chain does not open anything, and drift means
 * someone granted access outside this UI entirely — both matter more than
 * whatever is being edited below.
 */
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
