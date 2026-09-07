import {
    Link,
    Navigate,
    Outlet,
    useLocation,
    useNavigate,
} from "react-router-dom";
import { BookOpen, Bug, ChevronLeft, HelpCircle, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/UI/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/UI/sidebar";
import { AppSidebar } from "@/Layout/Navigation/app-sidebar";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/UI/tooltip";

import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/UI/breadcrumb";
import { Separator } from "@/UI/separator";
import { Fragment } from "react/jsx-runtime";
import { LockdownProvider } from "@/components/109_lockdown/LockdownContext";

export default function MainLayout() {
    const { t } = useTranslation();
    const { isAuthenticated } = useAuth();
    const { pathname } = useLocation();
    const navigate = useNavigate();

    const pathnames = pathname
        .split("/")
        .filter((x) => x)
        .map((value, index, array) => {
            const fullPath = `/${array.slice(0, index + 1).join("/")}`;

            return {
                link: fullPath,
                name: value.replace("_", " "),
            };
        });

    if (!isAuthenticated) return <Navigate to="/login" replace />;

    const { user } = useAuth();
    const isSandbox = !!user?.isSandbox;
    const { theme, toggleTheme } = useTheme();

    return (
        <LockdownProvider>
        <SidebarProvider className="h-svh">
            <div
                className={`fixed bottom-0 left-0 right-0 z-50 h-[6px] bg-amber-400 origin-left transition-transform duration-[1400ms] ease-in-out ${
                    isSandbox ? "scale-x-100" : "scale-x-0"
                }`}
            />
            <AppSidebar />
            <SidebarInset>
                <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4 pr-2">
                    <SidebarTrigger className="-ml-1" />
                    <Separator
                        orientation="vertical"
                        className="mr-2 data-[orientation=vertical]:h-4"
                    />
                    {pathnames.length > 0 && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 -ml-1 mr-1"
                            onClick={() =>
                                navigate(
                                    pathnames.length === 1
                                        ? "/"
                                        : pathnames[pathnames.length - 2].link
                                )
                            }
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                    )}
                    <Breadcrumb>
                        <BreadcrumbList>
                            {pathnames?.length ? (
                                pathnames.map((pathname, i) => {
                                    const isLast = i === pathnames.length - 1;
                                    return (
                                        <Fragment key={i}>
                                            {i !== 0 && (
                                                <BreadcrumbSeparator className="hidden md:block" />
                                            )}
                                            <BreadcrumbItem>
                                                {isLast ? (
                                                    <BreadcrumbPage className="capitalize font-semi-bold">
                                                        {pathname.name}
                                                    </BreadcrumbPage>
                                                ) : (
                                                    <BreadcrumbLink
                                                        asChild
                                                        className="capitalize"
                                                    >
                                                        <Link
                                                            to={pathname.link}
                                                        >
                                                            {pathname.name}
                                                        </Link>
                                                    </BreadcrumbLink>
                                                )}
                                            </BreadcrumbItem>
                                        </Fragment>
                                    );
                                })
                            ) : (
                                <BreadcrumbItem>
                                    <BreadcrumbPage className="capitalize font-semi-bold">
                                        {t("nav.dashboard")}
                                    </BreadcrumbPage>
                                </BreadcrumbItem>
                            )}
                        </BreadcrumbList>
                    </Breadcrumb>
                    <div className="ml-auto flex items-center">
                        <TooltipProvider delayDuration={300}>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" asChild>
                                        <a href="/docs" target="_blank" rel="noopener noreferrer">
                                            <BookOpen className="size-4" />
                                        </a>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t('nav.docs')}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" asChild>
                                        <a href="#" target="_blank" rel="noopener noreferrer">
                                            <HelpCircle className="size-4" />
                                        </a>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t('nav.help')}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" asChild>
                                        <a href="#" target="_blank" rel="noopener noreferrer">
                                            <Bug className="size-4" />
                                        </a>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{t('nav.reportBug')}</TooltipContent>
                            </Tooltip>
                            <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={toggleTheme}>
                                        {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{theme === 'dark' ? t('nav.lightMode') : t('nav.darkMode')}</TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    </div>
                </header>

                <main className="flex-1 overflow-y-auto pt-6 px-6 min-h-0">
                    <div className="relative pb-10">
                        <Outlet />
                    </div>
                </main>
            </SidebarInset>
        </SidebarProvider>
        </LockdownProvider>
    );
}
