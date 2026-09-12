import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { useTranslation } from 'react-i18next';
import { Button } from '@/UI/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/UI/dialog';
import { Copy, RefreshCw } from 'lucide-react';
import { PersonService, type EnrollmentInvite } from '../services/person.service';

interface Props {
  personId: string | null;
  personName?: string;
  invite: EnrollmentInvite | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReissued?: (invite: EnrollmentInvite) => void;
}

export default function EnrollmentDialog({
  personId, personName, invite, open, onOpenChange, onReissued,
}: Props) {
  const { t } = useTranslation();
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [reissuing, setReissuing] = useState(false);
  const [copied, setCopied] = useState(false);

  const payload = invite
    ? JSON.stringify({
        v: 1,
        backend: window.location.origin,
        token: invite.token,
        person_id: invite.person_id,
      })
    : null;

  useEffect(() => {
    if (!payload) { setDataUrl(null); return; }
    let cancelled = false;
    QRCode.toDataURL(payload, { width: 320, margin: 1, errorCorrectionLevel: 'M' })
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setDataUrl(null); });
    return () => { cancelled = true; };
  }, [payload]);

  async function handleReissue() {
    if (!personId || reissuing) return;
    setReissuing(true);
    try {
      const fresh = await PersonService.issueEnrollment(personId);
      onReissued?.(fresh);
    } finally {
      setReissuing(false);
    }
  }

  const expires = invite ? new Date(invite.expires_at) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('enrollment.title')}</DialogTitle>
          <DialogDescription>
            {personName
              ? t('enrollment.descriptionNamed', { name: personName })
              : t('enrollment.description')}
          </DialogDescription>
        </DialogHeader>

        {dataUrl && invite ? (
          <div className="flex flex-col items-center gap-3">
            <div className="rounded-lg bg-white p-3">
              <img src={dataUrl} alt={t('enrollment.qrAlt')} className="h-[240px] w-[240px]" />
            </div>
            {
}
            <div className="w-full flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground text-center">
                {t('enrollment.manualEntry')}
              </p>
              <code
                onClick={(e) => {
                  const sel = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(e.currentTarget);
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }}
                className="block w-full select-all cursor-pointer rounded-md border bg-muted/50
                           px-3 py-2 font-mono text-[11px] leading-relaxed break-all text-center"
              >
                {invite.token}
              </code>
            </div>

            {expires && (
              <p className="text-xs text-muted-foreground">
                {t('enrollment.expires', { date: expires.toLocaleString() })}
              </p>
            )}
            <p className="text-xs text-muted-foreground text-center px-4">
              {t('enrollment.oneTimeWarning')}
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">
            {t('enrollment.noActiveToken')}
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 mt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!invite}
            onClick={() => {
              if (!invite) return;
              navigator.clipboard?.writeText(invite.token);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            <Copy className="h-4 w-4 mr-2" />
            {copied ? t('common.copied') : t('enrollment.copyToken')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleReissue} disabled={reissuing || !personId}>
            <RefreshCw className={`h-4 w-4 mr-2${reissuing ? ' animate-spin' : ''}`} />
            {t('enrollment.reissue')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
