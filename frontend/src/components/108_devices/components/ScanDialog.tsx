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
  /** Called with a topic the operator wants to register. */
  onAdd: (topic: string) => void;
}

const SCAN_SECONDS = 8;

/**
 * Listen to the MQTT broker and show what is talking.
 *
 * Discovery is by traffic rather than by mDNS or a port scan: the broker is
 * already there, already reachable from the backend, and a device that
 * publishes tells you what it is in a way an open port never does. The
 * trade-off is that a silent device does not appear — hence "add manually"
 * remaining the way in for anything not yet on the broker.
 */
export default function ScanDialog({ open, onOpenChange, onAdd }: Props) {
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);
  /** Seconds left in the current scan, so the dialog is visibly working. */
  const [remaining, setRemaining] = useState(SCAN_SECONDS);
  const [found, setFound] = useState<DiscoveredDevice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tick the countdown while a scan is open. Driven off `scanning` rather than
  // started inside run(), so the interval is cleaned up on unmount and cannot
  // outlive a dialog the operator closed mid-scan.
  // Start listening as soon as the dialog opens. Scanning is the only thing
  // this dialog does, so making the operator press a second button to begin was
  // a step that could only ever be answered one way.
  useEffect(() => {
    if (!open) {
      setFound(null);
      setError(null);
      return;
    }
    void run();
    // run is stable enough for this: it closes over setters only.
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
            <p className="text-sm text-muted-foreground">
              {t('devices.listening', { seconds: remaining })}
            </p>
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
                    <p className="font-mono text-xs break-all">{d.topic}</p>
                    {d.ip && (
                      <p className="font-mono text-[10px] text-muted-foreground mt-0.5">{d.ip}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className="tabular-nums">
                      {t('devices.messages', { count: d.messages })}
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

                {/*
                  One device usually means several topics. Showing the count and
                  hiding the list keeps the row readable, but the list has to be
                  reachable — it is the evidence that these really are one node,
                  and an operator debugging a silent ring needs to see which of
                  its topics actually arrived.
                */}
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
