import * as React from "react";
import {
    ChevronsUpDown,
    FlaskConical,
    Layers,
    Pencil,
    Plus,
    Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";

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
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/UI/dropdown-menu";
import { Input } from "@/UI/input";
import {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/UI/sidebar";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/apiFetch";

interface Building {
    id: number;
    name: string;
    address: string;
    contractAddress: string;
    sandboxBuildingId: number | null;
}

export function BuildingSwitcher() {
    const { t } = useTranslation();
    const { isMobile } = useSidebar();
    const { user, switchBuilding, refetch } = useAuth();

    const [buildings, setBuildings] = React.useState<Building[]>([]);
    const [sandboxConfirm, setSandboxConfirm] = React.useState(false);
    const [switchConfirm, setSwitchConfirm] = React.useState<Building | null>(
        null
    );

    const [addOpen, setAddOpen] = React.useState(false);
    const [newName, setNewName] = React.useState("");
    const [addLoading, setAddLoading] = React.useState(false);

    const [renamingId, setRenamingId] = React.useState<number | null>(null);
    const [renameValue, setRenameValue] = React.useState("");

    const [deleteTarget, setDeleteTarget] = React.useState<Building | null>(
        null
    );
    const [deleteConfirmName, setDeleteConfirmName] = React.useState("");
    const [deleteLoading, setDeleteLoading] = React.useState(false);

    const [dropdownOpen, setDropdownOpen] = React.useState(false);
    const isEditing = renamingId !== null || addOpen;
    const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

    const fetchBuildings = React.useCallback(async () => {
        const res = await apiFetch("/auth/buildings");
        if (res.ok) setBuildings(await res.json());
    }, []);

    React.useEffect(() => {
        if (user) fetchBuildings();
    }, [user, fetchBuildings]);

    const activeLiveBuilding = React.useMemo(() => {
        if (!user?.buildingId) return buildings[0] ?? null;
        if (!user.isSandbox)
            return (
                buildings.find((b) => b.id === user.buildingId) ??
                buildings[0] ??
                null
            );
        return (
            buildings.find((b) => b.sandboxBuildingId === user.buildingId) ??
            buildings[0] ??
            null
        );
    }, [buildings, user]);

    async function handleSandboxToggle() {
        if (!activeLiveBuilding) return;
        if (user?.isSandbox) {
            await switchBuilding(activeLiveBuilding.id);
        } else if (activeLiveBuilding.sandboxBuildingId) {
            await switchBuilding(activeLiveBuilding.sandboxBuildingId);
        }
    }

    async function handleAddBuilding() {
        if (!newName.trim()) return;
        setAddLoading(true);
        try {
            const res = await apiFetch("/auth/buildings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: newName.trim(),
                    address: "TBD",
                    contractAddress: "TBD",
                }),
            });
            if (res.ok) {
                await fetchBuildings();
                setNewName("");
                setAddOpen(false);
            }
        } finally {
            setAddLoading(false);
        }
    }

    async function handleRename(buildingId: number) {
        if (!renameValue.trim()) {
            setRenamingId(null);
            return;
        }
        const res = await apiFetch(`/auth/buildings/${buildingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: renameValue.trim() }),
        });
        if (res.ok) await fetchBuildings();
        setRenamingId(null);
    }

    async function handleDelete() {
        if (!deleteTarget) return;
        setDeleteLoading(true);
        try {
            const res = await apiFetch(`/auth/buildings/${deleteTarget.id}`, {
                method: "DELETE",
            });
            if (res.ok) {
                const data = await res.json();
                await fetchBuildings();
                if (data.switchToBuildingId) await refetch();
                setDeleteTarget(null);
                setDeleteConfirmName("");
            }
        } finally {
            setDeleteLoading(false);
        }
    }

    return (
        <>
            <SidebarMenu>
                <SidebarMenuItem>
                    <DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
                        <div className="flex items-center gap-1">
                            <DropdownMenuTrigger asChild>
                                <SidebarMenuButton
                                    size="lg"
                                    className="flex-1 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                                >
                                    <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                                        <Layers className="size-4" />
                                    </div>
                                    <div className="grid flex-1 text-left text-sm leading-tight">
                                        <span className="truncate font-semibold">
                                            {activeLiveBuilding?.name ?? t('buildings.noBuilding')}
                                        </span>
                                        <span
                                            className={`truncate text-xs transition-colors duration-[600ms] ${
                                                user?.isSandbox
                                                    ? "text-amber-400"
                                                    : "text-muted-foreground"
                                            }`}
                                        >
                                            {user?.isSandbox ? t('buildings.sandbox') : t('buildings.live')}
                                        </span>
                                    </div>
                                    <ChevronsUpDown className="ml-auto shrink-0" />
                                </SidebarMenuButton>
                            </DropdownMenuTrigger>

                            <button
                                title={user?.isSandbox ? t('buildings.switchToLive') : t('buildings.switchToSandbox')}
                                onClick={() => setSandboxConfirm(true)}
                                className={[
                                    "group-data-[collapsible=icon]:hidden",
                                    "flex size-8 shrink-0 items-center justify-center rounded-md border transition-colors duration-[600ms]",
                                    user?.isSandbox
                                        ? "border-amber-400 bg-amber-50 text-amber-600 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:hover:bg-amber-900"
                                        : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                                ].join(" ")}
                            >
                                <FlaskConical className="size-4" />
                            </button>
                        </div>

                        <DropdownMenuContent
                            className="w-[275px] min-w-56 rounded-lg max-h-[50vh] md:max-h-[500px] px-1.5"
                            align="start"
                            side={isMobile ? "bottom" : "right"}
                            sideOffset={4}
                        >
                            <DropdownMenuLabel className="text-xs text-muted-foreground">
                                {t('buildings.label')}
                            </DropdownMenuLabel>

                            {buildings.map((building) => {
                                const isRenaming = renamingId === building.id;
                                return (
                                    <DropdownMenuItem
                                        key={building.id}
                                        className={[
                                            "gap-2 p-2 group/item",
                                            isEditing
                                                ? "pointer-events-none"
                                                : "cursor-pointer",
                                        ].join(" ")}
                                        onPointerMove={
                                            isRenaming
                                                ? (e) => e.stopPropagation()
                                                : undefined
                                        }
                                        onPointerEnter={
                                            isRenaming
                                                ? (e) => e.stopPropagation()
                                                : undefined
                                        }
                                        onSelect={(e) => {
                                            if (isRenaming) {
                                                e.preventDefault();
                                                return;
                                            }
                                            if (
                                                building.id ===
                                                    activeLiveBuilding?.id &&
                                                !user?.isSandbox
                                            )
                                                return;
                                            e.preventDefault();
                                            setSwitchConfirm(building);
                                        }}
                                    >
                                        <div className="flex size-6 shrink-0 items-center justify-center rounded-sm border">
                                            <Layers className="size-3.5" />
                                        </div>

                                        {isRenaming ? (
                                            <div className="flex flex-1 items-center gap-1.5">
                                                <Input
                                                    autoFocus
                                                    value={renameValue}
                                                    onChange={(e) =>
                                                        setRenameValue(
                                                            e.target.value
                                                        )
                                                    }
                                                    onKeyDown={(e) => {
                                                        e.stopPropagation();
                                                        if (e.key === "Enter") {
                                                            e.preventDefault();
                                                            handleRename(building.id);
                                                        }
                                                        if (e.key === "Escape") {
                                                            e.preventDefault();
                                                            setRenamingId(null);
                                                        }
                                                    }}
                                                    onBlur={() => setRenamingId(null)}
                                                    className="h-6 flex-1 px-1 py-0 text-sm"
                                                />
                                                <button
                                                    onMouseDown={(e) => e.preventDefault()}
                                                    onClick={() => handleRename(building.id)}
                                                    className="shrink-0 text-xs font-medium text-primary"
                                                >
                                                    {t('buildings.save')}
                                                </button>
                                            </div>
                                        ) : (
                                            <>
                                                <span className="flex-1 truncate">
                                                    {building.name}
                                                </span>
                                                {building.id ===
                                                    activeLiveBuilding?.id &&
                                                    !user?.isSandbox && (
                                                        <span className="text-xs text-muted-foreground group-hover/item:opacity-0 duration-[300ms] ml-2">
                                                            {t('buildings.active')}
                                                        </span>
                                                    )}
                                                {isAdmin && (
                                                    <div className="ml-auto flex items-center gap-0.5 opacity-0 group-hover/item:opacity-100 translate-x-1/4 group-hover/item:translate-x-0 duration-[300ms]">
                                                        <button
                                                            className="rounded p-0.5 hover:bg-accent"
                                                            title={t('buildings.rename')}
                                                            onMouseDown={(e) => e.preventDefault()}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                e.preventDefault();
                                                                setRenamingId(building.id);
                                                                setRenameValue(building.name);
                                                            }}
                                                        >
                                                            <Pencil className="size-3" />
                                                        </button>
                                                        <button
                                                            className="rounded p-0.5 hover:bg-destructive/10 hover:text-destructive"
                                                            title={t('buildings.delete')}
                                                            onMouseDown={(e) => e.preventDefault()}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                e.preventDefault();
                                                                setDeleteTarget(building);
                                                                setDeleteConfirmName("");
                                                            }}
                                                        >
                                                            <Trash2 className="size-3" />
                                                        </button>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </DropdownMenuItem>
                                );
                            })}

                            {isAdmin && <DropdownMenuSeparator />}

                            {isAdmin && (addOpen ? (
                                <div
                                    className="flex items-center gap-1.5 p-2"
                                    onPointerDown={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();
                                    }}
                                    onPointerEnter={(e) => e.stopPropagation()}
                                    onPointerMove={(e) => e.stopPropagation()}
                                >
                                    <Input
                                        autoFocus
                                        placeholder={t('buildings.buildingNamePlaceholder')}
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        onKeyDown={(e) => {
                                            e.stopPropagation();
                                            if (e.key === "Enter") {
                                                e.preventDefault();
                                                handleAddBuilding();
                                            }
                                            if (e.key === "Escape") {
                                                e.preventDefault();
                                                setAddOpen(false);
                                                setNewName("");
                                            }
                                        }}
                                        onBlur={() => {
                                            setAddOpen(false);
                                            setNewName("");
                                        }}
                                        className="h-7 flex-1 px-2 py-0 text-sm"
                                    />
                                    <button
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={handleAddBuilding}
                                        disabled={addLoading || !newName.trim()}
                                        className="shrink-0 text-xs font-medium text-primary disabled:opacity-50"
                                    >
                                        {t('buildings.add')}
                                    </button>
                                </div>
                            ) : (
                                <DropdownMenuItem
                                    className={[
                                        "gap-2 p-2",
                                        isEditing ? "pointer-events-none" : "",
                                    ].join(" ")}
                                    onSelect={(e) => {
                                        e.preventDefault();
                                        setAddOpen(true);
                                    }}
                                >
                                    <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                                        <Plus className="size-4" />
                                    </div>
                                    <div className="font-medium text-muted-foreground">
                                        {t('buildings.addBuilding')}
                                    </div>
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </SidebarMenuItem>
            </SidebarMenu>

            <AlertDialog open={sandboxConfirm} onOpenChange={setSandboxConfirm}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {user?.isSandbox ? t('buildings.switchToLive') : t('buildings.switchToSandbox')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {user?.isSandbox ? t('buildings.switchToLiveWarning') : t('buildings.switchToSandboxWarning')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={async () => {
                                setSandboxConfirm(false);
                                await handleSandboxToggle();
                            }}
                        >
                            {user?.isSandbox ? t('buildings.switchToLive') : t('buildings.switchToSandbox')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={!!switchConfirm}
                onOpenChange={(open) => {
                    if (!open) setSwitchConfirm(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('buildings.switchToTitle', { name: switchConfirm?.name })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('buildings.switchToDescription', { name: switchConfirm?.name })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={async () => {
                                if (switchConfirm) {
                                    await switchBuilding(switchConfirm.id);
                                    setSwitchConfirm(null);
                                    setDropdownOpen(false);
                                }
                            }}
                        >
                            {t('buildings.switch')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog
                open={!!deleteTarget}
                onOpenChange={(open) => {
                    if (!open) {
                        setDeleteTarget(null);
                        setDeleteConfirmName("");
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t('buildings.deleteTitle', { name: deleteTarget?.name })}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('buildings.deleteDescription', { name: deleteTarget?.name })}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <Input
                        placeholder={deleteTarget?.name}
                        value={deleteConfirmName}
                        onChange={(e) => setDeleteConfirmName(e.target.value)}
                        onKeyDown={(e) => {
                            if (
                                e.key === "Enter" &&
                                deleteConfirmName === deleteTarget?.name
                            )
                                handleDelete();
                        }}
                        className="mt-2"
                    />
                    <AlertDialogFooter className="mt-4">
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleDelete}
                            disabled={
                                deleteConfirmName !== deleteTarget?.name ||
                                deleteLoading
                            }
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                        >
                            {t('common.delete')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
