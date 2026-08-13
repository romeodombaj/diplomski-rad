import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import UsersTable from './components/UsersTable';
import styles from '../101_AuditLogs/AuditLogs.module.css';

export default function Users() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && user.role !== 'admin' && user.role !== 'superadmin') {
      navigate('/', { replace: true });
    }
  }, [user, navigate]);

  if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) return null;

  return (
    <div className={styles.container}>
      <UsersTable />
    </div>
  );
}
