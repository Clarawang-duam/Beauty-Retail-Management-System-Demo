import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { db } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'

// CloudBase 单次最多返回 100 条，循环分页直到取完
async function fetchAll(collection, orderField = 'created_at') {
  const PAGE = 100
  let all = []
  let skip = 0
  while (true) {
    const res = await db.collection(collection).orderBy(orderField, 'asc').skip(skip).limit(PAGE).get()
    all = all.concat(res.data)
    if (res.data.length < PAGE) break
    skip += PAGE
  }
  return all
}

// 静态数据：启动时拉取一次，老板保存设置后按需刷新
// members 按需加载（仅在会员库页面打开时拉取）
const useCacheStore = create(
  persist(
    (set, get) => ({
      settings: {},
      products: [],
      projects: [],
      staff: [],
      members: [],
      initialized: false,
      loading: false,

      // 启动时调用一次，拉取 settings/products/projects/staff（members 按需）
      initCache: async () => {
        if (get().loading) return
        set({ loading: true })
        try {
          const [settingsRes, products, projects, staffRes] = await Promise.all([
            db.collection(COLLECTIONS.SETTINGS).limit(100).get(),
            fetchAll(COLLECTIONS.PRODUCTS),
            fetchAll(COLLECTIONS.PROJECTS),
            db.collection(COLLECTIONS.STAFF).limit(50).get(),
          ])

          const settingsMap = {}
          settingsRes.data.forEach((item) => {
            settingsMap[item.key] = item.value
          })

          set({
            settings: settingsMap,
            products,
            projects,
            staff: staffRes.data,
            initialized: true,
            loading: false,
          })
        } catch (err) {
          set({ loading: false })
          console.error('缓存初始化失败', err)
        }
      },

      // 老板保存设置后按表名刷新
      refreshCache: async (table) => {
        try {
          if (table === 'settings' || !table) {
            const res = await db.collection(COLLECTIONS.SETTINGS).limit(100).get()
            const settingsMap = {}
            res.data.forEach((item) => { settingsMap[item.key] = item.value })
            set({ settings: settingsMap })
          }
          if (table === 'products' || !table) {
            const products = await fetchAll(COLLECTIONS.PRODUCTS)
            set({ products })
          }
          if (table === 'projects' || !table) {
            const projects = await fetchAll(COLLECTIONS.PROJECTS)
            set({ projects })
          }
          if (table === 'staff' || !table) {
            const res = await db.collection(COLLECTIONS.STAFF).limit(50).get()
            set({ staff: res.data })
          }
          if (table === 'members' || !table) {
            const members = await fetchAll(COLLECTIONS.MEMBERS)
            set({ members })
          }
        } catch (err) {
          console.error(`刷新缓存失败: ${table}`, err)
        }
      },

      // 读取单个 setting 值，未初始化时返回 fallback
      getSetting: (key, fallback = null) => {
        const val = get().settings[key]
        return val !== undefined ? val : fallback
      },

      // 直接更新本地缓存中某个 project 的字段，不等云端读取
      patchProject: (id, data) => set((state) => ({
        projects: state.projects.map((p) => p._id === id ? { ...p, ...data } : p),
      })),

      // 仅在职员工
      activeStaff: () => get().staff.filter((s) => s.status === '在职'),
    }),
    {
      name: 'beauty-cache',
      // 只持久化数据字段，loading/initialized 不持久化
      partialize: (state) => ({
        settings: state.settings,
        products: state.products,
        projects: state.projects,
        staff: state.staff,
      }),
    }
  )
)

export default useCacheStore
