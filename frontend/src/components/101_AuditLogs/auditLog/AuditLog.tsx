import { useNavigate, useParams } from 'react-router-dom';
import { Button } from '@/UI/button';

interface Props {
  id?: string;
  onSuccess?: () => void;
}

export default function AuditLog({ id: propId, onSuccess }: Props = {}) {
  const params = useParams<{ id: string }>();
  const id = propId ?? params.id;
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      {/* TODO: add content */}
      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={() => onSuccess ? onSuccess() : navigate('/auditLogs')}>Cancel</Button>
        <Button onClick={() => { /* TODO: implement save */ }}>Save</Button>
      </div>
    </div>
  );
}
