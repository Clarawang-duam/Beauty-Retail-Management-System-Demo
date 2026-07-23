import useAuthStore from '../store/authStore'

// 权限钩子，组件内用来判断是否有权限
export function usePermission() {
  const user = useAuthStore((s) => s.user)

  return {
    isOwner: user?.role === 'owner',
    isStaff: user?.role === 'staff',
    canEdit: user?.role === 'owner',
    canEditProjects: user?.role === 'owner' || user?.role === 'staff',
    canEditSettings: user?.role === 'owner' || user?.level === '高级',
    canViewPurchasePrice: user?.role === 'owner',
    canViewOwnerDashboard: user?.role === 'owner',
    canManageSettings: user?.role === 'owner',
    canViewSalesActivity: user?.role === 'owner',
  }
}
