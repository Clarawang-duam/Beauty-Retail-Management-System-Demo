import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import useAuthStore from '../../store/authStore'
import useCacheStore from '../../store/cacheStore'
import { isDemoMode } from '../../lib/cloudbase'
import { DEMO_LOGIN_HINT } from '../../demo/seed'
import { resetDemoData } from '../../demo/reset'

export default function LoginPage() {
  const [account, setAccount] = useState(isDemoMode ? DEMO_LOGIN_HINT.account : '')
  const [password, setPassword] = useState(isDemoMode ? DEMO_LOGIN_HINT.password : '')
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isLoading, error } = useAuthStore()
  const initCache = useCacheStore((s) => s.initCache)

  const from = location.state?.from?.pathname || '/'

  const handleSubmit = async (e) => {
    e.preventDefault()
    try {
      await login(account, password)
      await initCache()
      navigate(from, { replace: true })
    } catch (_) {
      // error 已在 store 中设置
    }
  }

  return (
    <div className="min-h-screen bg-pink-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center text-gray-800 mb-2">美妆门店管理系统</h1>
        <p className="text-center text-gray-400 text-sm mb-4">Beauty Retail Management</p>

        {isDemoMode && (
          <div className="mb-6 rounded-xl bg-sky-50 border border-sky-100 px-3 py-2.5 text-center">
            <div className="text-sky-700 text-sm font-semibold">演示模式</div>
            <div className="text-sky-600 text-xs mt-1 leading-relaxed">
              不连云数据库 · 数据仅保存在本机浏览器<br />
              账号 <span className="font-mono font-medium">{DEMO_LOGIN_HINT.account}</span>
              {' / '}
              密码 <span className="font-mono font-medium">{DEMO_LOGIN_HINT.password}</span>
              <br />
              试用手工核销预约号 <span className="font-mono font-medium">0001</span>
            </div>
            <button
              type="button"
              onClick={resetDemoData}
              className="mt-2 text-xs text-sky-600 underline underline-offset-2 hover:text-sky-800"
            >
              重置演示数据
            </button>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">账号</label>
            <input
              type="text"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400"
              placeholder="请输入账号"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-pink-400"
              placeholder="请输入密码"
              required
            />
          </div>

          {error && (
            <p className="text-red-500 text-sm text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-pink-500 hover:bg-pink-600 disabled:bg-pink-300 text-white font-medium py-2 rounded-lg transition-colors"
          >
            {isLoading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}
