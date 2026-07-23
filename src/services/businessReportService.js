import dayjs from 'dayjs'
import { db, _ } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import { fetchAll } from '../lib/db'
import { buildPeriodReport } from '../domain/anomaly/detect'
import { buildReportPayload } from '../domain/anomaly/reportPayload'
import { getWeekTarget, getMonthTarget } from '../domain/anomaly/reportSchedule'
import { generateBusinessReportMarkdown } from './deepseekService'

let activeReportPromise = null

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
    await db.collection(COLLECTIONS.SETTINGS).add({ key, value, category: 'anomaly' })
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

  const enabled = await read('business_report_enabled', true)
  return {
    enabled: enabled !== false && enabled !== 'false',
    salesThresholdPct: Number(await read('anomaly_sales_pct_threshold', 20)),
    aovThresholdPct: Number(await read('anomaly_aov_pct_threshold', 20)),
    refundThresholdPct: Number(await read('anomaly_refund_pct_threshold', 50)),
  }
}

async function fetchReportData() {
  const start = dayjs().subtract(4, 'month').startOf('month').toDate()
  const [txns, products, staff, inventory] = await Promise.all([
    fetchAll(COLLECTIONS.TRANSACTIONS, { operated_at: _.gte(start) }),
    fetchAll(COLLECTIONS.PRODUCTS),
    db.collection(COLLECTIONS.STAFF).limit(50).get().then((r) => r.data),
    fetchAll(COLLECTIONS.INVENTORY),
  ])
  return { txns, products, staff, inventory }
}

async function generateAndSaveReport(periodType, data, config, getSetting, target) {
  const report = buildPeriodReport({
    periodType,
    txns: data.txns,
    products: data.products,
    staff: data.staff,
    inventory: data.inventory,
    now: target.refDate,
    isCurrent: target.isCurrent,
    salesThresholdPct: config.salesThresholdPct,
    aovThresholdPct: config.aovThresholdPct,
    refundThresholdPct: config.refundThresholdPct,
  })

  const reportData = buildReportPayload({
    periodType,
    txns: data.txns,
    staff: data.staff,
    inventory: data.inventory,
    anomalyReport: report,
    now: target.refDate,
  })

  const apiKey =
    getSetting?.('deepseek_api_key') ||
    import.meta.env.VITE_DEEPSEEK_API_KEY ||
    ''
  report.aiMarkdown = await generateBusinessReportMarkdown(reportData, apiKey)

  if (periodType === 'week') {
    await setSettingValue('last_weekly_report_date', target.periodKey)
    await setSettingValue('weekly_report_snapshot', report)
  } else {
    await setSettingValue('last_monthly_report_date', target.periodKey)
    await setSettingValue('monthly_report_snapshot', report)
  }

  return report
}

/**
 * 每周/每月首次进老板看板时生成报告；同周期内展示缓存快照。
 * @returns {{ weeklyReport, monthlyReport }}
 */
export function ensureBusinessReports({ getSetting, refreshCache }) {
  if (activeReportPromise) return activeReportPromise
  activeReportPromise = executeEnsureReports({ getSetting, refreshCache }).finally(() => {
    activeReportPromise = null
  })
  return activeReportPromise
}

async function executeEnsureReports({ getSetting, refreshCache }) {
  const config = await getConfig(getSetting)
  if (!config.enabled) {
    return { weeklyReport: null, monthlyReport: null }
  }

  const weekTarget = getWeekTarget()
  const monthTarget = getMonthTarget()
  const lastWeek = await readSettingFromDb('last_weekly_report_date', '')
  const lastMonth = await readSettingFromDb('last_monthly_report_date', '')

  let weeklyReport = await readSettingFromDb('weekly_report_snapshot', null)
  let monthlyReport = await readSettingFromDb('monthly_report_snapshot', null)

  const needWeek = lastWeek !== weekTarget.periodKey
  const needMonth = lastMonth !== monthTarget.periodKey

  if (!needWeek && !needMonth) {
    return { weeklyReport, monthlyReport }
  }

  const data = await fetchReportData()

  if (needWeek) {
    weeklyReport = await generateAndSaveReport('week', data, config, getSetting, weekTarget)
  }
  if (needMonth) {
    monthlyReport = await generateAndSaveReport('month', data, config, getSetting, monthTarget)
  }

  if (refreshCache) await refreshCache('settings')

  return { weeklyReport, monthlyReport }
}
