// 抵扣链 —— 纯函数，不依赖 db / React
// 规则见 CLAUDE.md：抵扣顺序「积分优先 → 余额次之」；积分/余额均不分摊到 paid_amount（营销成本）。

/**
 * 按「满减后 → 积分 → 余额 → 补差价」顺序算出各抵扣与应收。
 * 入参为原始字符串/数值，内部解析，便于直接对接表单。
 * @returns {{
 *   subtotalBeforePoints, pointsToRedeem, pointsDiscount, afterPoints,
 *   balanceToUse, balanceDiscount, supplementAmount, totalNum, pointsEarned
 * }}
 */
/**
 * 收款抹零：向下抹到「角」（舍去分）。enabled=false 时原样返回。
 * 例：99.87 → 99.8；启用前后差额即让利给客户的零头。
 */
export function roundPayable(amount, enabled = true) {
  if (!enabled) return +Number(amount).toFixed(2)
  return Math.floor((Number(amount) + 1e-9) * 10) / 10
}

export function computeDeductions({
  discSubtotal,
  promoSubtotal,
  promoDiscount,
  pointsInput,
  memberPoints = 0,
  pointsRedeemRate,
  balanceInput,
  memberBalance = 0,
  supplement,
  pointsEarnRate,
  hasMember = false,
}) {
  const subtotalBeforePoints = discSubtotal + Math.max(0, promoSubtotal - promoDiscount)

  const pointsToRedeem = Math.min(parseInt(pointsInput, 10) || 0, memberPoints)
  const pointsDiscount = pointsToRedeem > 0
    ? Math.min(Math.floor(pointsToRedeem / pointsRedeemRate), subtotalBeforePoints)
    : 0
  const afterPoints = Math.max(0, subtotalBeforePoints - pointsDiscount)

  const balanceToUse = Math.min(parseFloat(balanceInput) || 0, memberBalance)
  const balanceDiscount = balanceToUse > 0 ? Math.min(balanceToUse, afterPoints) : 0

  const supplementAmount = parseFloat(supplement) || 0
  const totalNum = Math.max(0, afterPoints - balanceDiscount) + supplementAmount
  const pointsEarned = hasMember ? Math.floor(totalNum * pointsEarnRate) : 0

  return {
    subtotalBeforePoints,
    pointsToRedeem,
    pointsDiscount,
    afterPoints,
    balanceToUse,
    balanceDiscount,
    supplementAmount,
    totalNum,
    pointsEarned,
  }
}
