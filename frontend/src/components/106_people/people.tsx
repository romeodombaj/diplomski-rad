import styles from './people.module.css';
import PeopleTable from './components/PeopleTable';

export default function People() {
  return (
    <div className={styles.container}>
      <div className="p-0 sm:p-6">
        <PeopleTable />
      </div>
    </div>
  );
}
