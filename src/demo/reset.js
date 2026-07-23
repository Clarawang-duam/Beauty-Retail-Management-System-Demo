import app, { isDemoMode } from '../lib/cloudbase'
import { DEMO_STORAGE_KEY } from './mode'
import { buildSeedData } from './seed'

/** 重置演示数据并刷新页面 */
export function resetDemoData() {
  if (!isDemoMode) return
  try {
    if (typeof app.__demoReset === 'function') {
      app.__demoReset()
    } else {
      localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(buildSeedData()))
    }
  } catch (err) {
    console.warn(err)
  }
  try {
    localStorage.removeItem('beauty-auth')
    localStorage.removeItem('beauty-cache')
    sessionStorage.removeItem('beauty-active-staff')
  } catch (_) {}
  window.location.hash = '#/login'
  window.location.reload()
}
