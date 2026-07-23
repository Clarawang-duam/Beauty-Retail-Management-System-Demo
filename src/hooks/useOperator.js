import useAuthStore from '../store/authStore'
import useCacheStore from '../store/cacheStore'

export function useOperator() {
  const user = useAuthStore((s) => s.user)
  const activeStaff = useAuthStore((s) => s.activeStaff)
  const setActiveStaff = useAuthStore((s) => s.setActiveStaff)
  const getSetting = useCacheStore((s) => s.getSetting)

  const isShared = getSetting('account_mode', 'individual') === 'shared'
  const operatorId = isShared && activeStaff?._id ? activeStaff._id : user?.uid
  const operatorName = isShared && activeStaff ? activeStaff.name : user?.name
  const operatorLevel = isShared && activeStaff ? activeStaff.level : user?.level
  const needsOperator = isShared && !activeStaff

  return { operatorId, operatorName, operatorLevel, isShared, needsOperator, activeStaff, setActiveStaff }
}
