import './i18n';
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import MainLayout from "./Layout/MainLayout";
import Login from "./components/0_Auth/Login";
import Register from "./components/0_Auth/Register";
import Settings from "./components/100_Settings/Settings";
import Account from "./components/100_Settings/Account";
import ProtectedRoute from "./Layout/ProtectedRoute";
import Dashboard from "./components/1_Dashboard/Dashboard";
import AuditLogs from "./components/101_AuditLogs/AuditLogs";
import Users from "./components/102_Users/Users";
import Backups from "./components/103_Backups/Backups";
import ErrorBoundary from "./components/ErrorBoundary";
import Docs from "./components/0_Docs/Docs";

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as
    | string
    | undefined;

function AppRoutes() {
    return (
        <ThemeProvider>
        <AuthProvider>
            <BrowserRouter>
                <Routes>
                    <Route path="/login" element={<Login />} />
                    <Route path="/register" element={<Register />} />
                    <Route path="/docs" element={<Docs />} />
                    <Route element={<ProtectedRoute />}>
                        <Route path="/" element={<MainLayout />}>
                            {/* primary nav routes */}
                            <Route index element={<Dashboard />} />
                            {/* gt:nav-routes */}

                            {/* secondary nav routes */}
                            <Route path="users" element={<Users />} />
                            <Route path="audit-logs" element={<AuditLogs />} />
                            <Route path="backups" element={<Backups />} />
                            <Route path="settings" element={<Settings />} />
                            {/* gt:secondary-routes */}

                            <Route path="account" element={<Account />} />

                            <Route
                                path="*"
                                element={<Navigate to="/" replace />}
                            />
                        </Route>
                    </Route>
                </Routes>
            </BrowserRouter>
        </AuthProvider>
        </ThemeProvider>
    );
}

export default function App() {
    if (googleClientId) {
        return (
            <ErrorBoundary>
                <GoogleOAuthProvider clientId={googleClientId}>
                    <AppRoutes />
                </GoogleOAuthProvider>
            </ErrorBoundary>
        );
    }
    return (
        <ErrorBoundary>
            <AppRoutes />
        </ErrorBoundary>
    );
}
