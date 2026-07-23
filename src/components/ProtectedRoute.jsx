import { useEffect } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import useAuthStore from '../store/authStore'

// role: 'owner' | 'staff' | undefined（undefined = 任意已登录用户）
export default function ProtectedRoute({ children, role }) {
  const user = useAuthStore((s) => s.user)
  const loginDate = useAuthStore((s) => s.loginDate)
  const logout = useAuthStore((s) => s.logout)
  const location = useLocation()

  const today = new Date().toISOString().slice(0, 10)
  const expired = user && loginDate !== today

  useEffect(() => {
    if (expired) logout()
  }, [expired])

  if (!user || expired) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  if (role && user.role !== role) {
    return <Navigate to="/" replace />
  }

  return children
}
