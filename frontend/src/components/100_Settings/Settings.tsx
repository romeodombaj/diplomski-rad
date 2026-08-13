import { useAuth } from '@/context/AuthContext';
import ApiKeys from './ApiKeys';

export default function Settings() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  return (
    <div className="max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {isAdmin && <ApiKeys />}
    </div>
  );
}
