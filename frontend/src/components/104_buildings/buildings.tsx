import styles from './buildings.module.css';
import BuildingTable from './components/BuildingTable';

export default function Buildings() {
  return (
    <div className={styles.container}>
      <div className="p-0 sm:p-6">
        <BuildingTable />
      </div>
    </div>
  );
}
