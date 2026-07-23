const METHOD_LABEL = {
  balance: '储值卡',
  cash: '现金',
  scan: '扫码',
}

/** @param {Array<{method:string, amount:number, change?:number}>|null|undefined} methods */
export function formatPaymentMethods(methods) {
  if (!methods?.length) return null
  const parts = methods
    .filter((m) => (m.amount || 0) > 0)
    .map((m) => {
      const base = `${METHOD_LABEL[m.method] || m.method} ¥${Number(m.amount).toFixed(2)}`
      const change = Number(m.change) || 0
      return change > 0 ? `${base} -找零 ¥${change.toFixed(2)}` : base
    })
  return parts.length ? parts.join(' + ') : null
}

/** 实收 − 应收，找零（未填实收则为 0） */
export function calcChange(tenderedStr, dueAmt) {
  if (tenderedStr === '' || tenderedStr == null) return 0
  const tendered = Number(tenderedStr)
  if (Number.isNaN(tendered)) return 0
  return Math.max(0, +(tendered - dueAmt).toFixed(2))
}

/** 按流水号去重汇总 purchase 收款（现金/扫码/储值卡） */
export function aggregatePaymentTotals(transactions) {
  const seen = new Set()
  const totals = { cash: 0, scan: 0, balance: 0 }
  for (const t of transactions || []) {
    if (t.type !== 'purchase') continue
    if (!t.serial_number || seen.has(t.serial_number)) continue
    seen.add(t.serial_number)
    for (const m of t.payment_methods || []) {
      const amt = Number(m.amount) || 0
      if (amt <= 0) continue
      if (m.method === 'cash') totals.cash += amt
      else if (m.method === 'scan') totals.scan += amt
      else if (m.method === 'balance') totals.balance += amt
    }
  }
  return {
    cash: +totals.cash.toFixed(2),
    scan: +totals.scan.toFixed(2),
    balance: +totals.balance.toFixed(2),
  }
}

/** 从交易列表构建 serial_number → 支付方式文案 */
export function buildPaymentMap(transactions) {
  const map = {}
  for (const t of transactions || []) {
    if (!t.serial_number || map[t.serial_number]) continue
    const text = formatPaymentMethods(t.payment_methods)
    if (text) map[t.serial_number] = text
  }
  return map
}

/**
 * @param {object} t transaction row
 * @param {Record<string, string>} paymentMap
 */
export function getPaymentLabel(t, paymentMap) {
  if (!t.serial_number) {
    return formatPaymentMethods(t.payment_methods) || '-'
  }
  const text = paymentMap[t.serial_number]
  if (!text) return '-'
  return t.type === 'refund' ? `原单：${text}` : text
}
