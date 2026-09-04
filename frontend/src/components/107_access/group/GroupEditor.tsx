import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Maximize2 } from 'lucide-react';
import { Button } from '@/UI/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/UI/sheet';
import { type GroupDetail } from '../services/policy.service';
import GroupPanel from './GroupPanel';

interface Props {
  groupId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

/**
 * The slide-over form of the group editor.
 *
 * Kept for the quick change from the list, with the body shared with the full
 * page at /access/groups/:id — see GroupPanel. The expand control is there
 * because a group with a long door list and a membership editor outgrows a
 * sheet, and because a page can be linked to and reloaded.
 */
export default function GroupEditor({ groupId, open, onOpenChange, onSaved }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [group, setGroup] = useState<GroupDetail | null>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle>{group ? group.name : t('access.groups.edit')}</SheetTitle>
            {groupId && (
              <Button
                variant="ghost"
                size="sm"
                title={t('access.groups.openFull')}
                onClick={() => { onOpenChange(false); navigate(`/access/groups/${groupId}`); }}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="mt-4">
          <GroupPanel
            groupId={groupId}
            onSaved={onSaved}
            onCancel={() => onOpenChange(false)}
            onLoaded={setGroup}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
