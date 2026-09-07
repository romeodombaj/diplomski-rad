import * as React from "react";
import { Cpu, DoorOpen, GalleryVerticalEnd, KeyRound, Logs, Users, Contact } from "lucide-react";
import { useTranslation } from "react-i18next";

import { NavMain } from "@/Layout/Navigation/nav-main";
import { NavSecondary } from "@/Layout/Navigation/nav-secondary";
import { NavUser } from "@/Layout/Navigation/nav-user";
import { BuildingSwitcher } from "@/Layout/Navigation/building-switcher";
import { useAuth } from "@/context/AuthContext";
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarRail,
} from "@/UI/sidebar";
import { Link } from "react-router-dom";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
    const { t } = useTranslation();
    const { user } = useAuth();

    const navMain = [
        { title: t('nav.dashboard'), url: "/", icon: GalleryVerticalEnd, items: [] },
        // Buildings deliberately has no nav item: BuildingSwitcher below is
        // where a building is chosen, added, renamed and deleted, the way a
        // project switcher works. A tab would be a second, competing place to
        // do the same thing.
    // gt:tab:105_doors
    { title: t('nav.doors'), url: '/doors', icon: DoorOpen, items: [] },
    // gt:tab:106_people
    { title: t('nav.people'), url: '/people', icon: Contact, items: [] },
    // gt:tab:107_access
    { title: t('nav.access'), url: '/access', icon: KeyRound, items: [] },
        // gt:tab:108_devices
    { title: t('nav.devices'), url: '/devices', icon: Cpu, items: [] },
    // gt:nav
    ];

    const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

    // Operators and the audit trail only. Settings and Backups were removed:
    // both were stubs with no backend behind them, and a nav entry that leads
    // to a page which cannot do anything is worse than no entry at all.
    const navSecondary = isAdmin
        ? [
            { title: t('nav.users'), url: "/users", icon: Users },
            { title: t('nav.auditLogs'), url: "/audit-logs", icon: Logs },
          ]
        : [];

    return (
        <Sidebar collapsible="icon" {...props}>
            <SidebarHeader>
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            asChild
                            className="h-auto p-0 hover:bg-transparent active:bg-transparent"
                        >
                            <Link
                                to="/"
                                className="flex items-center gap-2 px-2 pt-3 pb-1 transition-all duration-200 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
                            >
                                <div className="h-0 w-0 shrink-0 group-data-[collapsible=icon]:h-5 group-data-[collapsible=icon]:w-5 transition-all duration-0 delay-0  group-data-[collapsible=icon]:duration-200 group-data-[collapsible=icon]:delay-300">
                                    <img
                                        src="/logo.svg"
                                        className="h-full w-full object-contain"
                                    />
                                </div>
                                <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
                                    {/* gt:app-name */}
                                </span>
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
                <BuildingSwitcher />
            </SidebarHeader>

            <SidebarContent>
                <NavMain items={navMain} />
                {/*<NavProjects projects={data.projects} />*/}
                <NavSecondary items={navSecondary} className="mt-auto" />
            </SidebarContent>
            <SidebarFooter>
                <NavUser />
            </SidebarFooter>
            <SidebarRail />
        </Sidebar>
    );
}
