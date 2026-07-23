import dayjs from 'dayjs'

/** 周一为一周起点，返回该周周一 YYYY-MM-DD 作为周 key */
export function getWeekKey(d = dayjs()) {
  const day = d.day()
  const monday = day === 0 ? d.subtract(6, 'day') : d.subtract(day - 1, 'day')
  return monday.format('YYYY-MM-DD')
}

export function getMonthKey(d = dayjs()) {
  return d.format('YYYY-MM')
}

export function inRange(date, start, end) {
  const t = dayjs(date)
  return !t.isBefore(start) && !t.isAfter(end)
}

export function filterSalesTxns(txns) {
  return (txns || []).filter((t) => t.type === 'purchase' || t.type === 'refund')
}

export function netRevenue(txns, start, end) {
  return filterSalesTxns(txns)
    .filter((t) => inRange(t.operated_at, start, end))
    .reduce((s, t) => s + (t.product_price || 0), 0)
}

export function mean(values) {
  const arr = values.filter((v) => v != null && !Number.isNaN(v))
  if (!arr.length) return 0
  return arr.reduce((a, b) => a + b, 0) / arr.length
}

/** 过去 N 个完整自然月的净销售额（不含当月） */
export function priorMonthlyRevenues(txns, months, now = dayjs()) {
  const result = []
  for (let i = 1; i <= months; i++) {
    const m = now.subtract(i, 'month')
    result.push(netRevenue(txns, m.startOf('month'), m.endOf('month')))
  }
  return result
}

/** 过去 N 个完整自然周净销售额（不含本周） */
export function priorWeeklyRevenues(txns, weeks, now = dayjs()) {
  const result = []
  for (let i = 1; i <= weeks; i++) {
    const w = now.subtract(i, 'week')
    result.push(netRevenue(txns, w.startOf('week'), w.endOf('week')))
  }
  return result
}

/**
 * 客单价 = 当期 purchase 正额合计 / 成交笔数（serial_number 去重）
 */
export function averageOrderValue(txns, start, end) {
  const purchases = (txns || []).filter(
    (t) => t.type === 'purchase'
      && inRange(t.operated_at, start, end)
      && (t.product_price || 0) > 0
  )
  if (!purchases.length) return 0
  const orderIds = new Set(purchases.map((t) => t.serial_number).filter(Boolean))
  const orderCount = orderIds.size > 0 ? orderIds.size : purchases.length
  const total = purchases.reduce((s, t) => s + (t.product_price || 0), 0)
  return total / orderCount
}

/** 退款率 = |refund| / purchase × 100 */
export function refundRatePercent(txns, start, end) {
  const inPeriod = filterSalesTxns(txns).filter((t) => inRange(t.operated_at, start, end))
  const purchaseTotal = inPeriod
    .filter((t) => t.type === 'purchase')
    .reduce((s, t) => s + Math.max(0, t.product_price || 0), 0)
  const refundTotal = inPeriod
    .filter((t) => t.type === 'refund')
    .reduce((s, t) => s + Math.abs(Math.min(0, t.product_price || 0)), 0)
  if (purchaseTotal <= 0) return 0
  return (refundTotal / purchaseTotal) * 100
}

/** 按商品大类统计当期 purchase 净额 */
export function revenueByCategory(txns, start, end, products) {
  const idToCat = {}
  for (const p of products || []) {
    idToCat[p._id] = p.category || '未分类'
  }
  const map = {}
  for (const t of txns || []) {
    if (t.type !== 'purchase' || !inRange(t.operated_at, start, end)) continue
    const cat = idToCat[t.product_id] || '未分类'
    map[cat] = (map[cat] || 0) + (t.product_price || 0)
  }
  return map
}

/** 找相对基线变化最大的大类 */
export function topCategoryChange(currentMap, baselineMap) {
  let best = null
  for (const [cat, cur] of Object.entries(currentMap)) {
    const base = baselineMap[cat] || 0
    if (base <= 0 && cur <= 0) continue
    const changePct = base > 0 ? ((cur - base) / base) * 100 : (cur > 0 ? 100 : 0)
    if (!best || Math.abs(changePct) > Math.abs(best.changePct)) {
      best = { name: cat, changePct, current: cur, baseline: base }
    }
  }
  return best
}

