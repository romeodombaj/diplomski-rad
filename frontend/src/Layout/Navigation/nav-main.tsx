import EmergencyLockdown from "@/components/109_lockdown/EmergencyLockdown";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/UI/collapsible";
import {
    SidebarGroup,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarMenuSub,
    SidebarMenuSubButton,
    SidebarMenuSubItem,
    useSidebar,
} from "@/UI/sidebar";

export function NavMain({
    items,
}: {
    items: {
        title: string;
        url: string;
        icon?: LucideIcon;
        isActive?: boolean;
        items?: { title: string; url: string }[];
    }[];
}) {
    const { t } = useTranslation();
    const { setOpenMobile } = useSidebar();
    return (
        <SidebarGroup>
            {
}
            <div className="px-2 pb-2 group-data-[collapsible=icon]:hidden">
                <EmergencyLockdown />
            </div>
            <SidebarGroupLabel>{t('nav.platform')}</SidebarGroupLabel>
            <SidebarMenu>
                {items.map((item) =>
                    !item.items || item.items.length === 0 ? (
                        <SimpleNavItem
                            key={item.title}
                            title={item.title}
                            url={item.url}
                            icon={item.icon}
                        />
                    ) : (
                        <Collapsible
                            key={item.title}
                            asChild
                            defaultOpen={item.isActive}
                            className="group/collapsible"
                        >
                            <SidebarMenuItem>
                                <CollapsibleTrigger asChild>
                                    <SidebarMenuButton tooltip={item.title}>
                                        {item.icon && <item.icon />}
                                        <span>{item.title}</span>
                                        <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                                    </SidebarMenuButton>
                                </CollapsibleTrigger>
                                <CollapsibleContent>
                                    <SidebarMenuSub>
                                        {item.items?.map((subItem) => (
                                            <SidebarMenuSubItem
                                                key={subItem.title}
                                            >
                                                <SidebarMenuSubButton asChild>
                                                    <Link to={subItem.url} onClick={() => setOpenMobile(false)}>
                                                        <span>
                                                            {subItem.title}
                                                        </span>
                                                    </Link>
                                                </SidebarMenuSubButton>
                                            </SidebarMenuSubItem>
                                        ))}
                                    </SidebarMenuSub>
                                </CollapsibleContent>
                            </SidebarMenuItem>
                        </Collapsible>
                    )
                )}
            </SidebarMenu>
        </SidebarGroup>
    );
}

function SimpleNavItem({
    title,
    url,
    icon: Icon,
}: {
    title: string;
    url: string;
    icon?: LucideIcon;
}) {
    const { pathname } = useLocation();
    const { setOpenMobile } = useSidebar();
    const isActive = pathname === url || pathname.startsWith(url + "/");
    return (
        <SidebarMenuItem>
            <SidebarMenuButton isActive={isActive} asChild tooltip={title}>
                <Link to={url} onClick={() => setOpenMobile(false)}>
                    {Icon && <Icon />}
                    <span>{title}</span>
                </Link>
            </SidebarMenuButton>
        </SidebarMenuItem>
    );
}
