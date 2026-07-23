import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { auth, db } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import useCacheStore from './cacheStore'

const storedActiveStaff = (() => {
  try { return JSON.parse(sessionStorage.getItem('beauty-active-staff') || 'null') }
  catch { return null }
})()

const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,        // { uid, account, name, role, level, status }
      loginDate: null,   // YYYY-MM-DD，每日校验
      token: null,
      activeStaff: storedActiveStaff, // 共用账号模式下手动选择的操作人，sessionStorage 持久化
      isLoading: false,
      error: null,

      login: async (account, password) => {
        set({ isLoading: true, error: null })
        try {
          const loginState = await auth.getLoginState()
          if (!loginState) {
            await auth.anonymousAuthProvider().signIn()
          }

          const result = await db.collection(COLLECTIONS.STAFF)
            .where({ account, password_hash: password })
            .get()

          if (result.data.length === 0) {
            throw new Error('账号或密码错误')
          }

          const staffUser = result.data[0]

          if (staffUser.status === '离职') {
            throw new Error('该账号已被停用')
          }

          set({
            user: {
              uid: staffUser._id,
              account: staffUser.account,
              name: staffUser.name,
              role: staffUser.role,
              level: staffUser.level,
              status: staffUser.status,
            },
            loginDate: new Date().toISOString().slice(0, 10),
            isLoading: false,
            error: null,
          })

          await useCacheStore.getState().refreshCache()

          return staffUser
        } catch (err) {
          set({ isLoading: false, error: err.message })
          throw err
        }
      },

      setActiveStaff: (staff) => {
        set({ activeStaff: staff })
        try {
          if (staff) sessionStorage.setItem('beauty-active-staff', JSON.stringify(staff))
          else sessionStorage.removeItem('beauty-active-staff')
        } catch {}
      },

      logout: async () => {
        try { await auth.signOut() } catch (_) {}
        try { sessionStorage.removeItem('beauty-active-staff') } catch {}
        set({ user: null, loginDate: null, token: null, activeStaff: null })
      },

      isOwner: () => get().user?.role === 'owner',
      isStaff: () => get().user?.role === 'staff',
      isAuthenticated: () => !!get().user,
    }),
    {
      name: 'beauty-auth',
      partialize: (state) => ({ user: state.user, loginDate: state.loginDate }),
    }
  )
)

export default useAuthStore
