import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
    RefreshCw,
    Database,
    RotateCcw,
    Plus,
    AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/apiFetch";
import { Button } from "@/UI/button";
import { Badge } from "@/UI/badge";
import {
    Table,
    TableHeader,
    TableBody,
    TableHead,
    TableRow,
    TableCell,
} from "@/UI/table";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/UI/alert-dialog";

type BackupTier = "manual" | "daily" | "weekly" | "monthly";
type BackupFilter = "all" | "monthly" | "weekly" | "daily";

const FILTER_TABS: BackupFilter[] = ["all", "monthly", "weekly", "daily"];

interface BackupEntry {
    name: string;
    tier: BackupTier;
    timestamp: string;
    nodeEnv: string;
    dbSizeBytes: number;
    compressedSizeBytes: number;
    durationMs: number;
    tableCount: number;
    totalRows: number;
    compressedFileExists: boolean;
}

const TIER_VARIANT: Record<
    BackupTier,
    "default" | "secondary" | "outline"
> = {
    manual: "default",
    daily: "secondary",
    weekly: "secondary",
    monthly: "outline",
};

const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const formatDate = (iso: string) => {
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString();
};

export default function Backups() {
    const { t } = useTranslation();
    const { user } = useAuth();
    const navigate = useNavigate();

    const isAdmin = user?.role === "admin" || user?.role === "superadmin";

    const [backups, setBackups] = useState<BackupEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [restoringName, setRestoringName] = useState<string | null>(null);
    const [restoreTarget, setRestoreTarget] = useState<BackupEntry | null>(null);
    const [error, setError] = useState("");
    const [tab, setTab] = useState<BackupFilter>("all");

    const counts = backups.reduce(
        (acc, b) => {
            acc.all++;
            acc[b.tier]++;
            return acc;
        },
        { all: 0, manual: 0, daily: 0, weekly: 0, monthly: 0 }
    );

    const filtered =
        tab === "all" ? backups : backups.filter((b) => b.tier === tab);

    useEffect(() => {
        if (user && !isAdmin) navigate("/", { replace: true });
    }, [user, isAdmin, navigate]);

    const loadBackups = async () => {
        setIsLoading(true);
        setError("");
        try {
            const res = await apiFetch("/api/backups");
            if (!res.ok) throw new Error();
            const json = await res.json();
            setBackups(json.data ?? []);
        } catch {
            setError(t("backups.loadError"));
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        if (isAdmin) loadBackups();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAdmin]);

    const handleCreate = async () => {
        setIsCreating(true);
        setError("");
        try {
            const res = await apiFetch("/api/backups/trigger", { method: "POST" });
            if (!res.ok) throw new Error();
            await loadBackups();
        } catch {
            setError(t("backups.createError"));
        } finally {
            setIsCreating(false);
        }
    };

    const handleRestore = async (backup: BackupEntry) => {
        setRestoreTarget(null);
        setRestoringName(backup.name);
        setError("");
        try {
            const res = await apiFetch(`/api/backups/${backup.name}/restore`, {
                method: "POST",
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.message);
            }
            // Reload the app so all in-memory state reflects the restored data
            setTimeout(() => window.location.reload(), 1200);
        } catch (e: any) {
            setError(e?.message || t("backups.restoreError"));
            setRestoringName(null);
        }
    };

    if (!user || !isAdmin) return null;

    return (
        <div className="max-w-5xl space-y-6 p-6">
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold">{t("backups.title")}</h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        {t("backups.subtitle")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground/80">
                        {t("backups.policy")}
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={loadBackups}
                        disabled={isLoading}
                    >
                        <RefreshCw
                            className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`}
                        />
                        {t("backups.refresh")}
                    </Button>
                    <Button size="sm" onClick={handleCreate} disabled={isCreating}>
                        <Plus className="h-4 w-4" />
                        {isCreating ? t("backups.creating") : t("backups.create")}
                    </Button>
                </div>
            </div>

            {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    {error}
                </div>
            )}

            <div className="flex gap-1 border-b">
                {FILTER_TABS.map((f) => (
                    <TabButton
                        key={f}
                        active={tab === f}
                        onClick={() => setTab(f)}
                    >
                        {t(`backups.filter.${f}`)}
                        <span className="ml-1.5 text-xs text-muted-foreground">
                            {counts[f === "all" ? "all" : f]}
                        </span>
                    </TabButton>
                ))}
            </div>

            <div className="rounded-lg border">
                {isLoading && backups.length === 0 ? (
                    <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
                        {t("backups.loading")}
                    </div>
                ) : backups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                        <Database className="h-10 w-10 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                            {t("backups.empty")}
                        </p>
                        <p className="text-xs text-muted-foreground/70">
                            {t("backups.emptyHint")}
                        </p>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                        <Database className="h-10 w-10 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">
                            {t("backups.emptyTier")}
                        </p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t("backups.colDate")}</TableHead>
                                <TableHead>{t("backups.colType")}</TableHead>
                                <TableHead>{t("backups.colEnv")}</TableHead>
                                <TableHead>{t("backups.colDbSize")}</TableHead>
                                <TableHead>{t("backups.colCompressed")}</TableHead>
                                <TableHead>{t("backups.colTables")}</TableHead>
                                <TableHead>{t("backups.colDuration")}</TableHead>
                                <TableHead className="text-right"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filtered.map((backup) => (
                                <TableRow key={backup.name}>
                                    <TableCell>
                                        <div className="text-sm font-medium">
                                            {formatDate(backup.timestamp)}
                                        </div>
                                        <div className="font-mono text-xs text-muted-foreground">
                                            {backup.name}
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant={TIER_VARIANT[backup.tier]}>
                                            {t(`backups.tier.${backup.tier}`)}
                                        </Badge>
                                    </TableCell>
                                    <TableCell>
                                        <Badge
                                            variant={
                                                backup.nodeEnv === "production"
                                                    ? "default"
                                                    : "secondary"
                                            }
                                        >
                                            {backup.nodeEnv}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {formatBytes(backup.dbSizeBytes)}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {backup.compressedFileExists ? (
                                            formatBytes(backup.compressedSizeBytes)
                                        ) : (
                                            <span className="text-xs text-destructive">
                                                {t("backups.missing")}
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-sm">
                                        {backup.tableCount} /{" "}
                                        {backup.totalRows.toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {backup.durationMs}ms
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setRestoreTarget(backup)}
                                            disabled={
                                                !backup.compressedFileExists ||
                                                restoringName === backup.name
                                            }
                                        >
                                            <RotateCcw
                                                className={`h-3.5 w-3.5 ${
                                                    restoringName === backup.name
                                                        ? "animate-spin"
                                                        : ""
                                                }`}
                                            />
                                            {restoringName === backup.name
                                                ? t("backups.restoring")
                                                : t("backups.restore")}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            <AlertDialog
                open={!!restoreTarget}
                onOpenChange={(open) => !open && setRestoreTarget(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-amber-500" />
                            {t("backups.restoreTitle")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("backups.restoreWarning")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>

                    {restoreTarget && (
                        <div className="space-y-1 rounded-md bg-muted px-4 py-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                    {t("backups.colDate")}
                                </span>
                                <span className="font-medium">
                                    {formatDate(restoreTarget.timestamp)}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                    {t("backups.rows")}
                                </span>
                                <span className="font-medium">
                                    {restoreTarget.totalRows.toLocaleString()}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">
                                    {t("backups.colEnv")}
                                </span>
                                <span className="font-medium">
                                    {restoreTarget.nodeEnv}
                                </span>
                            </div>
                        </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                        {t("backups.restoreSafetyNote")}
                    </p>

                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("backups.cancel")}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() =>
                                restoreTarget && handleRestore(restoreTarget)
                            }
                        >
                            {t("backups.confirmRestore")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={onClick}
            className={`rounded-none border-b-2 ${
                active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground"
            }`}
        >
            {children}
        </Button>
    );
}
