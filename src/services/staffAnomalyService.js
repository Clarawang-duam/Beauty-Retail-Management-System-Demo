import dayjs from 'dayjs'
import { db, _ } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import { fetchAll } from '../lib/db'
import { getMonthTarget } from '../domain/anomaly/reportSchedule'
import { buildStaffAnomalyReport } from '../domain/staffAnomaly/detect'
import { polishStaffAnomalyMessages } from './deepseekService'

let activePromise = null

async function readSettingFromDb(key, fallback = '') {
  const res = await db.collection(COLLECTIONS.SETTINGS).where({ key }).limit(1).get()
  const val = res.data[0]?.value
  return val !== undefined && val !== null ? val : fallback
}

async function setSettingValue(key, value) {
  const res = await db.collection(COLLECTIONS.SETTINGS).where({ key }).limit(1).get()
  if (res.data.length > 0) {
    await db.collection(COLLECTIONS.SETTINGS).doc(res.data[0]._id).update({ value })
  } else {
    await db.collection(COLLECTIONS.SETTINGS).add({ key, value, category: 'staff_anomaly' })
  }
}

async function getConfig(getSetting) {
  const read = async (key, fallback) => {
    const fromDb = await readSettingFromDb(key, null)
    if (fromDb !== null && fromDb !== '') return fromDb
    if (getSetting) {
      const cached = getSetting(key, fallback)
      if (cached !== undefined && cached !== null && cached !== '') return cached
    }
    return fallback
  }

  const enabled = await read('staff_anomaly_enabled', true)
  return {
    enabled: enabled !== false && enabled !== 'false',
    personalDiscountThresholdPct: Number(await read('staff_discount_personal_threshold', 10)),
    storeDiscountThresholdPct: Number(await read('staff_discount_store_threshold', 15)),
    refundMultiplier: Number(await read('staff_refund_multiplier_threshold', 2)),
    lowDiscountZhe: Number(await read('staff_low_discount_zhe', 7)),
    minPurchaseOrders: Number(await read('staff_min_purchase_orders', 5)),
  }
}

async function fetchData(getSetting) {
  const start = dayjs().subtract(3, 'month').startOf('month').toDate()
  const [txns, staff] = await Promise.all([
    fetchAll(COLLECTIONS.TRANSACTIONS, { operated_at: _.gte(start) }),
    db.collection(COLLECTIONS.STAFF).limit(50).get().then((r) => r.data),
  ])

  const shiftSettings = {
    morning_shift_start: getSetting?.('morning_shift_start', '09:00'),
    morning_shift_end: getSetting?.('morning_shift_end', '13:00'),
    evening_shift_start: getSetting?.('evening_shift_start', '14:00'),
    evening_shift_end: getSetting?.('evening_shift_end', '20:00'),
  }

  return { txns, staff, shiftSettings }
}

async function generateAndSave(data, config, getSetting, target) {
  const report = buildStaffAnomalyReport({
    txns: data.txns,
    staffList: data.staff,
    refDate: target.refDate,
    isCurrent: target.isCurrent,
    shiftSettings: data.shiftSettings,
    config,
  })

  const apiKey =
    getSetting?.('deepseek_api_key') ||
    import.meta.env.VITE_DEEPSEEK_API_KEY ||
    ''

  if (apiKey && report.anomalies.length > 0) {
    report.anomalies = await polishStaffAnomalyMessages(report.anomalies, apiKey)
  }

  await setSettingValue('last_staff_anomaly_date', target.periodKey)
  await setSettingValue('staff_anomaly_snapshot', report)

  return report
}

/**
 * 员工异常月报：与经营月报同节奏（月末最后 5 天生成当月，其余展示上月）。
 */
export function ensureStaffAnomalyReport({ getSetting, refreshCache }) {
  if (activePromise) return activePromise
  activePromise = executeEnsure({ getSetting, refreshCache }).finally(() => {
    activePromise = null
  })
  return activePromise
}

async function executeEnsure({ getSetting, refreshCache }) {
  const config = await getConfig(getSetting)
  if (!config.enabled) {
    return { staffAnomalyReport: null }
  }

  const target = getMonthTarget()
  const lastKey = await readSettingFromDb('last_staff_anomaly_date', '')
  let report = await readSettingFromDb('staff_anomaly_snapshot', null)

  if (lastKey === target.periodKey) {
    return { staffAnomalyReport: report }
  }

  const data = await fetchData(getSetting)
  report = await generateAndSave(data, config, getSetting, target)

  if (refreshCache) await refreshCache('settings')

  return { staffAnomalyReport: report }
}
