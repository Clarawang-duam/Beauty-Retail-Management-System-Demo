import dayjs from 'dayjs'
import {
  netRevenue,
  mean,
  priorMonthlyRevenues,
  priorWeeklyRevenues,
  averageOrderValue,
  refundRatePercent,
  revenueByCategory,
  topCategoryChange,
  aggregateBaselineCategoryMap,
  sumNegativeInventoryByProduct,
  refundAmountByProduct,
  refundAmountByStaff,
  topEntry,
} from './metrics'

function pctChange(current, baseline) {
  if (!baseline || baseline <= 0) return current > 0 ? 100 : 0
  return ((current - baseline) / baseline) * 100
}

function fmtMoney(n) {
  return `¥${Math.round(n).toLocaleString('zh-CN')}`
}

function fmtPct(n) {
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
}

export function detectPctAnomaly(current, baseline, thresholdPct) {
  if (baseline <= 0 && current <= 0) {
    return { triggered: false, insufficient: true, current, baseline, changePct: 0 }
  }
  const changePct = pctChange(current, baseline)
  return {
    triggered: Math.abs(changePct) >= thresholdPct,
    insufficient: false,
    current,
    baseline,
    changePct,
    direction: changePct >= 0 ? 'up' : 'down',
  }
}

export function buildPeriodReport({
  periodType,
  txns,
  products,
  staff,
  inventory,
  now = dayjs(),
  isCurrent = true,
  salesThresholdPct = 20,
  aovThresholdPct = 20,
  refundThresholdPct = 50,
}) {
  const isWeek = periodType === 'week'
  let periodLabel
  if (isWeek) {
    periodLabel = isCurrent
      ? `本周（截至 ${now.format('M月D日')}）`
      : `${now.startOf('week').format('M月D日')} - ${now.endOf('week').format('M月D日')}`
  } else {
    periodLabel = isCurrent
      ? `本月（截至 ${now.format('M月D日')}）`
      : `${now.format('M月')}`
  }
  const periodWord = isWeek ? '本周' : '本月'
  const baselineWord = isWeek ? '前12周均值' : '前三月均值'

  const periodStart = isWeek ? now.startOf('week') : now.startOf('month')
  const periodEnd = now.endOf('day')

  const currentRevenue = netRevenue(txns, periodStart, periodEnd)
  const baselineRevenues = isWeek
    ? priorWeeklyRevenues(txns, 12, now)
    : priorMonthlyRevenues(txns, 3, now)
  const baselineRevenueMean = mean(baselineRevenues)

  const sales = detectPctAnomaly(currentRevenue, baselineRevenueMean, salesThresholdPct)

  const currentCat = revenueByCategory(txns, periodStart, periodEnd, products)
  let baselineCat
  if (isWeek) {
    const starts = []
    const ends = []
    for (let i = 1; i <= 12; i++) {
      const w = now.subtract(i, 'week')
      starts.push(w.startOf('week'))
      ends.push(w.endOf('week'))
    }
    baselineCat = aggregateBaselineCategoryMap(txns, starts, ends, products)
  } else {
    const starts = []
    const ends = []
    for (let i = 1; i <= 3; i++) {
      const m = now.subtract(i, 'month')
      starts.push(m.startOf('month'))
      ends.push(m.endOf('month'))
    }
    baselineCat = aggregateBaselineCategoryMap(txns, starts, ends, products)
  }
  const topCat = topCategoryChange(currentCat, baselineCat)

  const currentAov = averageOrderValue(txns, periodStart, periodEnd)
  const baselineAovs = isWeek
    ? Array.from({ length: 12 }, (_, i) => {
        const w = now.subtract(i + 1, 'week')
        return averageOrderValue(txns, w.startOf('week'), w.endOf('week'))
      })
    : Array.from({ length: 3 }, (_, i) => {
        const m = now.subtract(i + 1, 'month')
        return averageOrderValue(txns, m.startOf('month'), m.endOf('month'))
      })
  const baselineAovMean = mean(baselineAovs)
  const aov = detectPctAnomaly(currentAov, baselineAovMean, aovThresholdPct)

  const currentRefundRate = refundRatePercent(txns, periodStart, periodEnd)
  const baselineRefundRates = isWeek
    ? Array.from({ length: 12 }, (_, i) => {
        const w = now.subtract(i + 1, 'week')
        return refundRatePercent(txns, w.startOf('week'), w.endOf('week'))
      })
    : Array.from({ length: 3 }, (_, i) => {
        const m = now.subtract(i + 1, 'month')
        return refundRatePercent(txns, m.startOf('month'), m.endOf('month'))
      })
  const baselineRefundMean = mean(baselineRefundRates)
  const refundChangePct = pctChange(currentRefundRate, baselineRefundMean)
  const refund = {
    triggered: baselineRefundMean > 0
      ? refundChangePct >= refundThresholdPct
      : currentRefundRate >= 3,
    insufficient: baselineRefundRates.every((r) => r === 0) && currentRefundRate === 0,
    current: currentRefundRate,
    baseline: baselineRefundMean,
    changePct: refundChangePct,
  }

  const negativeItems = sumNegativeInventoryByProduct(inventory)
  const inventoryAnomaly = {
    triggered: negativeItems.length > 0,
    items: negativeItems,
  }

  const anomalies = []

  if (sales.triggered && !sales.insufficient) {
    const dir = sales.direction === 'up' ? '上涨' : '下降'
    const rangeNote = sales.direction === 'up' ? '高于正常波动范围' : '低于正常波动范围'
    let catNote = ''
    if (topCat && Math.abs(topCat.changePct) >= 5) {
      const catDir = topCat.changePct >= 0 ? '增长' : '下降'
      catNote = `主要${catDir}来自${topCat.name}（${fmtPct(topCat.changePct)}），建议确认是否为促销活动影响，以便后续复制成功经验。`
    }
    anomalies.push({
      dimension: 'sales',
      icon: '📈',
      title: '销售额异常',
      message: `${periodWord}销售额 ${fmtMoney(sales.current)}，较${baselineWord} ${fmtMoney(sales.baseline)} ${dir} ${Math.abs(sales.changePct).toFixed(1)}%，${rangeNote}。${catNote}`.trim(),
    })
  }

  if (aov.triggered && !aov.insufficient) {
    const dir = aov.direction === 'up' ? '上涨' : '下降'
    anomalies.push({
      dimension: 'aov',
      icon: '💰',
      title: '客单价异常',
      message: `${periodWord}客单价 ${fmtMoney(aov.current)}，较${baselineWord} ${fmtMoney(aov.baseline)} ${dir} ${Math.abs(aov.changePct).toFixed(1)}%。建议排查是否为高客单价商品（如抗衰项目）占比上升，或存在数据录入错误。`,
    })
  }

  if (refund.triggered && !refund.insufficient) {
    const topProd = topEntry(refundAmountByProduct(txns, periodStart, periodEnd))
    const topStaff = topEntry(refundAmountByStaff(txns, periodStart, periodEnd, staff))
    let extra = '建议核查退款原因分布'
    const hints = []
    if (topProd?.amount > 0) hints.push(`商品「${topProd.name}」`)
    if (topStaff?.amount > 0) hints.push(`员工「${topStaff.name}」`)
    if (hints.length) extra += `，重点关注是否与${hints.join('、')}相关`
    anomalies.push({
      dimension: 'refund',
      icon: '↩️',
      title: '退款率异常',
      message: `${periodWord}退款率 ${currentRefundRate.toFixed(1)}%，较${baselineWord} ${baselineRefundMean.toFixed(1)}% 显著偏高。${extra}。`,
    })
  }

  if (inventoryAnomaly.triggered) {
    const list = negativeItems
      .map((p) => `${p.name}（${p.qty}件）`)
      .join('、')
    anomalies.push({
      dimension: 'inventory',
      icon: '📦',
      title: '库存异常',
      message: `⚠️ 库存异常：以下商品当前库存为负数，请立即补货：${list}。可能原因：销售扣减早于入库登记，建议优先盘点这些商品。`,
    })
  }

  const hasInsufficient = [sales, aov, refund].some((d) => d.insufficient)
    && anomalies.length === 0
    && !inventoryAnomaly.triggered

  return {
    periodType,
    periodLabel,
    generatedAt: now.toISOString(),
    allNormal: anomalies.length === 0,
    anomalies,
    insufficientData: hasInsufficient,
  }
}
