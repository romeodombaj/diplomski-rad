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
import Doors from './components/105_doors/doors'
import DoorDetail from './components/105_doors/door/DoorDetail'
import People from './components/106_people/people'
import PersonDetail from './components/106_people/person/PersonDetail'
import Access from './components/107_access/access'
import GroupDetail from './components/107_access/group/GroupDetail'
import Devices from './components/108_devices/devices'

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
            {/* gt:buildings-routes */}
            <Route path="/doors" element={<Doors />} />
            <Route path="/doors/:id" element={<DoorDetail />} />
            {/* gt:doors-routes */}
            <Route path="/people" element={<People />} />
            <Route path="/people/:id" element={<PersonDetail />} />
            {/* gt:people-routes */}
            {/* gt:tab:107_access */}
            <Route path="/access" element={<Access />} />
            <Route path="/access/groups/:id" element={<GroupDetail />} />
            {/* gt:tab:108_devices */}
            <Route path="/devices" element={<Devices />} />
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
