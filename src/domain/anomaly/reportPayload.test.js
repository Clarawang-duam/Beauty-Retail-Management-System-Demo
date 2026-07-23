import { describe, it, expect } from 'vitest'
import { buildFallbackBusinessReport } from '../../services/deepseekService'
import { buildReportPayload } from './reportPayload'

describe('buildFallbackBusinessReport', () => {
  it('输出包含五个标准章节', () => {
    const md = buildFallbackBusinessReport({
      period_type: '月报',
      period_label: '本月',
      comparison_label: '环比上月',
      total_sales: 10000,
      sales_change: 5,
      total_orders: 20,
      orders_change: 0,
      avg_order_value: 500,
      avg_order_change: 5,
      refund_rate: 1,
      refund_rate_change: 0,
      top_products: [{ name: '面膜', amount: 3000 }],
      top_projects: [],
      top_staff: [{ name: '小王', amount: 5000 }],
      anomalies: [],
      negative_inventory: [],
      all_normal: true,
      insufficient_data: false,
    })
    expect(md).toContain('### 📊 核心结论')
    expect(md).toContain('### 📈 经营概况')
    expect(md).toContain('### 🏆 本期亮点')
    expect(md).toContain('### ⚠️ 需要关注的问题')
    expect(md).toContain('### 📋 下一步建议')
  })
})

describe('buildReportPayload', () => {
  it('组装结构化字段', () => {
    const payload = buildReportPayload({
      periodType: 'month',
      txns: [
        { type: 'purchase', product_price: 100, product_name: 'A', serial_number: 's1', operated_at: new Date() },
      ],
      staff: [{ _id: 'st1', name: '小李' }],
      inventory: [],
      anomalyReport: { periodLabel: '本月', anomalies: [], allNormal: true, insufficientData: false },
    })
    expect(payload.period_type).toBe('月报')
    expect(payload.total_sales).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(payload.top_products)).toBe(true)
  })
})
