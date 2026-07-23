import dayjs from 'dayjs'

export function inRange(date, start, end) {
  const t = dayjs(date)
  return !t.isBefore(start) && !t.isAfter(end)
}

/** 可计折扣的 purchase 商品行（正价、非促销负行、非赠品） */
export function isDiscountablePurchase(t) {
  if (!t || t.type !== 'purchase') return false
  if ((t.product_price || 0) <= 0) return false
  if (t.is_gift) return false
  const d = t.discount
  return d != null && d > 0 && d <= 1
}

export function filterTxnsInRange(txns, start, end) {
  return (txns || []).filter((t) => inRange(t.operated_at, start, end))
}

/** 员工在区间内平均折扣（0~1），无数据返回 null */
export function staffAverageDiscount(txns, staffId, start, end) {
  const lines = filterTxnsInRange(txns, start, end)
    .filter((t) => t.therapist_id === staffId && isDiscountablePurchase(t))
  if (!lines.length) return null
  const sum = lines.reduce((s, t) => s + t.discount, 0)
  return sum / lines.length
}

/** 全店在区间内平均折扣 */
export function storeAverageDiscount(txns, start, end, excludeStaffIds = new Set()) {
  const lines = filterTxnsInRange(txns, start, end)
    .filter((t) => isDiscountablePurchase(t) && !excludeStaffIds.has(t.therapist_id))
  if (!lines.length) return null
  const sum = lines.reduce((s, t) => s + t.discount, 0)
  return sum / lines.length
}

/** 员工 purchase 笔数（serial_number 去重） */
export function staffPurchaseOrderCount(txns, staffId, start, end) {
  const purchases = filterTxnsInRange(txns, start, end)
    .filter((t) => t.therapist_id === staffId && t.type === 'purchase' && (t.product_price || 0) > 0 && !t.is_gift)
  const ids = new Set(purchases.map((t) => t.serial_number).filter(Boolean))
  return ids.size > 0 ? ids.size : purchases.length
}

/** 低于 threshold折（如 7 折 = 0.7）的订单数（按 serial_number） */
export function staffLowDiscountOrderCount(txns, staffId, start, end, thresholdDiscount) {
  const bySerial = {}
  filterTxnsInRange(txns, start, end)
    .filter((t) => t.therapist_id === staffId && isDiscountablePurchase(t))
    .forEach((t) => {
      const key = t.serial_number || t._id
      if (!bySerial[key]) bySerial[key] = []
      bySerial[key].push(t.discount)
    })
  return Object.values(bySerial).filter((discounts) =>
    discounts.some((d) => d < thresholdDiscount)
  ).length
}

/** 员工退款率 % = |refund| / purchase × 100 */
export function staffRefundRatePercent(txns, staffId, start, end) {
  const inPeriod = filterTxnsInRange(txns, start, end)
    .filter((t) => t.therapist_id === staffId && (t.type === 'purchase' || t.type === 'refund'))

  const purchaseTotal = inPeriod
    .filter((t) => t.type === 'purchase')
    .reduce((s, t) => s + Math.max(0, t.product_price || 0), 0)
  const refundTotal = inPeriod
    .filter((t) => t.type === 'refund')
    .reduce((s, t) => s + Math.abs(Math.min(0, t.product_price || 0)), 0)

  if (purchaseTotal <= 0) return refundTotal > 0 ? 100 : 0
  return (refundTotal / purchaseTotal) * 100
}

export function fmtDiscountZhe(discount01) {
  if (discount01 == null) return '—'
  return `${(discount01 * 10).toFixed(1)}折`
}

export function pctDrop(baseline, current) {
  if (!baseline || baseline <= 0) return current < baseline ? 100 : 0
  return ((baseline - current) / baseline) * 100
}

/**
 * 是否在营业时段内（早班或晚班任一段）
 * shiftSettings: { morning_shift_start, morning_shift_end, evening_shift_start, evening_shift_end }
 */
export function isWithinBusinessHours(date, shiftSettings) {
  const d = dayjs(date)
  const minutes = d.hour() * 60 + d.minute()

  const parse = (hhmm) => {
    const [h, m] = String(hhmm || '00:00').split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }

  const ranges = [
    [parse(shiftSettings.morning_shift_start), parse(shiftSettings.morning_shift_end)],
    [parse(shiftSettings.evening_shift_start), parse(shiftSettings.evening_shift_end)],
  ]

  return ranges.some(([start, end]) => minutes >= start && minutes <= end)
}

/** 非营业时间 purchase 记录（按 serial_number 去重，取首条） */
export function offHoursPurchases(txns, staffId, start, end, shiftSettings) {
  const seen = new Set()
  const result = []

  for (const t of filterTxnsInRange(txns, start, end)) {
    if (t.therapist_id !== staffId || t.type !== 'purchase') continue
    if ((t.product_price || 0) <= 0) continue
    if (isWithinBusinessHours(t.operated_at, shiftSettings)) continue

    const key = t.serial_number || t._id
    if (seen.has(key)) continue
    seen.add(key)
    result.push(t)
  }
  return result
}

export function eveningEndLabel(shiftSettings) {
  return shiftSettings.evening_shift_end || '20:00'
}
