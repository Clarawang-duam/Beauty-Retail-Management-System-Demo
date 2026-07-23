import dayjs from 'dayjs'
import {
  staffAverageDiscount,
  storeAverageDiscount,
  staffPurchaseOrderCount,
  staffLowDiscountOrderCount,
  staffRefundRatePercent,
  offHoursPurchases,
  fmtDiscountZhe,
  pctDrop,
  eveningEndLabel,
} from './metrics'

const ICONS = {
  discount_personal: '💰',
  discount_store: '📉',
  refund: '↩️',
  off_hours: '⚠️',
}

/**
 * @param {object} params
 * @param {Array} params.txns
 * @param {Array} params.staffList - 在职非老板员工
 * @param {dayjs.Dayjs} params.refDate - 目标月份参考日（月末或今天）
 * @param {boolean} params.isCurrent
 * @param {object} params.shiftSettings
 * @param {object} params.config
 */
export function buildStaffAnomalyReport({
  txns,
  staffList,
  refDate = dayjs(),
  isCurrent = true,
  shiftSettings = {},
  config = {},
}) {
  const {
    personalDiscountThresholdPct = 10,
    storeDiscountThresholdPct = 15,
    refundMultiplier = 2,
    lowDiscountZhe = 7,
    minPurchaseOrders = 5,
    historyDays = 30,
  } = config

  const periodStart = refDate.startOf('month')
  const periodEnd = refDate.endOf('day')
  const histStart = periodStart.subtract(historyDays, 'day').startOf('day')
  const histEnd = periodStart.subtract(1, 'day').endOf('day')

  const periodLabel = isCurrent
    ? `本月（截至 ${refDate.format('M月D日')}）`
    : `${refDate.format('M月')}`

  const ownerIds = new Set(
    (staffList || []).filter((s) => s.role === 'owner').map((s) => s._id)
  )
  const activeStaff = (staffList || []).filter(
    (s) => s.role !== 'owner' && s.status !== '离职'
  )

  const storeAvg = storeAverageDiscount(txns, periodStart, periodEnd, ownerIds)
  const lowDiscountThreshold = lowDiscountZhe / 10

  const anomalies = []

  for (const staff of activeStaff) {
    const staffId = staff._id
    const name = staff.name || '未知员工'
    const orderCount = staffPurchaseOrderCount(txns, staffId, periodStart, periodEnd)

    // —— 1. 个人低折扣 ——
    const curDisc = staffAverageDiscount(txns, staffId, periodStart, periodEnd)
    const histDisc = staffAverageDiscount(txns, staffId, histStart, histEnd)

    if (
      orderCount >= minPurchaseOrders
      && curDisc != null
      && histDisc != null
      && histDisc > 0
    ) {
      const dropPct = pctDrop(histDisc, curDisc)
      if (dropPct >= personalDiscountThresholdPct) {
        const lowCount = staffLowDiscountOrderCount(
          txns, staffId, periodStart, periodEnd, lowDiscountThreshold
        )
        const lowNote = lowCount > 0
          ? `其中 ${lowCount} 笔订单折扣低于 ${lowDiscountZhe} 折，建议抽查订单明细。`
          : '建议抽查订单明细。'
        anomalies.push({
          dimension: 'discount_personal',
          icon: ICONS.discount_personal,
          title: '折扣率异常（较个人历史）',
          staffId,
          staffName: name,
          message: `员工「${name}」${isCurrent ? '本月' : periodLabel}平均折扣率 ${fmtDiscountZhe(curDisc)}，较其历史均值 ${fmtDiscountZhe(histDisc)} 下降 ${dropPct.toFixed(0)}%。${lowNote}`,
        })
      }
    }

    // —— 2. 个人 vs 全店 ——
    if (
      orderCount >= minPurchaseOrders
      && curDisc != null
      && storeAvg != null
      && storeAvg > 0
    ) {
      const gapPct = pctDrop(storeAvg, curDisc)
      if (gapPct >= storeDiscountThresholdPct) {
        const lowCount = staffLowDiscountOrderCount(
          txns, staffId, periodStart, periodEnd, 0.5
        )
        const lowNote = lowCount > 0
          ? `该员工经手的订单中有 ${lowCount} 笔为 5 折及以下，建议确认是否为特批或录入异常。`
          : '建议确认是否存在异常低价成交。'
        anomalies.push({
          dimension: 'discount_store',
          icon: ICONS.discount_store,
          title: '折扣率异常（较全店）',
          staffId,
          staffName: name,
          message: `员工「${name}」${isCurrent ? '本月' : periodLabel}平均折扣率 ${fmtDiscountZhe(curDisc)}，全店均值 ${fmtDiscountZhe(storeAvg)}，相差 ${gapPct.toFixed(0)}%。${lowNote}`,
        })
      }
    }

    // —— 3. 退款率 ——
    const curRefund = staffRefundRatePercent(txns, staffId, periodStart, periodEnd)
    const histRefund = staffRefundRatePercent(txns, staffId, histStart, histEnd)

    if (orderCount >= minPurchaseOrders && histRefund > 0) {
      const ratio = curRefund / histRefund
      if (ratio >= refundMultiplier && curRefund >= 1) {
        const storeRefund = activeStaff.length
          ? activeStaff.reduce((s, st) =>
              s + staffRefundRatePercent(txns, st._id, periodStart, periodEnd), 0
            ) / activeStaff.length
          : 0
        anomalies.push({
          dimension: 'refund',
          icon: ICONS.refund,
          title: '退款率异常',
          staffId,
          staffName: name,
          message: `员工「${name}」${isCurrent ? '本月' : periodLabel}退款率 ${curRefund.toFixed(1)}%，是其历史均值 ${histRefund.toFixed(1)}% 的 ${ratio.toFixed(1)} 倍${storeRefund > 0 ? `，且显著高于全店均值 ${storeRefund.toFixed(1)}%` : ''}。建议核查退款原因，重点关注是否有频繁小额退款。`,
        })
      }
    }

    // —— 4. 非营业时间 ——
    const offHours = offHoursPurchases(txns, staffId, periodStart, periodEnd, shiftSettings)
    for (const t of offHours) {
      const timeStr = dayjs(t.operated_at).format('HH:mm')
      const endLabel = eveningEndLabel(shiftSettings)
      anomalies.push({
        dimension: 'off_hours',
        icon: ICONS.off_hours,
        title: '非营业时间操作',
        staffId,
        staffName: name,
        message: `⚠️ 员工「${name}」在 ${timeStr} 记录了一笔销售交易（门店营业结束时间为 ${endLabel}）。请确认是否为系统补录，或存在非营业时间操作。`,
        operatedAt: t.operated_at,
        serialNumber: t.serial_number,
      })
    }
  }

  return {
    periodLabel,
    periodKey: refDate.format('YYYY-MM'),
    generatedAt: new Date().toISOString(),
    allNormal: anomalies.length === 0,
    anomalies,
  }
}
