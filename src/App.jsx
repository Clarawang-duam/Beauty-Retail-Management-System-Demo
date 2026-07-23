import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect } from 'react'
import useAuthStore from './store/authStore'
import useCacheStore from './store/cacheStore'
import ProtectedRoute from './components/ProtectedRoute'
import FloatingKeyboard from './components/FloatingKeyboard'
import LoginPage from './pages/Login/index'
import HomePage from './pages/Home/index'
import SettingsPage from './pages/Settings/index'
import SetupPage from './pages/Setup/index'
import AppointmentPage from './pages/Appointment/index'
import AppointmentSuccess from './pages/Appointment/AppointmentSuccess'
import CheckoutSearch from './pages/Checkout/CheckoutSearch'
import CheckoutDetail from './pages/Checkout/CheckoutDetail'
import SalesPage from './pages/Sales/index'
import PaymentSuccess from './pages/Sales/PaymentSuccess'
import SchedulePage from './pages/Schedule/index'
import Dashboard from './pages/Dashboard/index'
import PunchDetail from './pages/Punch/PunchDetail'
import ShiftPage from './pages/Shift/index'
import RefundPage from './pages/Refund/index'
import StaffEarningsPage from './pages/StaffEarnings/index'

function AppContent() {
  const user = useAuthStore((s) => s.user)
  const { initCache, initialized } = useCacheStore()

  useEffect(() => {
    if (user && !initialized) {
      initCache()
    }
  }, [user, initialized])

  return (
    <>
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />

      <Route path="/" element={
        <ProtectedRoute><HomePage /></ProtectedRoute>
      } />
      <Route path="/settings/*" element={
        <ProtectedRoute><SettingsPage /></ProtectedRoute>
      } />

      {/* 第三阶段 */}
      <Route path="/appointment" element={
        <ProtectedRoute><AppointmentPage /></ProtectedRoute>
      } />
      <Route path="/appointment/success" element={
        <ProtectedRoute><AppointmentSuccess /></ProtectedRoute>
      } />
      <Route path="/checkout" element={
        <ProtectedRoute><CheckoutSearch /></ProtectedRoute>
      } />
      <Route path="/checkout/detail" element={
        <ProtectedRoute><CheckoutDetail /></ProtectedRoute>
      } />

      {/* 第四阶段 */}
      <Route path="/sales" element={
        <ProtectedRoute><SalesPage /></ProtectedRoute>
      } />
      <Route path="/sales/success" element={
        <ProtectedRoute><PaymentSuccess /></ProtectedRoute>
      } />
      <Route path="/schedule" element={
        <ProtectedRoute><SchedulePage /></ProtectedRoute>
      } />
      <Route path="/dashboard" element={
        <ProtectedRoute role="owner"><Dashboard /></ProtectedRoute>
      } />
      <Route path="/staff-earnings" element={
        <ProtectedRoute role="owner"><StaffEarningsPage /></ProtectedRoute>
      } />
      <Route path="/punch/detail" element={
        <ProtectedRoute><PunchDetail /></ProtectedRoute>
      } />
      <Route path="/shift" element={
        <ProtectedRoute><ShiftPage /></ProtectedRoute>
      } />

      <Route path="/refund" element={
        <ProtectedRoute><RefundPage /></ProtectedRoute>
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <FloatingKeyboard />
    </>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  )
}
