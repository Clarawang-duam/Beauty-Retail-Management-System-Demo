import dayjs from 'dayjs'
import {
  netRevenue,
  averageOrderValue,
  refundRatePercent,
  orderCount,
  topProductSales,
  topStaffSales,
  topCheckoutProjects,
  sumNegativeInventoryByProduct,
  pctChange,
  refundAmountByProduct,
  refundAmountByStaff,
  topEntry,
} from './metrics'

/**
 * 组装供 DeepSeek 使用的结构化报告数据（严禁 AI 编造字段）
 */
export function buildReportPayload({
  periodType,
  txns,
  staff,
  inventory,
  anomalyReport,
  now = dayjs(),
}) {
  const isWeek = periodType === 'week'
  const periodStart = isWeek ? now.startOf('week') : now.startOf('month')
  const periodEnd = now.endOf('day')
  const prevStart = isWeek
    ? now.subtract(1, 'week').startOf('week')
    : now.subtract(1, 'month').startOf('month')
  const prevEnd = isWeek
    ? now.subtract(1, 'week').endOf('week')
    : now.subtract(1, 'month').endOf('month')

  const totalSales = netRevenue(txns, periodStart, periodEnd)
  const prevSales = netRevenue(txns, prevStart, prevEnd)
  const totalOrders = orderCount(txns, periodStart, periodEnd)
  const prevOrders = orderCount(txns, prevStart, prevEnd)
  const avgOrderValue = averageOrderValue(txns, periodStart, periodEnd)
  const prevAov = averageOrderValue(txns, prevStart, prevEnd)
  const refundRate = refundRatePercent(txns, periodStart, periodEnd)
  const prevRefundRate = refundRatePercent(txns, prevStart, prevEnd)

  const negativeInventory = sumNegativeInventoryByProduct(inventory)
  const refundByProd = refundAmountByProduct(txns, periodStart, periodEnd)
  const refundByStaff = refundAmountByStaff(txns, periodStart, periodEnd, staff)

  return {
    period_type: isWeek ? '周报' : '月报',
    period_label: anomalyReport.periodLabel,
    comparison_label: isWeek ? '环比上周' : '环比上月',
    total_sales: Math.round(totalSales),
    sales_change: +pctChange(totalSales, prevSales).toFixed(1),
    total_orders: totalOrders,
    orders_change: +pctChange(totalOrders, prevOrders).toFixed(1),
    avg_order_value: Math.round(avgOrderValue),
    avg_order_change: +pctChange(avgOrderValue, prevAov).toFixed(1),
    refund_rate: +refundRate.toFixed(1),
    refund_rate_change: +(refundRate - prevRefundRate).toFixed(1),
    top_products: topProductSales(txns, periodStart, periodEnd, 3),
    top_projects: topCheckoutProjects(txns, periodStart, periodEnd, 3),
    top_staff: topStaffSales(txns, periodStart, periodEnd, staff, 3),
    anomalies: (anomalyReport.anomalies || []).map((a) => ({
      dimension: a.dimension,
      title: a.title,
      message: a.message,
    })),
    negative_inventory: negativeInventory.map((p) => ({
      name: p.name,
      qty: p.qty,
    })),
    top_refund_product: topEntry(refundByProd),
    top_refund_staff: topEntry(refundByStaff),
    all_normal: anomalyReport.allNormal,
    insufficient_data: anomalyReport.insufficientData,
  }
}
