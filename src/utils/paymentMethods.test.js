import { describe, it, expect } from 'vitest'
import { formatPaymentMethods, buildPaymentMap, getPaymentLabel, calcChange, aggregatePaymentTotals } from './paymentMethods'

describe('formatPaymentMethods', () => {
  it('空或无效返回 null', () => {
    expect(formatPaymentMethods(null)).toBe(null)
    expect(formatPaymentMethods([])).toBe(null)
  })

  it('单方式', () => {
    expect(formatPaymentMethods([{ method: 'cash', amount: 100 }])).toBe('现金 ¥100.00')
  })

  it('多方式组合', () => {
    expect(formatPaymentMethods([
      { method: 'balance', amount: 100 },
      { method: 'scan', amount: 68 },
    ])).toBe('储值卡 ¥100.00 + 扫码 ¥68.00')
  })

  it('含找零', () => {
    expect(formatPaymentMethods([
      { method: 'cash', amount: 88, change: 12 },
    ])).toBe('现金 ¥88.00 -找零 ¥12.00')
  })
})

describe('calcChange', () => {
  it('未填实收为 0', () => {
    expect(calcChange('', 88)).toBe(0)
  })
  it('实收大于应收', () => {
    expect(calcChange('100', 88)).toBe(12)
  })
})

describe('buildPaymentMap', () => {
  it('按流水号去重', () => {
    const map = buildPaymentMap([
      { serial_number: 'SN1', payment_methods: [{ method: 'cash', amount: 50 }] },
      { serial_number: 'SN1', payment_methods: [{ method: 'scan', amount: 99 }] },
    ])
    expect(map.SN1).toBe('现金 ¥50.00')
  })
})

describe('aggregatePaymentTotals', () => {
  it('按流水号去重汇总各支付方式', () => {
    const totals = aggregatePaymentTotals([
      { type: 'purchase', serial_number: 'SN1', payment_methods: [{ method: 'cash', amount: 100 }, { method: 'scan', amount: 50 }] },
      { type: 'purchase', serial_number: 'SN1', payment_methods: [{ method: 'cash', amount: 999 }] },
      { type: 'purchase', serial_number: 'SN2', payment_methods: [{ method: 'balance', amount: 200 }] },
    ])
    expect(totals).toEqual({ cash: 100, scan: 50, balance: 200 })
  })

  it('忽略退款与非正金额', () => {
    const totals = aggregatePaymentTotals([
      { type: 'refund', serial_number: 'SN1', payment_methods: [{ method: 'cash', amount: 100 }] },
      { type: 'purchase', serial_number: 'SN3', payment_methods: [{ method: 'cash', amount: 0 }] },
    ])
    expect(totals).toEqual({ cash: 0, scan: 0, balance: 0 })
  })
})

describe('getPaymentLabel', () => {
  const map = { SN1: '现金 ¥50.00' }

  it('退款行加原单前缀', () => {
    expect(getPaymentLabel({ serial_number: 'SN1', type: 'refund' }, map)).toBe('原单：现金 ¥50.00')
  })

  it('无记录显示 -', () => {
    expect(getPaymentLabel({ serial_number: 'SN9', type: 'purchase' }, map)).toBe('-')
  })
})
