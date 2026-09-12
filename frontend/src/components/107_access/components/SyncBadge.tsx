import { Badge } from '@/UI/badge';
import { useTranslation } from 'react-i18next';
import type { SyncStatus } from '../services/policy.service';

const VARIANTS: Record<SyncStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; key: string }> = {
  synced:   { variant: 'default',     key: 'access.sync.synced' },
  pending:  { variant: 'secondary',   key: 'access.sync.pending' },
  failed:   { variant: 'destructive', key: 'access.sync.failed' },
  revoking: { variant: 'secondary',   key: 'access.sync.revoking' },
  revoked:  { variant: 'outline',     key: 'access.sync.revoked' },
};

export function SyncBadge({ status, title }: { status: SyncStatus; title?: string }) {
  const { t } = useTranslation();
  const spec = VARIANTS[status] ?? VARIANTS.pending;
  return (
    <Badge variant={spec.variant} title={title ?? t(`${spec.key}Hint`)}>
      {t(spec.key)}
    </Badge>
  );
}
