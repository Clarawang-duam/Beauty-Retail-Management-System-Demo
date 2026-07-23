/**
 * CloudBase 数据库初始化脚本
 * 用途：新门店首次部署时运行一次，写入 settings 默认值
 * 运行方式：在 CloudBase 云函数中调用，或通过管理端触发
 *
 * 集合列表（CloudBase 插入时自动创建）：
 *   settings / staff / products / projects / members
 *   member_projects / inventory / appointments / transactions
 */

const DEFAULT_SETTINGS = [
  { key: 'morning_shift_start', value: '09:00', category: 'schedule' },
  { key: 'morning_shift_end', value: '13:00', category: 'schedule' },
  { key: 'evening_shift_start', value: '14:00', category: 'schedule' },
  { key: 'evening_shift_end', value: '20:00', category: 'schedule' },
  { key: 'slot_duration', value: 30, category: 'schedule' },
  { key: 'max_clients_per_slot', value: 2, category: 'schedule' },
  { key: 'max_booking_days_ahead', value: 30, category: 'schedule' },
  { key: 'formula_coefficient', value: 0.2, category: 'salary' },
  { key: 'salary_formula', value: {}, category: 'salary' },
  {
    key: 'member_fields',
    value: { birthday: true, gender: true, skin_type: true, allergy: true, notes: true },
    category: 'member_fields',
  },
  { key: 'enable_product_category', value: false, category: 'products' },
  { key: 'enable_points_product', value: false, category: 'products' },
  { key: 'promotions', value: [], category: 'promotions' },
]

/**
 * 在 CloudBase 云函数中调用示例：
 *
 * const cloud = require('@cloudbase/node-sdk')
 * const app = cloud.init()
 * const db = app.database()
 * await initSettings(db)
 */
async function initSettings(db) {
  const settingsCol = db.collection('settings')
  const { total } = await settingsCol.count()
  if (total > 0) {
    console.log('settings 已存在，跳过初始化')
    return
  }
  for (const item of DEFAULT_SETTINGS) {
    await settingsCol.add(item)
  }
  console.log(`settings 初始化完成，共写入 ${DEFAULT_SETTINGS.length} 条`)
}

module.exports = { initSettings, DEFAULT_SETTINGS }
