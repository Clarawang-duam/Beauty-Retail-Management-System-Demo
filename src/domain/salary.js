import dayjs from 'dayjs'

export function getPeriodParams(dim, referenceDate = dayjs()) {
  const ref = dayjs(referenceDate)
  const daysInMonth = ref.daysInMonth()
  const periodDays = dim === '日' ? 1 : dim === '周' ? 7 : dim === '月' ? daysInMonth : daysInMonth * 12
  return { daysInMonth, periodDays }
}

export function normalizeFormulaGroups(formula) {
  if (!formula?.length) return []
  if ('modules' in formula[0]) return formula
  return [{ group_id: 'default', group_name: '默认组', multiplier: 1, modules: formula }]
}

/** 当前等级公式中的「项目计手工费」模块 */
export function getProjectFeeModule(formula) {
  return normalizeFormulaGroups(formula)
    .flatMap((g) => g.modules || [])
    .find((m) => m.module === '项目计手工费') || null
}

/** 项目计手工费系数；公式未配置时回退 fallback（兼容旧 formula_coefficient） */
export function getProjectFeeRate(formula, fallback = 0.2) {
  const mod = getProjectFeeModule(formula)
  if (mod == null || mod.linkedRate == null) return fallback
  return mod.linkedRate
}

/** 单笔核销手工费（与薪酬「项目计手工费」口径一致） */
export function calcProjectFeeLine(t, projectFeeMod, fallbackRate = 0.2) {
  const rate = projectFeeMod?.linkedRate ?? fallbackRate
  const cnt = t.fee_count ?? 1
  if (!projectFeeMod) {
    if (t.fee_base > 0) return (t.fee_base || 0) * cnt * fallbackRate
    return t.product_price || 0
  }
  const denominatorType = projectFeeMod.denominatorType || 'max'
  let base = 0
  if (denominatorType === 'max') {
    base = (t.fee_base || 0) * cnt
  } else {
    const totalSessions = t.fee_total_sessions
    if (totalSessions) base = ((t.fee_paid_amount || 0) / totalSessions) * cnt
  }
  return base * rate
}

/** 当前等级公式中的「拓客人数」模块 */
export function getReferralModule(formula) {
  return normalizeFormulaGroups(formula)
    .flatMap((g) => g.modules || [])
    .find((m) => m.module === '拓客人数') || null
}

/**
 * 拓客人数统计（收益页与薪酬共用）
 * - 按 product_id 匹配关联商品
 * - 仅计实付 > 0 的 purchase（调用方需已排除退款原单）
 */
export function calcReferralData(purchaseTxns, referralMod, products = []) {
  if (!referralMod) return { total: 0, breakdown: [] }
  const ids = referralMod.linkedProductIds || []
  if (ids.length === 0) return { total: 0, breakdown: [] }
  const idSet = new Set(ids)
  const countMap = {}
  for (const t of purchaseTxns || []) {
    if (t.type !== 'purchase') continue
    if ((t.product_price || 0) <= 0) continue
    if (!t.product_id || !idSet.has(t.product_id)) continue
    countMap[t.product_id] = (countMap[t.product_id] || 0) + 1
  }
  const breakdown = ids
    .map((id) => {
      const p = (products || []).find((pr) => pr._id === id)
      return { id, name: p?.name || id, count: countMap[id] || 0 }
    })
    .filter((b) => b.count > 0)
  const total = breakdown.reduce((s, b) => s + b.count, 0)
  return { total, breakdown }
}

export function calcReferralEarnings(purchaseTxns, referralMod, products = []) {
  if (!referralMod) return 0
  const { total } = calcReferralData(purchaseTxns, referralMod, products)
  return total * (referralMod.linkedRate ?? 0)
}

function attendanceDateKey(r) {
  if (r.date) return r.date
  if (r.clock_in) return dayjs(r.clock_in).format('YYYY-MM-DD')
  return null
}

/** 单日餐数（同天多条考勤合并，不重复计餐） */
export function mealsForDayRecords(records) {
  if (!records?.length) return 0
  if (records.some((r) => r.status === '加班')) return 2
  let maxHours = 0
  for (const r of records) {
    if (!r.clock_in || !r.clock_out) continue
    const hours = (new Date(r.clock_out) - new Date(r.clock_in)) / 3600000
    if (hours > maxHours) maxHours = hours
  }
  return maxHours >= 6 ? 1 : 0
}

