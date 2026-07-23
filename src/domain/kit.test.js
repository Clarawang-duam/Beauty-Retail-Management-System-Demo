import { describe, it, expect } from 'vitest'
import { normalizeKitComponents, splitKitUnits, expandKitProductIds } from './kit'

const products = [
  { _id: 'A', spec: '盒' },
  { _id: 'c1', spec: '10ml' },
  { _id: 'c2', spec: '20ml' },
  { _id: 'single', spec: '瓶' },
]

describe('normalizeKitComponents', () => {
  it('字符串数组归一', () => {
    expect(normalizeKitComponents(['c1', 'c2'])).toEqual([
      { product_id: 'c1', qty: 1 },
      { product_id: 'c2', qty: 1 },
    ])
  })

  it('对象数组保留 qty，缺省为 1', () => {
    expect(normalizeKitComponents([{ product_id: 'c1', qty: 3 }, { product_id: 'c2' }])).toEqual([
      { product_id: 'c1', qty: 3 },
      { product_id: 'c2', qty: 1 },
    ])
  })

  it('CloudBase 对象格式 {0:..,1:..} 经 toArray 归一', () => {
    expect(normalizeKitComponents({ 0: 'c1', 1: 'c2' })).toEqual([
      { product_id: 'c1', qty: 1 },
      { product_id: 'c2', qty: 1 },
    ])
  })

  it('空返回空数组', () => {
    expect(normalizeKitComponents(null)).toEqual([])
  })
})

describe('splitKitUnits', () => {
  it('非套盒返回 null', () => {
    expect(splitKitUnits({ product: { kit_components: [] }, paidAmount: 100, products })).toBeNull()
  })

  it('按子件逐件拆分并均摊单价', () => {
    const product = { kit_components: ['c1', 'c2'] }
    const units = splitKitUnits({ product, paidAmount: 100, products })
    expect(units).toEqual([
      { product_id: 'c1', product_spec: '10ml', paid_amount: 50, product_paid_price: 50 },
      { product_id: 'c2', product_spec: '20ml', paid_amount: 50, product_paid_price: 50 },
    ])
  })

  it('qty>1 时每件展开为一条', () => {
    const product = { kit_components: [{ product_id: 'c1', qty: 2 }, { product_id: 'c2', qty: 1 }] }
    const units = splitKitUnits({ product, paidAmount: 90, products })
    // totalQty=3，perUnit=30
    expect(units).toHaveLength(3)
    expect(units.every((u) => u.paid_amount === 30)).toBe(true)
    expect(units.map((u) => u.product_id)).toEqual(['c1', 'c1', 'c2'])
  })

  it('子商品缺失时 spec 为空串', () => {
    const product = { kit_components: ['missing'] }
    const units = splitKitUnits({ product, paidAmount: 10, products })
    expect(units[0].product_spec).toBe('')
  })
})

describe('expandKitProductIds', () => {
  it('套盒展开为子商品 id，单品保留', () => {
    const all = [{ _id: 'kit', kit_components: ['c1', 'c2'] }, ...products]
    expect(expandKitProductIds(['kit', 'single'], all)).toEqual(['c1', 'c2', 'single'])
  })

  it('跨多个套盒去重', () => {
    const all = [
      { _id: 'k1', kit_components: ['c1', 'c2'] },
      { _id: 'k2', kit_components: ['c2', 'c1'] },
    ]
    expect(expandKitProductIds(['k1', 'k2'], all)).toEqual(['c1', 'c2'])
  })
})
