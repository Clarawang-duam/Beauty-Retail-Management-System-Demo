import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import {
  isDiscountablePurchase,
  staffAverageDiscount,
  isWithinBusinessHours,
} from './metrics'
import { buildStaffAnomalyReport } from './detect'

const shift = {
  morning_shift_start: '09:00',
  morning_shift_end: '13:00',
  evening_shift_start: '14:00',
  evening_shift_end: '20:00',
}

const staff = [
  { _id: 's1', name: '王芳', role: 'staff', status: '在职' },
  { _id: 's2', name: '李莉', role: 'staff', status: '在职' },
]

function purchase({ id, staffId, at, discount, price = 100, serial = 'SN1' }) {
  return {
    _id: id,
    type: 'purchase',
    therapist_id: staffId,
    operated_at: at,
    discount,
    product_price: price * discount,
    serial_number: serial,
  }
}

describe('isDiscountablePurchase', () => {
  it('排除赠品和促销负行', () => {
    expect(isDiscountablePurchase({ type: 'purchase', product_price: 0 })).toBe(false)
    expect(isDiscountablePurchase({ type: 'purchase', product_price: -10 })).toBe(false)
    expect(isDiscountablePurchase({ type: 'purchase', product_price: 80, discount: 0.8 })).toBe(true)
  })
})

describe('isWithinBusinessHours', () => {
  it('早班时段内', () => {
    expect(isWithinBusinessHours('2026-03-10T10:00:00', shift)).toBe(true)
  })
  it('午休时段外', () => {
    expect(isWithinBusinessHours('2026-03-10T13:30:00', shift)).toBe(false)
  })
  it('晚班结束后', () => {
    expect(isWithinBusinessHours('2026-03-10T22:15:00', shift)).toBe(false)
  })
})

describe('buildStaffAnomalyReport', () => {
  it('个人低折扣触发', () => {
    const ref = dayjs('2026-03-28')
    const txns = []
    // 历史 30 天（2 月）：9.2 折
    for (let i = 1; i <= 10; i++) {
      txns.push(purchase({
        id: `h${i}`,
        staffId: 's1',
        at: ref.subtract(1, 'month').date(5 + i).hour(10).toISOString(),
        discount: 0.92,
        serial: `H${i}`,
      }))
    }
    // 本月：7.8 折，5 笔以上
    for (let i = 1; i <= 6; i++) {
      txns.push(purchase({
        id: `c${i}`,
        staffId: 's1',
        at: ref.startOf('month').add(i, 'day').toISOString(),
        discount: 0.78,
        serial: `C${i}`,
      }))
    }

    const report = buildStaffAnomalyReport({
      txns,
      staffList: staff,
      refDate: ref,
      isCurrent: true,
      shiftSettings: shift,
      config: { minPurchaseOrders: 5, personalDiscountThresholdPct: 10 },
    })

    const hit = report.anomalies.find((a) => a.dimension === 'discount_personal')
    expect(hit).toBeTruthy()
    expect(hit.message).toContain('王芳')
    expect(hit.message).toContain('下降')
  })

  it('非营业时间触发', () => {
    const ref = dayjs('2026-03-15')
    const txns = [
      purchase({
        id: 'oh1',
        staffId: 's2',
        at: ref.date(5).hour(22).minute(15).toISOString(),
        discount: 1,
        serial: 'OH1',
      }),
      ...Array.from({ length: 5 }, (_, i) => purchase({
        id: `n${i}`,
        staffId: 's2',
        at: ref.date(3).hour(10).toISOString(),
        discount: 0.95,
        serial: `N${i}`,
      })),
    ]

    const report = buildStaffAnomalyReport({
      txns,
      staffList: staff,
      refDate: ref,
      shiftSettings: shift,
    })

    expect(report.anomalies.some((a) => a.dimension === 'off_hours')).toBe(true)
  })

  it('无异常时 allNormal', () => {
    const ref = dayjs('2026-03-20')
    const txns = Array.from({ length: 6 }, (_, i) => purchase({
      id: `x${i}`,
      staffId: 's1',
      at: ref.date(2).hour(10).toISOString(),
      discount: 0.95,
      serial: `X${i}`,
    }))

    const report = buildStaffAnomalyReport({
      txns,
      staffList: staff,
      refDate: ref,
      shiftSettings: shift,
      config: { minPurchaseOrders: 5 },
    })

    expect(report.allNormal).toBe(true)
  })
})

describe('staffAverageDiscount', () => {
  it('计算均值', () => {
    const start = dayjs('2026-03-01')
    const end = dayjs('2026-03-31').endOf('day')
    const txns = [
      purchase({ id: '1', staffId: 's1', at: '2026-03-05T10:00:00', discount: 0.8 }),
      purchase({ id: '2', staffId: 's1', at: '2026-03-06T10:00:00', discount: 1.0 }),
    ]
    expect(staffAverageDiscount(txns, 's1', start, end)).toBeCloseTo(0.9)
  })
})
