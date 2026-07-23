// 手工费与核销 FIFO 扣次 —— 纯函数，不依赖 db / React
// 规则见 CLAUDE.md「手工费公式」：分母 = max(核销后次数, 规定次数)

/**
 * FIFO 扣次计划：primary 优先，余次不足时按余次升序溢出到下一张；
 * overCheckout=true 时额外从余次=0 的快照扣 1 次（超核销）。
 * @returns {{ snap: object, deductCount: number }[]}  按扣次顺序排列
 */
export function buildFifoDeductions({ snaps, primaryId, count, overCheckout = false }) {
  const primarySnap = snaps.find((s) => s._id === primaryId)
  if (!primarySnap) return []

  const restSnaps = snaps
    .filter((s) => s._id !== primaryId && s.remaining_sessions > 0)
    .sort((a, b) => a.remaining_sessions - b.remaining_sessions)

  const fifoSnaps = [
    ...(primarySnap.remaining_sessions > 0 ? [primarySnap] : []),
    ...restSnaps,
  ]

  const deductions = []
  let remaining = count
  for (const snap of fifoSnaps) {
    if (remaining <= 0) break
    const deduct = Math.min(remaining, snap.remaining_sessions)
    if (deduct > 0) {
      deductions.push({ snap, deductCount: deduct })
      remaining -= deduct
    }
  }

  if (overCheckout) {
    const overSnap = snaps.find((s) => s.remaining_sessions === 0)
    if (overSnap) deductions.push({ snap: overSnap, deductCount: 1 })
  }

  return deductions
}

/** 扣次列表 → { [snapId]: 扣次合计 } 映射（供 UI 高亮/打勾用） */
export function deductionsToPlan(deductions) {
  const plan = {}
  for (const { snap, deductCount } of deductions) {
    plan[snap._id] = (plan[snap._id] || 0) + deductCount
  }
  return plan
}

/**
 * 单张快照本次手工费。
 * @returns {{ feeBase: number, fee: number }}
 */
export function computeFee({ paidAmount, usedSessions, deductCount, totalSessions, coefficient }) {
  const usedAfter = usedSessions + deductCount
  const denominator = Math.max(usedAfter, totalSessions)
  const feeBase = paidAmount / denominator
  const fee = feeBase * coefficient * deductCount
  return { feeBase, fee }
}