/** 餐补餐数：按员工 + 日期去重后累加 */
export function calcMealAllowanceMeals(staffAttendance) {
  const byDate = {}
  for (const r of staffAttendance || []) {
    const key = attendanceDateKey(r)
    if (!key) continue
    if (!byDate[key]) byDate[key] = []
    byDate[key].push(r)
  }
  return Object.values(byDate).reduce((sum, dayRecords) => sum + mealsForDayRecords(dayRecords), 0)
}

export function filterStaffTxns(allTransactions, staffId) {
  const staffTxnsRaw = (allTransactions || []).filter((t) => t.therapist_id === staffId)
  const refundedRefIds = new Set(
    staffTxnsRaw.filter((t) => t.type === 'refund').map((t) => t.refund_ref_id).filter(Boolean)
  )
  return staffTxnsRaw.filter((t) => !(t.type === 'purchase' && refundedRefIds.has(t._id)))
}

export function calcModuleValue(
  mod,
  staffTxns,
  daysInMonth,
  periodDays,
  products,
  staffAttendance,
  monthlyStaffTarget,
  staffAppointments
) {
  const mode = mod.mode || 'fixed'
  const rate = mod.linkedRate ?? 0

  if (mod.module === '餐补') {
    const meals = calcMealAllowanceMeals(staffAttendance)
    return meals * (mod.value || 0)
  }

  if (mod.module === '满勤') {
    const hasMiss = (staffAttendance || []).some((r) => ['缺勤', '漏卡', '迟到', '早退', '迟到早退'].includes(r.status))
    const punchCount = (staffAttendance || []).reduce((s, r) => s + (r.clock_in ? 1 : 0) + (r.clock_out ? 1 : 0), 0)
    if (hasMiss || Math.floor(punchCount / 2) + 2 !== daysInMonth) return 0
    return (mod.value || 0) / daysInMonth * periodDays
  }

  if (mod.module === '目标激励') {
    const target = Number(monthlyStaffTarget) || 0
    if (target <= 0) return 0
    const sales = staffTxns.filter((t) => t.type === 'purchase').reduce((s, t) => s + (t.product_price || 0), 0)
    if (sales < target) return 0
    return (mod.value || 0) / daysInMonth * periodDays
  }

  if (mod.module === '学习打卡次数') {
    const count = (staffAttendance || []).filter((r) => r.study_punched_at).length
    return count * (mod.linkedRate ?? 0)
  }

  if (mod.module === '员工本月销售总额') {
    const excludedBarcodes = new Set(
      (products || []).filter((p) => p.exclude_from_sales).map((p) => p.barcode).filter(Boolean)
    )
    const total = staffTxns
      .filter((t) => t.type === 'purchase' && !excludedBarcodes.has(t.barcode))
      .reduce((s, t) => s + (t.product_price || 0), 0)
    return total * (mod.linkedRate ?? 0)
  }

  if (mod.module === '商品销售数量') {
    const linkedIds = new Set(mod.linkedProductIds || [])
    if (linkedIds.size === 0) {
      return staffTxns.filter((t) => t.type === 'purchase' && (t.product_price || 0) > 0).length * (mod.linkedRate ?? 0)
    }
    const linkedBarcodes = new Set(
      (products || []).filter((p) => linkedIds.has(p._id) && p.barcode).map((p) => p.barcode)
    )
    return staffTxns.filter((t) => t.type === 'purchase' && linkedBarcodes.has(t.barcode)).length * (mod.linkedRate ?? 0)
  }

  if (mod.module === '回店留存客人数') {
    const uniqueMembers = new Set(
      (staffAppointments || []).filter((a) => a.member_id).map((a) => a.member_id)
    )
    return uniqueMembers.size * (mod.value || 0)
  }

  if (mod.module === '项目计手工费') {
    const feeTxns = staffTxns.filter((t) => t.is_fee)
    const denominatorType = mod.denominatorType || 'max'
    const base = feeTxns.reduce((s, t) => {
      const cnt = t.fee_count ?? 1
      if (denominatorType === 'max') {
        return s + (t.fee_base || 0) * cnt
      }
      const totalSessions = t.fee_total_sessions
      if (!totalSessions) return s
      return s + (t.fee_paid_amount || 0) / totalSessions * cnt
    }, 0)
    return base * rate
  }

  if (mod.module === '拓客人数') {
    return calcReferralEarnings(staffTxns, mod, products)
  }

  if (mode !== 'linked') {
    return (mod.value || 0) / daysInMonth * periodDays
  }
  if (mod.linkType === 'product_count') {
    const linkedIds = new Set(mod.linkedProductIds || [])
    const linkedBarcodes = new Set(
      (products || []).filter((p) => linkedIds.has(p._id) && p.barcode).map((p) => p.barcode)
    )
    return staffTxns.filter((t) => t.type === 'purchase' && linkedBarcodes.has(t.barcode)).length * rate
  }
  if (mod.linkType === 'sales_amount') {
    return staffTxns.filter((t) => t.type === 'purchase').reduce((s, t) => s + (t.product_price || 0), 0) * rate
  }
  if (mod.linkType === 'checkout_count') {
    const sessions = staffTxns.filter((t) => t.is_fee).reduce((s, t) => s + (t.fee_count ?? 1), 0)
    return sessions * rate
  }
  return 0
}

