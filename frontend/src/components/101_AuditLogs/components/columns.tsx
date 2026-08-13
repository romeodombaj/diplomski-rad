import { type ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { type AuditLog } from "../services/auditLog.service";

export function useAuditLogColumns(): ColumnDef<AuditLog>[] {
  const { t } = useTranslation();
  return [
    { accessorKey: "id", header: t('auditLog.columns.id') },
    { accessorKey: "project_name", header: t('auditLog.columns.projectName'), enableSorting: false },
    { accessorKey: "user_email", header: t('auditLog.columns.userEmail'), enableSorting: false },
    { accessorKey: "action", header: t('auditLog.columns.action'), enableSorting: true },
    { accessorKey: "entity", header: t('auditLog.columns.entity'), enableSorting: true },
    { accessorKey: "entity_id", header: t('auditLog.columns.entityId'), enableSorting: true },
    { accessorKey: "ip", header: t('auditLog.columns.ip'), enableSorting: true },
    { accessorKey: "created_at", header: t('auditLog.columns.date'), enableSorting: true },
  ];
}

export const columns: ColumnDef<AuditLog>[] = [
  { accessorKey: "id", header: "ID" },
  { accessorKey: "project_name", header: "Project", enableSorting: false },
  { accessorKey: "user_email", header: "User", enableSorting: false },
  { accessorKey: "action", header: "Action", enableSorting: true },
  { accessorKey: "entity", header: "Entity", enableSorting: true },
  { accessorKey: "entity_id", header: "ID", enableSorting: true },
  { accessorKey: "ip", header: "IP", enableSorting: true },
  { accessorKey: "created_at", header: "Date", enableSorting: true },
];
