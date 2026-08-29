import { type ColumnDef } from "@tanstack/react-table";
import { useTranslation } from "react-i18next";
import { Badge } from "@/UI/badge";
import { type AuditLog } from "../services/auditLog.service";

/**
 * One row per access decision.
 *
 * Denials carry the most information here — a run of `invalid_signature` or
 * `door_not_in_scope` against one DID is what an operator is actually looking
 * for, so the reason is a first-class column rather than a detail-view field.
 */
function DecisionCell({ row }: { row: AuditLog }) {
  const { t } = useTranslation();
  const granted = row.decision === "granted";
  return (
    <div className="flex items-center gap-2">
      <Badge variant={granted ? "default" : "destructive"}>
        {granted ? t("auditLog.granted") : t("auditLog.denied")}
      </Badge>
      {!granted && (
        <span className="text-muted-foreground text-xs font-mono">{row.reason}</span>
      )}
    </div>
  );
}

/**
 * Whether the decision was actually checked against the chain, and whether the
 * signature verified. A granted row with either unset was let through on local
 * data alone — worth seeing at a glance rather than hunting for.
 */
function TrustCell({ row }: { row: AuditLog }) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1">
      <Badge
        variant={row.signature_verified ? "outline" : "destructive"}
        title={t("auditLog.signatureTitle")}
      >
        sig
      </Badge>
      <Badge
        variant={row.chain_checked ? "outline" : "secondary"}
        title={t("auditLog.chainTitle")}
      >
        chain
      </Badge>
    </div>
  );
}

export function useAuditLogColumns(): ColumnDef<AuditLog>[] {
  const { t } = useTranslation();
  return [
    {
      accessorKey: "occurred_at",
      header: t("auditLog.columns.occurredAt"),
      enableSorting: true,
      cell: ({ row }) => new Date(row.original.occurred_at).toLocaleString(),
    },
    {
      accessorKey: "decision",
      header: t("auditLog.columns.decision"),
      enableSorting: true,
      cell: ({ row }) => <DecisionCell row={row.original} />,
    },
    {
      accessorKey: "person_name",
      header: t("auditLog.columns.person"),
      enableSorting: false,
      // A denial often has no person to join to — show the DID rather than a blank.
      cell: ({ row }) =>
        row.original.person_name ?? (
          <span className="text-muted-foreground font-mono text-xs">
            {row.original.did.slice(0, 24)}…
          </span>
        ),
    },
    {
      accessorKey: "door_code",
      header: t("auditLog.columns.door"),
      enableSorting: true,
      cell: ({ row }) =>
        row.original.door_name
          ? `${row.original.door_name} (${row.original.door_code})`
          : row.original.door_code,
    },
    {
      accessorKey: "face_score",
      header: t("auditLog.columns.faceScore"),
      enableSorting: false,
      cell: ({ row }) =>
        row.original.face_score == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          row.original.face_score.toFixed(2)
        ),
    },
    {
      id: "trust",
      header: t("auditLog.columns.verified"),
      enableSorting: false,
      cell: ({ row }) => <TrustCell row={row.original} />,
    },
    {
      accessorKey: "event_hash",
      header: t("auditLog.columns.eventHash"),
      enableSorting: false,
      // The value written to the on-chain AuditLog — the row's proof of record.
      cell: ({ row }) => (
        <span className="font-mono text-xs" title={row.original.event_hash}>
          {row.original.event_hash.slice(0, 10)}…
        </span>
      ),
    },
  ];
}