function pctLabel(rate) {
  return `${(rate * 100).toFixed(rate * 100 % 1 === 0 ? 0 : 2)}%`
}

/** 商品销售数量：关联商品名称标签（与薪酬设置预览一致） */
export function formatSalesCountProductLabel(linkedProductIds, products = []) {
  const ids = linkedProductIds || []
  if (ids.length === 0) return '所有商品'
  const names = (products || []).filter((p) => ids.includes(p._id)).map((p) => p.name)
  if (names.length === 0) return '所有商品'
  if (names.length <= 3) return `[${names.join('、')}]`
  return `[${names.slice(0, 3).join('、')}等${names.length}件]`
}

function purchaseCount(staffTxns, linkedProductIds, products) {
  const linkedIds = new Set(linkedProductIds || [])
  if (linkedIds.size === 0) {
    return staffTxns.filter((t) => t.type === 'purchase' && (t.product_price || 0) > 0).length
  }
  const linkedBarcodes = new Set(
    (products || []).filter((p) => linkedIds.has(p._id) && p.barcode).map((p) => p.barcode)
  )
  return staffTxns.filter((t) => t.type === 'purchase' && linkedBarcodes.has(t.barcode)).length
}

export function getModuleDetail(mod, ctx) {
  const {
    staffTxns,
    daysInMonth,
    periodDays,
    products,
    staffAttendance,
    monthlyStaffTarget,
    staffAppointments,
  } = ctx
  const amount = calcModuleValue(
    mod,
    staffTxns,
    daysInMonth,
    periodDays,
    products,
    staffAttendance,
    monthlyStaffTarget,
    staffAppointments
  )
  const rate = mod.linkedRate ?? 0
  const value = mod.value || 0
  const mode = mod.mode || 'fixed'

  if (mod.module === '餐补') {
    const meals = value > 0 ? amount / value : 0
    return { amount, detail: `${meals}餐 × ¥${value}/餐` }
  }
  if (mod.module === '满勤') {
    const hasMiss = (staffAttendance || []).some((r) => ['缺勤', '漏卡', '迟到', '早退', '迟到早退'].includes(r.status))
    return { amount, detail: amount > 0 ? '出勤达标' : hasMiss ? '有缺勤/迟到记录' : '打卡天数不足' }
  }
  if (mod.module === '目标激励') {
    const target = Number(monthlyStaffTarget) || 0
    const sales = staffTxns.filter((t) => t.type === 'purchase').reduce((s, t) => s + (t.product_price || 0), 0)
    if (amount > 0) return { amount, detail: `销售额 ¥${sales.toFixed(0)} ≥ 目标 ¥${target}` }
    return { amount, detail: target > 0 ? `未达标（¥${sales.toFixed(0)} / ¥${target}）` : '未设置目标' }
  }
  if (mod.module === '学习打卡次数') {
    const count = rate > 0 ? amount / rate : 0
    return { amount, detail: `${count}次 × ¥${rate}/次` }
  }
  if (mod.module === '员工本月销售总额') {
    const excludedBarcodes = new Set(
      (products || []).filter((p) => p.exclude_from_sales).map((p) => p.barcode).filter(Boolean)
    )
    const total = staffTxns
      .filter((t) => t.type === 'purchase' && !excludedBarcodes.has(t.barcode))
      .reduce((s, t) => s + (t.product_price || 0), 0)
    return { amount, detail: `¥${total.toFixed(2)} × ${pctLabel(rate)}` }
  }
  if (mod.module === '商品销售数量') {
    const count = rate > 0 ? amount / rate : purchaseCount(staffTxns, mod.linkedProductIds, products)
    const label = formatSalesCountProductLabel(mod.linkedProductIds, products)
    return { amount, detail: `${label} ${count}件 × ¥${rate}/件` }
  }
  if (mod.module === '回店留存客人数') {
    const count = value > 0 ? amount / value : 0
    return { amount, detail: `${count}人 × ¥${value}/人` }
  }
  if (mod.module === '项目计手工费') {
    const feeTxns = staffTxns.filter((t) => t.is_fee)
    const denominatorType = mod.denominatorType || 'max'
    const base = feeTxns.reduce((s, t) => {
      const cnt = t.fee_count ?? 1
      if (denominatorType === 'max') return s + (t.fee_base || 0) * cnt
      const totalSessions = t.fee_total_sessions
      if (!totalSessions) return s
      return s + (t.fee_paid_amount || 0) / totalSessions * cnt
    }, 0)
    return { amount, detail: `费基 ¥${base.toFixed(2)} × ${rate}` }
  }
  if (mod.module === '次数计手工费' || (mode === 'linked' && mod.linkType === 'checkout_count')) {
    const sessions = rate > 0 ? amount / rate : staffTxns.filter((t) => t.is_fee).reduce((s, t) => s + (t.fee_count ?? 1), 0)
    return { amount, detail: `${sessions}次 × ¥${rate}/次` }
  }
  if (mod.module === '拓客人数') {
    const { total } = calcReferralData(staffTxns, mod, products)
    return { amount: total * rate, detail: `${total}人 × ¥${rate}/人` }
  }
  if (mod.module === '人数' || (mode === 'linked' && mod.linkType === 'product_count')) {
    const count = rate > 0 ? amount / rate : purchaseCount(staffTxns, mod.linkedProductIds, products)
    return { amount, detail: `${count}人 × ¥${rate}/人` }
  }
  if (mode === 'linked' && mod.linkType === 'sales_amount') {
    const total = staffTxns.filter((t) => t.type === 'purchase').reduce((s, t) => s + (t.product_price || 0), 0)
    return { amount, detail: `¥${total.toFixed(2)} × ${pctLabel(rate)}` }
  }
  if (periodDays < daysInMonth) {
    return { amount, detail: `¥${value} × ${periodDays}/${daysInMonth}天` }
  }
  return { amount, detail: `¥${value}/月` }
}

