// 套盒（kit）拆分 —— 纯函数，不依赖 db / React
// products.kit_components 非空则为套盒；销售/录入时按子件逐件创建快照，单价分摊。
import { toArray } from '../utils/array'

/** kit_components（字符串或 {product_id,qty}）归一化为 [{ product_id, qty }] */
export function normalizeKitComponents(raw) {
  return toArray(raw).map((c) =>
    typeof c === 'string' ? { product_id: c, qty: 1 } : { product_id: c.product_id, qty: c.qty ?? 1 }
  )
}

/**
 * 把套盒按子件 × 数量展开成「快照草稿」列表，每件已分摊单价。
 * 调用方负责补 member_id / total_sessions / used_sessions 等业务字段。
 * @returns {null | { product_id, product_spec, paid_amount, product_paid_price }[]}
 *          非套盒返回 null
 */
export function splitKitUnits({ product, paidAmount, products }) {
  const components = normalizeKitComponents(product?.kit_components)
  if (components.length === 0) return null

  const totalQty = components.reduce((s, c) => s + (c.qty || 1), 0)
  const perUnit = +(paidAmount / totalQty).toFixed(2)

  const units = []
  for (const { product_id, qty } of components) {
    const child = products.find((p) => p._id === product_id)
    for (let i = 0; i < (qty || 1); i++) {
      units.push({
        product_id,
        product_spec: child?.spec ?? '',
        paid_amount: perUnit,
        product_paid_price: perUnit,
      })
    }
  }
  return units
}

/** 把 id 列表里的套盒展开成子商品 id；单品保持原样；去重 */
export function expandKitProductIds(ids, products) {
  const result = []
  ids.forEach((id) => {
    const prod = products.find((p) => p._id === id)
    const components = normalizeKitComponents(prod?.kit_components)
    if (components.length > 0) {
      components.forEach(({ product_id }) => {
        if (!result.includes(product_id)) result.push(product_id)
      })
    } else if (!result.includes(id)) {
      result.push(id)
    }
  })
  return result
}
