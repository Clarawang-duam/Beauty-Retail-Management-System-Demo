import { isDemoMode } from '../demo/mode'
import { createMemoryDb, createDemoApp, createDemoAuth } from '../demo/memoryDb'

const memory = createMemoryDb()
const db = memory.db
const _ = db.command
const auth = createDemoAuth()
const app = createDemoApp(db)
app.__demoReset = memory.reset

console.info('[demo] 本地演示模式：数据保存在浏览器 localStorage')

export { db, auth, _, isDemoMode }
export default app