export function aggregateBaselineCategoryMap(txns, periodStarts, periodEnds, products) {
  const map = {}
  for (let i = 0; i < periodStarts.length; i++) {
    const partial = revenueByCategory(txns, periodStarts[i], periodEnds[i], products)
    for (const [cat, val] of Object.entries(partial)) {
      map[cat] = (map[cat] || 0) + val
    }
  }
  const n = periodStarts.length || 1
  for (const cat of Object.keys(map)) {
    map[cat] /= n
  }
  return map
}

export function sumNegativeInventoryByProduct(inventoryRows) {
  const byProduct = {}
  for (const row of inventoryRows || []) {
    if (!row.product_id) continue
    if (!byProduct[row.product_id]) {
      byProduct[row.product_id] = {
        product_id: row.product_id,
        name: row.product_name || '未知商品',
        qty: 0,
      }
    }
    byProduct[row.product_id].qty += row.quantity || 0
  }
  return Object.values(byProduct).filter((p) => p.qty < 0)
}

export function refundAmountByProduct(txns, start, end) {
  const map = {}
  for (const t of txns || []) {
    if (t.type !== 'refund' || !inRange(t.operated_at, start, end)) continue
    const name = t.product_name || '未知商品'
    map[name] = (map[name] || 0) + Math.abs(Math.min(0, t.product_price || 0))
  }
  return map
}

export function refundAmountByStaff(txns, start, end, staffList) {
  const idToName = {}
  for (const s of staffList || []) idToName[s._id] = s.name
  const map = {}
  for (const t of txns || []) {
    if (t.type !== 'refund' || !inRange(t.operated_at, start, end)) continue
    const name = idToName[t.therapist_id] || '未知员工'
    map[name] = (map[name] || 0) + Math.abs(Math.min(0, t.product_price || 0))
  }
  return map
}

export function topEntry(map) {
  let best = null
  for (const [name, amount] of Object.entries(map)) {
    if (!best || amount > best.amount) best = { name, amount }
  }
  return best
}

export function pctChange(current, baseline) {
  if (!baseline || baseline <= 0) return current > 0 ? 100 : 0
  return ((current - baseline) / baseline) * 100
}

/** 成交笔数（serial_number 去重） */
export function orderCount(txns, start, end) {
  const purchases = (txns || []).filter(
    (t) => t.type === 'purchase'
      && inRange(t.operated_at, start, end)
      && (t.product_price || 0) > 0
  )
  const ids = new Set(purchases.map((t) => t.serial_number).filter(Boolean))
  return ids.size > 0 ? ids.size : purchases.length
}

export function topProductSales(txns, start, end, limit = 3) {
  const map = {}
  for (const t of txns || []) {
    if (t.type !== 'purchase' || !inRange(t.operated_at, start, end)) continue
    if ((t.product_price || 0) <= 0) continue
    const name = t.product_name || '未知商品'
    map[name] = (map[name] || 0) + (t.product_price || 0)
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
}

export function topStaffSales(txns, start, end, staffList, limit = 3) {
  const idToName = {}
  for (const s of staffList || []) idToName[s._id] = s.name
  const map = {}
  for (const t of txns || []) {
    if (t.type !== 'purchase' || !inRange(t.operated_at, start, end)) continue
    if ((t.product_price || 0) <= 0) continue
    const name = idToName[t.therapist_id] || '未知员工'
    map[name] = (map[name] || 0) + (t.product_price || 0)
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
}

/** 核销项目次数 Top N（按 fee_count 计） */
export function topCheckoutProjects(txns, start, end, limit = 3) {
  const map = {}
  for (const t of txns || []) {
    if (t.type !== 'checkout' || !t.is_fee || !inRange(t.operated_at, start, end)) continue
    const name = t.fee_project_name || t.product_name || '未知项目'
    map[name] = (map[name] || 0) + (t.fee_count ?? 1)
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, sessions]) => ({ name, sessions }))
}
