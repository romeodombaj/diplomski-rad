import { Badge } from '@/UI/badge';
import { useTranslation } from 'react-i18next';
import type { SyncStatus } from '../services/policy.service';

/**
 * Where a grant has got to on its way to the chain.
 *
 * This is shown rather than hidden because the states are not cosmetic: only
 * `synced` actually opens a door. A `pending` row is a promise the chain has
 * not accepted, and a `failed` one is a grant an operator believes they made
 * and did not. Collapsing them into a checkmark would let someone walk up to a
 * door the dashboard says they can open.
 */
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
