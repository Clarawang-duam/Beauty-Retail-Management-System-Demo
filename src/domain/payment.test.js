import { describe, it, expect } from 'vitest'
import { computeDeductions, roundPayable } from './payment'

describe('roundPayable（向下抹到角）', () => {
  it('启用时舍去分', () => {
    expect(roundPayable(99.87, true)).toBe(99.8)
    expect(roundPayable(99.8, true)).toBe(99.8)
    expect(roundPayable(100, true)).toBe(100)
    expect(roundPayable(0.05, true)).toBe(0)
  })
  it('关闭时原样（两位小数）', () => {
    expect(roundPayable(99.87, false)).toBe(99.87)
  })
  it('浮点边界不被误抹', () => {
    expect(roundPayable(99.9, true)).toBe(99.9)
    expect(roundPayable(0.3, true)).toBe(0.3)
  })
})

const base = {
  discSubtotal: 0,
  promoSubtotal: 1000,
  promoDiscount: 0,
  pointsInput: '',
  memberPoints: 0,
  pointsRedeemRate: 100,
  balanceInput: '',
  memberBalance: 0,
  supplement: '',
  pointsEarnRate: 1,
  hasMember: true,
}

describe('computeDeductions', () => {
  it('无抵扣时 total = 满减后小计', () => {
    const r = computeDeductions({ ...base, promoSubtotal: 500, promoDiscount: 50 })
    expect(r.subtotalBeforePoints).toBe(450)
    expect(r.totalNum).toBe(450)
  })

  it('积分优先：100 积分/100rate = 抵 1 元', () => {
    const r = computeDeductions({ ...base, promoSubtotal: 200, pointsInput: '100', memberPoints: 500, pointsRedeemRate: 100 })
    expect(r.pointsToRedeem).toBe(100)
    expect(r.pointsDiscount).toBe(1)
    expect(r.afterPoints).toBe(199)
  })

  it('积分抵扣不超过应付小计', () => {
    const r = computeDeductions({ ...base, promoSubtotal: 5, pointsInput: '10000', memberPoints: 10000, pointsRedeemRate: 1 })
    expect(r.pointsDiscount).toBe(5)
    expect(r.afterPoints).toBe(0)
  })

  it('积分可用上限受会员持有量约束', () => {
    const r = computeDeductions({ ...base, promoSubtotal: 200, pointsInput: '999', memberPoints: 50, pointsRedeemRate: 1 })
    expect(r.pointsToRedeem).toBe(50)
  })

  it('余额在积分之后抵扣，且不超过剩余', () => {
    const r = computeDeductions({ ...base, promoSubtotal: 100, pointsInput: '50', memberPoints: 50, pointsRedeemRate: 1, balanceInput: '999', memberBalance: 30 })
    // afterPoints = 100-50 = 50；余额可用 min(999,30)=30 → balanceDiscount=30
    expect(r.afterPoints).toBe(50)
    expect(r.balanceDiscount).toBe(30)
    expect(r.totalNum).toBe(20)
  })

  it('补差价加在最后', () => {
    const r = computeDeductions({ ...base, promoSubtotal: 100, supplement: '15' })
    expect(r.totalNum).toBe(115)
  })

  it('赚取积分 = floor(实付 × earnRate)，无会员则为 0', () => {
    const withMember = computeDeductions({ ...base, promoSubtotal: 100, pointsEarnRate: 1.5 })
    expect(withMember.pointsEarned).toBe(150)
    const noMember = computeDeductions({ ...base, promoSubtotal: 100, hasMember: false })
    expect(noMember.pointsEarned).toBe(0)
  })
})
