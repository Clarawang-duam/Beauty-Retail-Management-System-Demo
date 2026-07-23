import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import {
  netRevenue,
  averageOrderValue,
  refundRatePercent,
  sumNegativeInventoryByProduct,
  getWeekKey,
} from './metrics'
import { detectPctAnomaly, buildPeriodReport } from './detect'

describe('detectPctAnomaly', () => {
  it('偏离超过阈值时触发', () => {
    const r = detectPctAnomaly(120, 100, 20)
    expect(r.triggered).toBe(true)
    expect(r.changePct).toBe(20)
  })

  it('在正常范围内不触发', () => {
    const r = detectPctAnomaly(110, 100, 20)
    expect(r.triggered).toBe(false)
  })
})

describe('netRevenue', () => {
  it('purchase 与 refund 合并为净额', () => {
    const start = dayjs('2026-07-01').startOf('day')
    const end = dayjs('2026-07-31').endOf('day')
    const txns = [
      { type: 'purchase', product_price: 100, operated_at: new Date('2026-07-10') },
      { type: 'refund', product_price: -20, operated_at: new Date('2026-07-15') },
    ]
    expect(netRevenue(txns, start, end)).toBe(80)
  })
})

describe('refundRatePercent', () => {
  it('计算退款率', () => {
    const start = dayjs('2026-07-01').startOf('day')
    const end = dayjs('2026-07-31').endOf('day')
    const txns = [
      { type: 'purchase', product_price: 100, operated_at: new Date('2026-07-10') },
      { type: 'refund', product_price: -5, operated_at: new Date('2026-07-12') },
    ]
    expect(refundRatePercent(txns, start, end)).toBe(5)
  })
})

describe('sumNegativeInventoryByProduct', () => {
  it('按商品汇总负数库存', () => {
    const rows = [
      { product_id: 'a', product_name: '精华液', quantity: -2 },
      { product_id: 'a', product_name: '精华液', quantity: -1 },
      { product_id: 'b', product_name: '面霜', quantity: 5 },
    ]
    const neg = sumNegativeInventoryByProduct(rows)
    expect(neg).toHaveLength(1)
    expect(neg[0].qty).toBe(-3)
  })
})

describe('getWeekKey', () => {
  it('同一周返回相同周一日期', () => {
    const wed = dayjs('2026-07-02')
    const fri = dayjs('2026-07-04')
    expect(getWeekKey(wed)).toBe(getWeekKey(fri))
  })
})

describe('buildPeriodReport', () => {
  it('无异常时 allNormal 为 true', () => {
    const now = dayjs('2026-07-02')
    const report = buildPeriodReport({
      periodType: 'month',
      txns: [],
      products: [],
      staff: [],
      inventory: [],
      now,
    })
    expect(report.allNormal).toBe(true)
    expect(report.anomalies).toHaveLength(0)
  })

  it('负数库存会触发库存异常', () => {
    const now = dayjs('2026-07-02')
    const report = buildPeriodReport({
      periodType: 'week',
      txns: [],
      products: [],
      staff: [],
      inventory: [{ product_id: 'x', product_name: '测试', quantity: -2 }],
      now,
    })
    expect(report.anomalies.some((a) => a.dimension === 'inventory')).toBe(true)
  })
})
