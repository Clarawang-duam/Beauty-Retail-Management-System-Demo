// 满减促销 —— 纯函数，不依赖 db / React
// 规则见 CLAUDE.md 第6条：floor(参与满减合计 ÷ 门槛) × 减免；折扣商品（非10折）排除出满减合计。

/** 参与满减的合计：10 折、非赠品、非 BOGO 赠送项 */
export function computePromoSubtotal(cartItems, bogoFreeIdxs = new Set()) {
  return cartItems.reduce((sum, item, idx) => {
    if (bogoFreeIdxs.has(idx)) return sum
    if (item.is_gift) return sum
    if (item.discount !== 10) return sum
    return sum + item.product.sale_price
  }, 0)
}

/** 满减递进减免金额 */
export function computePromoDiscount({ promoSubtotal, promo }) {
  if (promo?.type !== 'spend_threshold') return 0
  if (promoSubtotal < promo.threshold) return 0
  return Math.floor(promoSubtotal / promo.threshold) * promo.discount
}

/**
 * 把满减总减免按原价比例分摊到参与商品，保证 paid_amount 反映实收。
 * 末件兜底取「总减免 - 已分摊」，消除四舍五入累计误差。
 * @returns {(number|null)[]} 与 cartItems 等长；null = 该件不参与分摊
 */
export function proratePromoDiscount({ cartItems, bogoFreeIdxs = new Set(), promoDiscount, promoSubtotal }) {
  const prorated = new Array(cartItems.length).fill(null)
  if (!(promoDiscount > 0 && promoSubtotal > 0)) return prorated

  const participatingIdxs = cartItems
    .map((_, i) => i)
    .filter((i) => !bogoFreeIdxs.has(i) && !cartItems[i].is_gift && cartItems[i].discount === 10)

  let allocated = 0
  participatingIdxs.forEach((idx, pos) => {
    const orig = cartItems[idx].product.sale_price
    if (pos === participatingIdxs.length - 1) {
      prorated[idx] = +(orig - (promoDiscount - allocated)).toFixed(2)
    } else {
      const share = +(orig / promoSubtotal * promoDiscount).toFixed(2)
      prorated[idx] = +(orig - share).toFixed(2)
      allocated += share
    }
  })
  return prorated
}