function applyOp(current, value, op) {
  if (current === null) return value
  if (op === '+') return current + value
  if (op === '-') return current - value
  if (op === '×') return current * value
  if (op === '÷') return value !== 0 ? current / value : current
  return current + value
}

export function calcSalaryBreakdown(
  staffId,
  formula,
  allTransactions,
  dim,
  products,
  attendanceRecords,
  monthlyStaffTarget,
  checkedInAppointments,
  referenceDate = dayjs()
) {
  const { daysInMonth, periodDays } = getPeriodParams(dim, referenceDate)
  const staffTxns = filterStaffTxns(allTransactions, staffId)
  const staffAttendance = (attendanceRecords || []).filter((r) => r.staff_id === staffId)
  const staffAppointments = (checkedInAppointments || []).filter((a) => a.therapist_id === staffId)
  const ctx = {
    staffTxns,
    daysInMonth,
    periodDays,
    products,
    staffAttendance,
    monthlyStaffTarget,
    staffAppointments,
  }

  const groups = normalizeFormulaGroups(formula)
  const breakdownGroups = []
  let salary = null

  for (const group of groups) {
    const mods = group.modules || []
    if (mods.length === 0) continue

    let groupSum = null
    const moduleRows = []
    for (const mod of mods) {
      const { amount, detail } = getModuleDetail(mod, ctx)
      moduleRows.push({
        module: mod.module,
        op: mod.op || '+',
        amount,
        detail,
      })
      groupSum = applyOp(groupSum, amount, mod.op || '+')
    }

    const multiplier = group.multiplier ?? 1
    const groupSubtotal = (groupSum ?? 0) * multiplier
    breakdownGroups.push({
      groupName: group.group_name || '默认组',
      groupOp: group.group_op || '+',
      multiplier,
      subtotal: groupSubtotal,
      modules: moduleRows,
    })

    salary = applyOp(salary, groupSubtotal, group.group_op || '+')
  }

  return {
    total: Math.max(0, salary ?? 0),
    groups: breakdownGroups,
  }
}

export function calcSalary(
  staffId,
  formula,
  allTransactions,
  dim,
  products,
  attendanceRecords,
  monthlyStaffTarget,
  checkedInAppointments,
  referenceDate = dayjs()
) {
  return calcSalaryBreakdown(
    staffId,
    formula,
    allTransactions,
    dim,
    products,
    attendanceRecords,
    monthlyStaffTarget,
    checkedInAppointments,
    referenceDate
  ).total
}
