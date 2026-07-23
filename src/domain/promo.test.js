import { describe, it, expect } from 'vitest'
import { computePromoSubtotal, computePromoDiscount, proratePromoDiscount } from './promo'

const item = (price, discount = 10, extra = {}) => ({
  product: { sale_price: price },
  discount,
  ...extra,
})

describe('computePromoSubtotal', () => {
  it('仅计 10 折非赠品；折扣商品与赠品排除', () => {
    const cart = [item(100), item(200, 8), item(50, 10, { is_gift: true }), item(80)]
    expect(computePromoSubtotal(cart)).toBe(180) // 100 + 80
  })

  it('BOGO 赠送项排除', () => {
    const cart = [item(100), item(100)]
    expect(computePromoSubtotal(cart, new Set([1]))).toBe(100)
  })
})

describe('computePromoDiscount', () => {
  it('满减递进：floor(合计÷门槛)×减免', () => {
    expect(computePromoDiscount({ promoSubtotal: 750, promo: { type: 'spend_threshold', threshold: 300, discount: 50 } })).toBe(100)
  })

  it('未达门槛返回 0', () => {
    expect(computePromoDiscount({ promoSubtotal: 250, promo: { type: 'spend_threshold', threshold: 300, discount: 50 } })).toBe(0)
  })

  it('非满减类型返回 0', () => {
    expect(computePromoDiscount({ promoSubtotal: 999, promo: { type: 'other', threshold: 100, discount: 50 } })).toBe(0)
    expect(computePromoDiscount({ promoSubtotal: 999, promo: null })).toBe(0)
  })
})

describe('proratePromoDiscount', () => {
  it('按原价比例分摊，末件兜底吸收余数', () => {
    const cart = [item(100), item(200)]
    // promoSubtotal=300, discount=30 → 第一件 share=10 → 90；末件 = 200-(30-10)=180
    const prorated = proratePromoDiscount({ cartItems: cart, promoDiscount: 30, promoSubtotal: 300 })
    expect(prorated).toEqual([90, 180])
  })

  it('无减免时全为 null', () => {
    const cart = [item(100), item(200)]
    expect(proratePromoDiscount({ cartItems: cart, promoDiscount: 0, promoSubtotal: 300 })).toEqual([null, null])
  })

  it('折扣商品/赠品不参与分摊（保持 null）', () => {
    const cart = [item(100), item(200, 8), item(100, 10, { is_gift: true })]
    const prorated = proratePromoDiscount({ cartItems: cart, promoDiscount: 20, promoSubtotal: 100 })
    // 仅 idx0 参与，作为末件吸收全部：100-20=80
    expect(prorated).toEqual([80, null, null])
  })
})
