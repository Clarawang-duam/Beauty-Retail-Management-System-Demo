import { describe, it, expect } from 'vitest'
import { buildFifoDeductions, deductionsToPlan, computeFee } from './fee'

// 构造快照辅助
const snap = (id, remaining, opts = {}) => ({
  _id: id,
  remaining_sessions: remaining,
  used_sessions: opts.used ?? 0,
  total_sessions: opts.total ?? 5,
  max_sessions: opts.max ?? 5,
  paid_amount: opts.paid ?? 12.38,
})

describe('buildFifoDeductions', () => {
  it('primary 余次充足时只扣 primary', () => {
    const snaps = [snap('a', 5), snap('b', 5)]
    const d = buildFifoDeductions({ snaps, primaryId: 'a', count: 2 })
    expect(d).toEqual([{ snap: snaps[0], deductCount: 2 }])
  })

  it('primary 余次不足时按余次升序溢出到下一张', () => {
    const a = snap('a', 1)
    const b = snap('b', 3)
    const c = snap('c', 2)
    // primary=a(1)，剩 3 次需求 → a 扣1，再按升序 c(2) 扣2
    const d = buildFifoDeductions({ snaps: [a, b, c], primaryId: 'a', count: 3 })
    expect(d).toEqual([
      { snap: a, deductCount: 1 },
      { snap: c, deductCount: 2 },
    ])
  })

  it('没有 primary 返回空', () => {
    expect(buildFifoDeductions({ snaps: [snap('a', 5)], primaryId: null, count: 1 })).toEqual([])
    expect(buildFifoDeductions({ snaps: [snap('a', 5)], primaryId: 'x', count: 1 })).toEqual([])
  })

  it('primary 余次为 0 时跳过它，从其他正余次快照扣', () => {
    const a = snap('a', 0)
    const b = snap('b', 5)
    const d = buildFifoDeductions({ snaps: [a, b], primaryId: 'a', count: 1 })
    expect(d).toEqual([{ snap: b, deductCount: 1 }])
  })

  it('超核销：额外从余次=0 的快照扣 1 次', () => {
    const a = snap('a', 5)
    const z = snap('z', 0)
    const d = buildFifoDeductions({ snaps: [a, z], primaryId: 'a', count: 1, overCheckout: true })
    expect(d).toEqual([
      { snap: a, deductCount: 1 },
      { snap: z, deductCount: 1 },
    ])
  })

  it('超核销但无余次=0 快照时不追加', () => {
    const a = snap('a', 5)
    const d = buildFifoDeductions({ snaps: [a], primaryId: 'a', count: 1, overCheckout: true })
    expect(d).toEqual([{ snap: a, deductCount: 1 }])
  })

  it('总余次不足时尽量扣，不超过可用量', () => {
    const a = snap('a', 1)
    const b = snap('b', 1)
    const d = buildFifoDeductions({ snaps: [a, b], primaryId: 'a', count: 5 })
    expect(d).toEqual([
      { snap: a, deductCount: 1 },
      { snap: b, deductCount: 1 },
    ])
  })
})

describe('deductionsToPlan', () => {
  it('扣次列表转 { snapId: 合计 } 映射', () => {
    const a = snap('a', 5)
    const z = snap('z', 0)
    const plan = deductionsToPlan([
      { snap: a, deductCount: 2 },
      { snap: z, deductCount: 1 },
    ])
    expect(plan).toEqual({ a: 2, z: 1 })
  })

  it('空列表返回空对象', () => {
    expect(deductionsToPlan([])).toEqual({})
  })
})

describe('computeFee', () => {
  it('分母取 max(核销后次数, 规定次数)：截图场景 12.38÷5×0.2×2 ≈ 0.99', () => {
    const { feeBase, fee } = computeFee({
      paidAmount: 12.38, usedSessions: 0, deductCount: 2, totalSessions: 5, coefficient: 0.2,
    })
    expect(feeBase).toBeCloseTo(2.476, 4)
    expect(fee).toBeCloseTo(0.9904, 4)
  })

  it('核销后次数超过规定次数时，分母用核销后次数', () => {
    // used=5, deduct=1 → usedAfter=6 > total=5 → 分母=6
    const { feeBase } = computeFee({
      paidAmount: 12, usedSessions: 5, deductCount: 1, totalSessions: 5, coefficient: 0.2,
    })
    expect(feeBase).toBeCloseTo(12 / 6, 6)
  })

  it('totalSessions=0 也不会除以 0（usedAfter≥1）', () => {
    const { fee } = computeFee({
      paidAmount: 10, usedSessions: 0, deductCount: 1, totalSessions: 0, coefficient: 0.2,
    })
    expect(fee).toBe(2) // 10/1*0.2*1
    expect(Number.isFinite(fee)).toBe(true)
  })
})
