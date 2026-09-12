import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { Badge } from '@/UI/badge';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/UI/dialog';
import { Plus, Loader2 } from 'lucide-react';
import { DeviceService, type DiscoveredDevice } from '../services/device.service';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (topic: string) => void;
}

const SCAN_SECONDS = 8;

export default function ScanDialog({ open, onOpenChange, onAdd }: Props) {
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);
  const [remaining, setRemaining] = useState(SCAN_SECONDS);
  const [found, setFound] = useState<DiscoveredDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setFound(null);
      setError(null);
      return;
    }
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!scanning) return;
    setRemaining(SCAN_SECONDS);
    const id = setInterval(() => setRemaining((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [scanning]);

  async function run() {
    setScanning(true);
    setError(null);
    setFound(null);
    try {
      setFound(await DeviceService.scan(SCAN_SECONDS));
    } catch (e: any) {
      setError(e?.message ?? 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('devices.scanTitle')}</DialogTitle>
          <DialogDescription>
            {t('devices.scanHint', { seconds: SCAN_SECONDS })}
          </DialogDescription>
        </DialogHeader>

        {scanning && (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t('devices.scanning')}</p>
            <p className="text-2xl font-semibold tabular-nums">{remaining}s</p>
          </div>
        )}

        {found !== null && !scanning && (
          <div className="flex flex-col gap-2 max-h-[380px] overflow-y-auto">
            {found.length === 0 && (
              <p className="text-sm text-muted-foreground py-6 text-center">
                {t('devices.nothingHeard')}
              </p>
            )}
            {found.map((d) => (
              <div key={d.topic} className="rounded-md border p-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {d.name && <p className="text-sm font-medium truncate">{d.name}</p>}
                    {d.source === 'tuya' && !d.name && (
                      <p className="text-sm font-medium">{t('devices.tuyaDevice')}</p>
                    )}
                    <p className="font-mono text-xs break-all">{d.topic}</p>
                    {d.ip && (
                      <p className="font-mono text-[10px] text-muted-foreground mt-0.5">{d.ip}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="tabular-nums">
                      {d.source === 'tuya'
                        ? t('devices.foundOnPort')
                        : t('devices.messages', { count: d.messages })}
                    </Badge>
                    {d.known ? (
                      <Badge variant="secondary">{t('devices.known')}</Badge>
                    ) : (
                      <Button size="sm" variant="outline" onClick={() => onAdd(d.topic)}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {
}
                {d.topics.length > 1 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
                      {t('devices.topicCount', { count: d.topics.length })}
                    </summary>
                    <div className="mt-1.5 space-y-1 border-l pl-2">
                      {d.topics.map((topic) => (
                        <div key={topic.topic}>
                          <p className="font-mono text-[10px] break-all">{topic.topic}</p>
                          {topic.sample && (
                            <p className="font-mono text-[10px] text-muted-foreground break-all">
                              {topic.sample}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {d.topics.length === 1 && d.sample && (
                  <p className="font-mono text-[10px] text-muted-foreground break-all mt-0.5">
                    {d.sample}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="grid grid-cols-2 gap-2 mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
          <Button variant="outline" onClick={run} disabled={scanning}>
            {t('devices.rescan')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
