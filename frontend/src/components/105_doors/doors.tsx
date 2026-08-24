import styles from './doors.module.css';
import DoorTable from './components/DoorTable';

export default function Doors() {
  return (
    <div className={styles.container}>
      <div className="p-0 sm:p-6">
        <DoorTable />
      </div>
    </div>
  );
}
