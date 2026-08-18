import { lazy, Suspense } from "react";
import { Routes, Route, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./lib/AuthContext";
import { usePresence } from "./lib/usePresence";
import ProtectedRoute from "./components/ProtectedRoute";
import ReAuthGate from "./components/ReAuthGate";
import NavBar from "./components/NavBar";
import UniversalControls from "./components/UniversalControls";
import AdminNav from "./components/admin/AdminNav";
import ChatPopupHost from "./components/ChatPopup";
import AdminPWAInstallPrompt from "./components/admin/AdminPWAInstallPrompt";

import Login from "./pages/Login";
import Home from "./pages/Home";
import Chat from "./pages/Chat";
import Game from "./pages/Game";
import Streak from "./pages/Streak";
import Letters from "./pages/Letters";
import BucketList from "./pages/BucketList";
import Calendar from "./pages/Calendar";
import Pet from "./pages/Pet";
import Weather from "./pages/Weather";

import AdminSettings from "./pages/admin/AdminSettings";

// Admin Control Center section pages are loaded lazily so the admin landing
// stays instant and only the section actually visited is fetched.
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminUser = lazy(() => import("./pages/admin/AdminUser"));
const AdminJar = lazy(() => import("./pages/admin/AdminJar"));
const AdminRelationship = lazy(() => import("./pages/admin/AdminRelationship"));
const AdminCommunication = lazy(() => import("./pages/admin/AdminCommunication"));
const AdminActivities = lazy(() => import("./pages/admin/AdminActivities"));
const AdminSystem = lazy(() => import("./pages/admin/AdminSystem"));

function UserLayout() {
  usePresence();
  return (
    <div className="app-shell">
      <UniversalControls />
      <div className="app-content">
        <Outlet />
      </div>
      <NavBar />
      <ChatPopupHost />
    </div>
  );
}

function AdminLayout() {
  usePresence();
  return (
    <div className="admin-shell">
      <AdminNav />
      <main className="admin-main">
        <UniversalControls />
        <div className="app-content">
          <Suspense fallback={<div className="loading-screen">Loading…</div>}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      <ChatPopupHost />
      <AdminPWAInstallPrompt />
    </div>
  );
}

export default function App() {
  const { loading, authReady, role, unlocked } = useAuth();
  const location = useLocation();
  if (loading || !authReady) return <div className="loading-screen">Loading…</div>;

  // On every fresh entry (page load / PWA relaunch) the user must re-enter
  // their PIN even though the valid server session still exists. Not shown while
  // the user is looking at an /admin* route (admin flows are unchanged).
  const isAdminPath = location.pathname.startsWith("/admin");
  if (role === "user" && !unlocked && !isAdminPath) return <ReAuthGate />;

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/admin/login" element={<Login />} />

      <Route
        element={
          <ProtectedRoute role="user">
            <UserLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/game" element={<Game />} />
        <Route path="/streak" element={<Streak />} />
        <Route path="/letters" element={<Letters />} />
        <Route path="/bucket-list" element={<BucketList />} />
        <Route path="/calendar" element={<Calendar />} />
        <Route path="/pet" element={<Pet />} />
        <Route path="/weather" element={<Weather />} />
      </Route>

      <Route
        element={
          <ProtectedRoute role="admin">
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/user" element={<AdminUser />} />
        <Route path="/admin/jar" element={<AdminJar />} />
        <Route path="/admin/relationship" element={<AdminRelationship />} />
        <Route path="/admin/communication" element={<AdminCommunication />} />
        <Route path="/admin/activities" element={<AdminActivities />} />
        <Route path="/admin/system" element={<AdminSystem />} />
        <Route path="/admin/chat" element={<Chat />} />
        <Route path="/admin/letters" element={<Letters />} />
        <Route path="/admin/bucket-list" element={<BucketList />} />
        <Route path="/admin/calendar" element={<Calendar />} />
        <Route path="/admin/pet" element={<Pet />} />
        <Route path="/admin/weather" element={<Weather />} />
        <Route path="/admin/settings" element={<AdminSettings />} />
      </Route>

      <Route path="*" element={<Login />} />
    </Routes>
  );
}
