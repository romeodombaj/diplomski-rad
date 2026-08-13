import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import styles from "./AuditLogs.module.css";
import AuditLogTable from "./components/AuditLogTable";

export default function AuditLogs() {
    const { user } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        if (user && user.role !== "admin" && user.role !== "superadmin") {
            navigate("/", { replace: true });
        }
    }, [user, navigate]);

    if (!user || (user.role !== "admin" && user.role !== "superadmin")) return null;

    return (
        <div className={styles.container}>
            <AuditLogTable />
        </div>
    );
}
