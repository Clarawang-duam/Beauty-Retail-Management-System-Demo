import { describe, it, expect } from 'vitest'
import { mealsForDayRecords, calcMealAllowanceMeals, formatSalesCountProductLabel } from './salary'

describe('calcMealAllowanceMeals', () => {
  it('同天重复记录只计一次', () => {
    const records = [
      { date: '2025-06-01', status: '正常', clock_in: '2025-06-01T08:00:00', clock_out: '2025-06-01T16:00:00' },
      { date: '2025-06-01', status: '正常', clock_in: '2025-06-01T08:00:00', clock_out: '2025-06-01T16:00:00' },
    ]
    expect(calcMealAllowanceMeals(records)).toBe(1)
  })

  it('加班日计 2 餐', () => {
    expect(mealsForDayRecords([
      { status: '加班', clock_in: '2025-06-13T08:00:00', clock_out: '2025-06-13T21:30:00' },
    ])).toBe(2)
  })

  it('工时不足 6h 不计餐', () => {
    expect(mealsForDayRecords([
      { status: '迟到', clock_in: '2025-06-10T16:06:00', clock_out: '2025-06-10T21:30:00' },
    ])).toBe(0)
  })

  it('多天分别累加', () => {
    const records = [
      { date: '2025-06-01', status: '正常', clock_in: '2025-06-01T08:00:00', clock_out: '2025-06-01T16:00:00' },
      { date: '2025-06-02', status: '加班', clock_in: '2025-06-02T08:00:00', clock_out: '2025-06-02T21:30:00' },
    ]
    expect(calcMealAllowanceMeals(records)).toBe(3)
  })
})

describe('formatSalesCountProductLabel', () => {
  const products = [
    { _id: 'p1', name: '水光针' },
    { _id: 'p2', name: '面膜' },
    { _id: 'p3', name: '精华' },
    { _id: 'p4', name: '眼霜' },
    { _id: 'p5', name: '防晒' },
  ]

  it('未选商品为所有商品', () => {
    expect(formatSalesCountProductLabel([], products)).toBe('所有商品')
  })

  it('3 个以内全称', () => {
    expect(formatSalesCountProductLabel(['p1', 'p2'], products)).toBe('[水光针、面膜]')
  })

  it('超过 3 个缩写', () => {
    expect(formatSalesCountProductLabel(['p1', 'p2', 'p3', 'p4', 'p5'], products)).toBe('[水光针、面膜、精华等5件]')
  })
})
