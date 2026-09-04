import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Users, DoorOpen, Maximize2 } from 'lucide-react';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import { Input } from '@/UI/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/UI/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/UI/alert-dialog';
import { PolicyService, type AccessGroup } from '../services/policy.service';
import GroupEditor from '../group/GroupEditor';

export default function GroupsTable() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<AccessGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [deleting, setDeleting] = useState<AccessGroup | null>(null);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setGroups(await PolicyService.listGroups());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!newName.trim()) return;
    try {
      await PolicyService.createGroup({ name: newName.trim() });
      setNewName('');
      load();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">{t('access.groups.newGroup')}</span>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('access.groups.namePlaceholder')}
              className="w-64"
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <Button onClick={create} disabled={!newName.trim()}>
              <Plus className="mr-1 h-4 w-4" />
              {t('access.groups.add')}
            </Button>
          </div>
        </div>
      </div>

      {error && <p className="text-destructive text-sm mb-2">{error}</p>}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('access.groups.name')}</TableHead>
              <TableHead>{t('access.groups.doors')}</TableHead>
              <TableHead>{t('access.groups.members')}</TableHead>
              {/* The number of on-chain transactions one more member costs. */}
              <TableHead>{t('access.groups.fanOut')}</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={5}>{t('access.groups.loading')}</TableCell></TableRow>
            )}
            {!loading && groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  {t('access.groups.empty')}
                </TableCell>
              </TableRow>
            )}
            {groups.map((g) => (
              <TableRow
                key={g.id}
                className="cursor-pointer"
                onClick={() => navigate(`/access/groups/${g.id}`)}
              >
                <TableCell className="font-medium">
                  {g.name}
                  {g.is_default && (
                    <Badge variant="secondary" className="ml-2">{t('access.groups.default')}</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1">
                    <DoorOpen className="h-3 w-3 text-muted-foreground" />{g.door_count}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3 text-muted-foreground" />{g.member_count}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={g.fan_out > 5 ? 'destructive' : 'outline'} title={t('access.groups.fanOutHint')}>
                    {g.fan_out} tx
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {/* Two ways in on purpose: the sheet for a quick door tick,
                      the page for membership and anything that needs room. */}
                  <Button variant="ghost" size="icon" title={t('access.groups.edit')}
                    onClick={(e) => { e.stopPropagation(); setEditing(g.id); setEditorOpen(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" title={t('access.groups.openFull')}
                    onClick={(e) => { e.stopPropagation(); navigate(`/access/groups/${g.id}`); }}>
                    <Maximize2 className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon"
                    onClick={(e) => { e.stopPropagation(); setDeleting(g); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <GroupEditor
        groupId={editing}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSaved={load}
      />

      <AlertDialog open={deleting !== null} onOpenChange={() => setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('access.groups.deleteTitle', { name: deleting?.name })}</AlertDialogTitle>
            <AlertDialogDescription>
              {/* Deleting a group revokes every policy it produced — on chain,
                  one transaction per (member × door). Say the number. */}
              {t('access.groups.deleteBody', {
                count: (deleting?.door_count ?? 0) * (deleting?.member_count ?? 0),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('access.groups.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleting) await PolicyService.deleteGroup(deleting.id);
                setDeleting(null);
                load();
              }}
            >
              {t('access.groups.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
