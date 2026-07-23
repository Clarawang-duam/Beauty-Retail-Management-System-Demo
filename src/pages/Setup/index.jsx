import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db, isDemoMode } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import { DEFAULT_SETTINGS } from '../../lib/settings'

export default function SetupPage() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [form, setForm] = useState({ name: '老板', account: 'admin', password: 'admin123' })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (isDemoMode) {
      navigate('/login', { replace: true })
      return
    }
    checkCanSetup()
  }, [])

  const checkCanSetup = async () => {
    try {
      await auth.anonymousAuthProvider().signIn()
    } catch (err) {
      console.warn('anonymous login error:', err)
    }
    try {
      const res = await db.collection(COLLECTIONS.STAFF).count()
      setAllowed(res.total === 0)
    } catch (err) {
      // 集合不存在 = 从未初始化，允许进入
      setAllowed(true)
    } finally {
      setChecking(false)
    }
  }

  const handleSetup = async () => {
    if (!form.name || !form.account || !form.password) {
      alert('所有字段必填')
      return
    }
    setSaving(true)
    try {
      // 写入第一个 owner 账号
      await db.collection(COLLECTIONS.STAFF).add({
        name: form.name,
        account: form.account,
        password_hash: form.password,
        role: 'owner',
        level: '高级',
        status: '在职',
        created_at: new Date(),
      })

      // 初始化 settings 默认值（如果还没有）
      const settingsCount = await db.collection(COLLECTIONS.SETTINGS).count()
      if (settingsCount.total === 0) {
        for (const item of DEFAULT_SETTINGS) {
          await db.collection(COLLECTIONS.SETTINGS).add(item)
        }
      }

      setDone(true)
    } catch (err) {
      alert('初始化失败：' + err.message)
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pink-50">
        <div className="text-gray-400">检查中...</div>
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pink-50">
        <div className="text-center">
          <div className="text-gray-600 mb-4">系统已初始化，请直接登录</div>
          <button onClick={() => navigate('/login')}
            className="px-6 py-2 bg-pink-500 text-white rounded-lg">
            去登录
          </button>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pink-50">
        <div className="text-center">
          <div className="text-5xl mb-4">🎉</div>
          <div className="text-xl font-bold text-gray-800 mb-2">初始化完成！</div>
          <div className="text-gray-500 text-sm mb-6">
            账号：<strong>{form.account}</strong> · 密码：<strong>{form.password}</strong>
          </div>
          <button onClick={() => navigate('/login')}
            className="px-8 py-3 bg-pink-500 text-white rounded-xl font-medium">
            去登录
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-pink-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-center text-gray-800 mb-1">系统初始化</h1>
        <p className="text-center text-gray-400 text-sm mb-6">创建老板账号</p>

        <div className="space-y-4">
          {[
            { key: 'name', label: '老板姓名' },
            { key: 'account', label: '登录账号' },
            { key: 'password', label: '登录密码', type: 'password' },
          ].map(({ key, label, type = 'text' }) => (
            <div key={key}>
              <label className="block text-sm text-gray-600 mb-1">{label}</label>
              <input
                type={type}
                value={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400"
              />
            </div>
          ))}
        </div>

        <button
          onClick={handleSetup}
          disabled={saving}
          className="mt-6 w-full bg-pink-500 hover:bg-pink-600 disabled:bg-pink-300 text-white font-medium py-2 rounded-lg transition-colors"
        >
          {saving ? '初始化中...' : '创建账号'}
        </button>
      </div>
    </div>
  )
}
