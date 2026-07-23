import { useState, useEffect } from 'react'
import { db } from '../../../lib/cloudbase'
import { COLLECTIONS } from '../../../lib/collections'
import useCacheStore from '../../../store/cacheStore'
import useAuthStore from '../../../store/authStore'

const ROLES = [{ v: 'owner', l: '老板' }, { v: 'staff', l: '员工' }]
const LEVELS = ['高级', '中级', '初级']
const EMPTY_FORM = { name: '', account: '', password: '', role: 'staff', level: '中级' }

export default function StaffManagement({ onBack }) {
  const { refreshCache } = useCacheStore()
  const currentUser = useAuthStore((s) => s.user)

  const [staffList, setStaffList] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const fetchStaff = async () => {
    setLoading(true)
    const res = await db.collection(COLLECTIONS.STAFF).orderBy('created_at', 'asc').get()
    setStaffList(res.data)
    setLoading(false)
  }

  useEffect(() => { fetchStaff() }, [])

  const openAdd = () => { setEditItem(null); setForm(EMPTY_FORM); setShowForm(true) }

  const openEdit = (item) => {
    setEditItem(item)
    setForm({ name: item.name || '', account: item.account || '', password: '', role: item.role || 'staff', level: item.level || '中级' })
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!form.name.trim() || !form.account.trim()) { alert('姓名和账号为必填'); return }
    if (!editItem && !form.password.trim()) { alert('新增员工必须设置密码'); return }

    const existing = await db.collection(COLLECTIONS.STAFF).where({ account: form.account.trim() }).get()
    if (!editItem && existing.data.length > 0) { alert('该账号已存在'); return }
    if (editItem && existing.data.length > 0 && existing.data[0]._id !== editItem._id) {
      alert('该账号已被其他员工使用'); return
    }

    setSaving(true)
    try {
      const data = { name: form.name.trim(), account: form.account.trim(), role: form.role, level: form.level }
      if (form.password.trim()) data.password_hash = form.password.trim()

      if (editItem) {
        await db.collection(COLLECTIONS.STAFF).doc(editItem._id).update(data)
      } else {
        await db.collection(COLLECTIONS.STAFF).add({ ...data, password_hash: form.password.trim(), status: '在职', created_at: new Date() })
      }

      await refreshCache('staff')
      await fetchStaff()
      setShowForm(false)
    } catch (err) {
      alert('保存失败：' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleStatus = async (item) => {
    if (item._id === currentUser?.uid) { alert('不能修改自己的在职状态'); return }
    const newStatus = item.status === '在职' ? '离职' : '在职'
    await db.collection(COLLECTIONS.STAFF).doc(item._id).update({ status: newStatus })
    await refreshCache('staff')
    await fetchStaff()
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-500 hover:text-gray-700">← 返回</button>
          <h2 className="text-xl font-bold text-gray-800">员工管理</h2>
        </div>
        <button onClick={openAdd} className="px-3 py-1.5 bg-pink-500 text-white rounded text-sm">
          新增员工
        </button>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-16">加载中...</div>
      ) : (
        <div className="space-y-3">
          {staffList.map((item) => (
            <div key={item._id} className="bg-white rounded-xl p-4 shadow-sm flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-gray-800">{item.name}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${item.role === 'owner' ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                    {item.role === 'owner' ? '老板' : '员工'}
                  </span>
                  {item.level && <span className="text-xs text-gray-400">{item.level}</span>}
                </div>
                <div className="text-sm text-gray-400 mt-0.5">账号：{item.account}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                <button
                  onClick={() => handleToggleStatus(item)}
                  disabled={item._id === currentUser?.uid}
                  className={`text-xs px-2 py-1 rounded-full transition-colors ${item.status === '在职' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'} disabled:opacity-40`}
                >
                  {item.status || '在职'}
                </button>
                <button onClick={() => openEdit(item)} className="text-xs text-blue-500">编辑</button>
              </div>
            </div>
          ))}
          {staffList.length === 0 && (
            <div className="text-center text-gray-400 py-16">暂无员工</div>
          )}
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-lg mb-4">{editItem ? '编辑员工' : '新增员工'}</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">姓名 *</label>
                <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">登录账号 *</label>
                <input type="text" value={form.account} onChange={(e) => setForm({ ...form, account: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  登录密码{editItem ? '（留空则不修改）' : ' *'}
                </label>
                <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">角色</label>
                <div className="flex gap-2">
                  {ROLES.map(({ v, l }) => (
                    <button key={v} type="button" onClick={() => setForm({ ...form, role: v })}
                      className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${form.role === v ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">级别</label>
                <div className="flex gap-2">
                  {LEVELS.map((l) => (
                    <button key={l} type="button" onClick={() => setForm({ ...form, level: l })}
                      className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${form.level === l ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-300'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowForm(false)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm">取消</button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 bg-pink-500 text-white rounded-lg text-sm disabled:bg-pink-300">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
