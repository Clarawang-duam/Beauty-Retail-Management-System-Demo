import { useState, useMemo, useEffect } from 'react'
import dayjs from 'dayjs'
import { db } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import useCacheStore from '../store/cacheStore'
import { calcSalaryBreakdown, getProjectFeeModule, getProjectFeeRate, calcProjectFeeLine, getReferralModule, calcReferralData, calcReferralEarnings, formatSalesCountProductLabel } from '../domain/salary'

const GROUP_COLORS = [
  { pill: 'bg-blue-100 text-blue-700',    text: 'text-blue-700',    border: 'border-blue-200',    bg: 'bg-blue-50'    },
  { pill: 'bg-violet-100 text-violet-700', text: 'text-violet-700', border: 'border-violet-200',  bg: 'bg-violet-50'  },
  { pill: 'bg-amber-100 text-amber-700',  text: 'text-amber-700',   border: 'border-amber-200',   bg: 'bg-amber-50'   },
  { pill: 'bg-emerald-100 text-emerald-700', text: 'text-emerald-700', border: 'border-emerald-200', bg: 'bg-emerald-50' },
  { pill: 'bg-rose-100 text-rose-700',    text: 'text-rose-700',    border: 'border-rose-200',    bg: 'bg-rose-50'    },
]

function normalizeGroups(levelData) {
  if (!levelData || levelData.length === 0) return []
  if ('modules' in levelData[0]) return levelData
  return [{ group_id: 'default', group_name: '默认组', multiplier: 1, modules: levelData }]
}

const fmt2 = (n) => String(+(Number(n).toFixed(2)))


function FeeDetail({ feeTxns, memberMap, coeff, projectFeeMod, fallbackRate }) {
  const [expandedMembers, setExpandedMembers] = useState(() => new Set())

  const memberGroups = useMemo(() => {
    const map = {}
    feeTxns.forEach((t) => {
      const mid = t.member_id || '__unknown__'
      if (!map[mid]) map[mid] = { memberId: mid, txns: [], latestTs: 0 }
      map[mid].txns.push(t)
      const ts = new Date(t.operated_at).getTime()
      if (ts > map[mid].latestTs) map[mid].latestTs = ts
    })
    return Object.values(map).sort((a, b) => b.latestTs - a.latestTs)
  }, [feeTxns])

  const toggle = (mid) =>
    setExpandedMembers((prev) => {
      const next = new Set(prev)
      next.has(mid) ? next.delete(mid) : next.add(mid)
      return next
    })

  if (feeTxns.length === 0) return <p className="text-xs text-gray-400">暂无手工费记录</p>

  return (
    <div className="space-y-2">
      {memberGroups.map(({ memberId, txns, latestTs }) => {
        const expanded = expandedMembers.has(memberId)
        const name = memberMap[memberId] || '未知'
        const total = txns.reduce(
          (s, t) => s + calcProjectFeeLine(t, projectFeeMod, fallbackRate),
          0
        )
        const sorted = [...txns].sort((a, b) => new Date(b.operated_at) - new Date(a.operated_at))
        const visitDays = new Set(txns.map(t => dayjs(t.operated_at).format('YYYY-MM-DD'))).size
        return (
          <div key={memberId} className="border border-gray-100 rounded-lg overflow-hidden">
            <button
              onClick={() => toggle(memberId)}
              className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">{name}</span>
                <span className="text-xs text-gray-400">{visitDays} 次</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-pink-600">¥{total.toFixed(2)}</span>
                <span className="text-gray-400 text-xs">{expanded ? '▲' : '▼'}</span>
              </div>
            </button>
            {expanded && (
              <div className="divide-y divide-gray-50">
                {sorted.map((t) => {
                  const paidAmt = t.fee_paid_amount || 0
                  const denom = t.fee_base > 0 ? fmt2(paidAmt / t.fee_base) : '?'
                  // 本次耗次：优先读字段，老记录用金额反推
                  const feeCount = t.fee_count ?? 1
                  const lineFee = calcProjectFeeLine(t, projectFeeMod, fallbackRate)
                  const dt = dayjs(t.operated_at)
                  const dateLabel = `${dt.month() + 1}/${dt.date()} ${dt.format('HH:mm')}`
                  return (
                    <div key={t._id} className="px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-xs text-gray-400 shrink-0">{dateLabel}</span>
                          {t.fee_project_name && (
                            <span className="text-[10px] bg-indigo-50 text-indigo-500 px-1.5 py-0.5 rounded truncate">
                              {t.fee_project_name}
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-pink-600 shrink-0">
                          ¥{lineFee.toFixed(2)}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        实付¥{fmt2(paidAmt)} ÷ {denom} × {coeff}{feeCount > 1 && ` × ${feeCount}次`}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function EarningsPanel({
  txns,
  loading,
  staffLevel,
  getSetting,
  members,
  dimLabel = '本月',
  showLastMonthSalary = false,
  staffId = null,
}) {
  const { products } = useCacheStore()
  const [salaryExpanded, setSalaryExpanded] = useState(false)
  const [salaryLoading, setSalaryLoading] = useState(false)
  const [salaryBreakdown, setSalaryBreakdown] = useState(null)
  const [salaryError, setSalaryError] = useState(null)
  const lastMonth = dayjs().subtract(1, 'month')
  const lastMonthLabel = `${lastMonth.month() + 1}月`
  const rawFormula = getSetting('salary_formula', null)
  const formula = rawFormula?.[staffLevel] || []
  const groups = normalizeGroups(formula)
  const projectFeeMod = useMemo(() => getProjectFeeModule(formula), [formula])
  const projectFeeFallback = Number(getSetting('formula_coefficient', 0.2)) || 0.2
  const coeff = getProjectFeeRate(formula, projectFeeFallback)
  const feeTxns = useMemo(
    () => txns.filter((t) => t.is_fee && (t.fee_paid_amount || 0) > 0),
    [txns]
  )
  const feeTotal = useMemo(
    () => feeTxns.reduce((s, t) => s + calcProjectFeeLine(t, projectFeeMod, projectFeeFallback), 0),
    [feeTxns, projectFeeMod, projectFeeFallback]
  )
  const excludedBarcodes = new Set(
    (products || []).filter((p) => p.exclude_from_sales).map((p) => p.barcode).filter(Boolean)
  )
  const refundedRefIds = new Set(
    txns.filter((t) => t.type === 'refund').map((t) => t.refund_ref_id).filter(Boolean)
  )
  const salesTotal = txns
    .filter((t) => t.type === 'purchase' && !excludedBarcodes.has(t.barcode) && !refundedRefIds.has(t._id))
    .reduce((s, t) => s + (t.product_price || 0), 0)
  const staffTarget = Number(getSetting('monthly_staff_target', 0)) || 0
  const targetPct = staffTarget > 0 ? Math.min(100, (salesTotal / staffTarget) * 100) : null
  const memberMap = useMemo(
    () => Object.fromEntries((members || []).map((m) => [m._id, m.name])),
    [members]
  )

  const referralModule = useMemo(() => getReferralModule(formula), [formula])

  const referralPurchaseTxns = useMemo(
    () => txns.filter((t) => t.type === 'purchase' && !refundedRefIds.has(t._id)),
    [txns, refundedRefIds]
  )

  const referralData = useMemo(() => {
    if (!referralModule) return null
    return calcReferralData(referralPurchaseTxns, referralModule, products)
  }, [referralModule, referralPurchaseTxns, products])

  const referralEarnings = referralModule
    ? calcReferralEarnings(referralPurchaseTxns, referralModule, products)
    : 0

  const salesCountModules = useMemo(() => {
    const allMods = groups.flatMap(g => g.modules || [])
    return allMods.filter(m => m.module === '商品销售数量')
  }, [groups])

  const salesCountData = useMemo(() => {
    if (salesCountModules.length === 0) return null
    const purchaseTxns = txns.filter(t => t.type === 'purchase' && (t.product_price || 0) > 0 && !refundedRefIds.has(t._id))
    const countMap = {}
    purchaseTxns.forEach(t => {
      if (t.product_id) countMap[t.product_id] = (countMap[t.product_id] || 0) + 1
    })
    let total = 0
    const rows = []
    salesCountModules.forEach(m => {
      const ids = m.linkedProductIds || []
      const rate = m.linkedRate ?? 0
      ids.forEach(id => {
        const count = countMap[id] || 0
        if (count === 0) return
        const p = (products || []).find(p => p._id === id)
        const subtotal = count * rate
        total += subtotal
        rows.push({ productId: id, name: p?.name || id, count, rate, subtotal })
      })
    })
    return { total, rows }
  }, [salesCountModules, txns, products])

  const hasFormula = groups.some((g) => (g.modules || []).length > 0)

  useEffect(() => {
    setSalaryBreakdown(null)
    setSalaryError(null)
  }, [staffId])

  useEffect(() => {
    if (!showLastMonthSalary || !salaryExpanded || !staffId || !hasFormula) return
    setSalaryLoading(true)
    setSalaryError(null)
    const monthStart = lastMonth.startOf('month')
    const monthEnd = lastMonth.endOf('month')
    const monthStartStr = monthStart.format('YYYY-MM-DD')
    const monthEndStr = monthEnd.format('YYYY-MM-DD')
    Promise.all([
      db.collection(COLLECTIONS.TRANSACTIONS)
        .where({
          therapist_id: staffId,
          operated_at: db.command.gte(monthStart.toDate()).and(db.command.lte(monthEnd.toDate())),
        })
        .limit(1000)
        .get(),
      db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
        .where({
          staff_id: staffId,
          date: db.command.gte(monthStartStr).and(db.command.lte(monthEndStr)),
        })
        .limit(100)
        .get(),
      db.collection(COLLECTIONS.APPOINTMENTS)
        .where({
          therapist_id: staffId,
          status: 'checked_in',
          scheduled_time: db.command.gte(monthStart.toDate()).and(db.command.lte(monthEnd.toDate())),
        })
        .limit(500)
        .get(),
    ])
      .then(([txnRes, attRes, apptRes]) => {
        const breakdown = calcSalaryBreakdown(
          staffId,
          formula,
          txnRes.data,
          '月',
          products,
          attRes.data,
          staffTarget,
          apptRes.data,
          lastMonth
        )
        setSalaryBreakdown(breakdown)
      })
      .catch((err) => setSalaryError(err.message || '计算失败'))
      .finally(() => setSalaryLoading(false))
  }, [showLastMonthSalary, salaryExpanded, staffId, hasFormula, staffLevel, products, staffTarget])

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">加载中...</div>

  const getModDesc = (m) => {
    const v = m.value || 0
    const r = m.linkedRate ?? 0
    if (m.module === '餐补') return `¥${v} / 餐`
    if (m.module === '满勤') return `¥${v}（出勤达标）`
    if (m.module === '目标激励') return `¥${v}（达成员工目标）`
    if (m.module === '回店留存客人数') return `留存人数 × ¥${v} / 人`
    if (m.module === '次数计手工费') return `核销次数 × ¥${r} / 次`
    if (m.module === '学习打卡次数') return `打卡次数 × ¥${r} / 次`
    if (m.module === '项目计手工费') return `Σ费基 × ${r}`
    if (m.module === '员工本月销售总额') return `销售额 × ${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 2)}%`
    if (m.module === '商品销售数量') {
      const label = formatSalesCountProductLabel(m.linkedProductIds, products)
      return `${label} × ¥${r} / 件`
    }
    if (m.module === '拓客人数' || m.module === '人数') return `人数 × ¥${r} / 人`
    if (m.mode === 'linked') {
      if (m.linkType === 'sales_amount') return `销售额 × ${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 2)}%`
      if (m.linkType === 'product_count') return `商品件数 × ¥${r}`
      if (m.linkType === 'checkout_count') return `核销次数 × ¥${r}`
      return `× ${r}`
    }
    return `¥${v} / 月`
  }

  // 手工次数 = Σ fee_count（与手工费、薪酬口径一致：耗次2计2）
  const feeCount = feeTxns.reduce((s, t) => s + (t.fee_count ?? 1), 0)

  return (
    <div className="space-y-4">
      {/* 销售目标进度（全宽） */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <p className="text-xs text-gray-400 mb-2">{dimLabel}销售目标完成情况</p>
        {staffTarget > 0 ? (
          <>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">已完成 <span className="font-semibold text-gray-800">¥{salesTotal.toFixed(0)}</span></span>
              <span className="text-gray-400">目标 ¥{staffTarget.toFixed(0)}</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all ${targetPct >= 100 ? 'bg-green-400' : 'bg-pink-400'}`}
                style={{ width: `${targetPct}%` }}
              />
            </div>
            <p className={`text-xs mt-1.5 font-medium ${targetPct >= 100 ? 'text-green-600' : 'text-gray-500'}`}>
              {targetPct >= 100 ? '✓ 已达标' : `${targetPct.toFixed(1)}%`}
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-400">暂未设置员工目标</p>
        )}
      </div>

      {/* 统计小卡片行（全宽） */}
      <div className={`grid gap-3 ${referralData ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2'}`}>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-1">{dimLabel}手工费收益</p>
          <p className="text-2xl font-bold text-pink-500">¥{feeTotal.toFixed(2)}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <p className="text-xs text-gray-400 mb-1">{dimLabel}手工次数</p>
          <p className="text-2xl font-bold text-gray-700">{feeCount} <span className="text-base font-normal text-gray-400">次</span></p>
        </div>
        {referralData && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-400 mb-1">{dimLabel}拓客人数</p>
            <p className="text-2xl font-bold text-indigo-500">
              {referralData.total} <span className="text-base font-normal text-gray-400">人</span>
            </p>
            {referralData.breakdown.length > 0 && (
              <div className="mt-2 space-y-0.5">
                {referralData.breakdown.map(b => (
                  <p key={b.id} className="text-xs text-gray-400">
                    {b.name} <span className="text-gray-600 font-medium">{b.count}</span>
                  </p>
                ))}
              </div>
            )}
            {referralData.breakdown.length === 0 && referralModule?.linkedProductIds?.length > 0 && (
              <p className="text-xs text-gray-400 mt-1">本期暂无</p>
            )}
            {(!referralModule?.linkedProductIds?.length) && (
              <p className="text-xs text-gray-400 mt-1">未关联商品</p>
            )}
          </div>
        )}
        {referralData && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-400 mb-1">{dimLabel}拓客收益</p>
            <p className="text-2xl font-bold text-indigo-600">¥{referralEarnings.toFixed(2)}</p>
            <p className="text-xs text-gray-400 mt-1">
              {referralData.total} 人 × ¥{referralModule?.linkedRate ?? 0} / 人
            </p>
          </div>
        )}
      </div>

      {/* 两栏布局：左=商品销售激励+手工费明细，右=薪酬公式+计算说明 */}
      <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-4 items-start">
        {/* 左栏：商品销售激励（可选）+ 手工费明细 */}
        <div className="space-y-4">
          {salesCountData && (
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-400">{dimLabel}商品销售激励</p>
                <p className="text-lg font-bold text-emerald-600">¥{salesCountData.total.toFixed(2)}</p>
              </div>
              {salesCountData.rows.length > 0 ? (
                <div className="divide-y divide-gray-50">
                  {salesCountData.rows.map((row, i) => (
                    <div key={`${row.productId}-${i}`} className="flex items-center justify-between py-2">
                      <span className="text-sm text-gray-700">{row.name}</span>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        <span>{row.count} 件 × ¥{row.rate}</span>
                        <span className="font-semibold text-emerald-600 text-sm">¥{row.subtotal.toFixed(2)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">本期暂无销售记录</p>
              )}
            </div>
          )}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-400 mb-3">手工费明细（{dimLabel}）</p>
            <FeeDetail
              feeTxns={feeTxns}
              memberMap={memberMap}
              coeff={coeff}
              projectFeeMod={projectFeeMod}
              fallbackRate={projectFeeFallback}
            />
          </div>
        </div>

        {/* 右栏：薪酬公式 + 计算说明 */}
        <div className="space-y-4 md:sticky md:top-4">
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <p className="text-xs text-gray-400 mb-2">薪酬公式（{staffLevel}）</p>
            {groups.length === 0 || groups.every(g => (g.modules || []).length === 0) ? (
              <p className="text-xs text-gray-400">暂未配置薪酬公式</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-medium">薪酬 =</p>
                {groups.map((group, gIdx) => {
                  const mods = group.modules || []
                  if (mods.length === 0) return null
                  const color = GROUP_COLORS[gIdx % GROUP_COLORS.length]
                  const prevHasMods = groups.slice(0, gIdx).some(g => (g.modules || []).length > 0)
                  const multiplier = group.multiplier ?? 1
                  return (
                    <div key={group.group_id || gIdx}>
                      {prevHasMods && (
                        <div className="text-xs text-gray-400 font-bold pl-1 my-1">{group.group_op || '+'}</div>
                      )}
                      <div className={`rounded-lg border ${color.border} ${color.bg} overflow-hidden`}>
                        <div className={`flex items-center justify-between px-3 py-1.5 border-b ${color.border}`}>
                          <span className={`text-xs font-semibold ${color.text}`}>
                            {group.group_name || `组${gIdx + 1}`}
                          </span>
                          {multiplier !== 1 && (
                            <span className={`text-xs font-bold ${color.text}`}>× {multiplier}</span>
                          )}
                        </div>
                        <div className="px-3 py-1.5 space-y-1">
                          {mods.map((m, i) => (
                            <div key={m.id || i} className="flex items-baseline gap-2 text-xs">
                              <span className="text-gray-400 w-3 shrink-0 text-center">{i === 0 ? '' : (m.op || '+')}</span>
                              <span className="text-gray-700 font-medium shrink-0">{m.module}</span>
                              <span className="text-gray-400">{getModDesc(m)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {showLastMonthSalary && salaryExpanded && (
            <div className="bg-white rounded-xl p-4 shadow-sm border border-purple-100">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-400">{lastMonthLabel}工资收益</p>
                {salaryBreakdown && (
                  <p className="text-lg font-bold text-purple-600">¥{salaryBreakdown.total.toFixed(2)}</p>
                )}
              </div>
              {salaryLoading && (
                <p className="text-xs text-gray-400 text-center py-4">计算中…</p>
              )}
              {salaryError && (
                <p className="text-xs text-red-500 text-center py-4">{salaryError}</p>
              )}
              {salaryBreakdown && !salaryLoading && (
                <div className="space-y-2">
                  {salaryBreakdown.groups.map((group, gIdx) => {
                    const color = GROUP_COLORS[gIdx % GROUP_COLORS.length]
                    const prevHasGroups = salaryBreakdown.groups.slice(0, gIdx).length > 0
                    return (
                      <div key={gIdx}>
                        {prevHasGroups && (
                          <div className="text-xs text-gray-400 font-bold pl-1 my-1">{group.groupOp}</div>
                        )}
                        <div className={`rounded-lg border ${color.border} ${color.bg} overflow-hidden`}>
                          <div className={`flex items-center justify-between px-3 py-1.5 border-b ${color.border}`}>
                            <span className={`text-xs font-semibold ${color.text}`}>{group.groupName}</span>
                            <div className="flex items-center gap-2">
                              {group.multiplier !== 1 && (
                                <span className={`text-xs ${color.text}`}>× {group.multiplier}</span>
                              )}
                              <span className={`text-xs font-bold ${color.text}`}>¥{group.subtotal.toFixed(2)}</span>
                            </div>
                          </div>
                          <div className="px-3 py-1.5 space-y-1.5">
                            {group.modules.map((m, i) => (
                              <div key={i} className="flex items-baseline justify-between gap-2 text-xs">
                                <div className="flex items-baseline gap-1.5 min-w-0">
                                  <span className="text-gray-400 w-3 shrink-0 text-center">{i === 0 ? '' : m.op}</span>
                                  <span className="text-gray-700 font-medium shrink-0">{m.module}</span>
                                  <span className="text-gray-400 truncate">{m.detail}</span>
                                </div>
                                <span className="text-gray-800 font-semibold shrink-0">¥{m.amount.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {showLastMonthSalary && (
            <button
              type="button"
              onClick={() => setSalaryExpanded((v) => !v)}
              disabled={!hasFormula}
              className={`w-full py-2.5 rounded-xl text-sm border transition-colors ${
                hasFormula
                  ? 'border-purple-300 text-purple-600 bg-purple-50 hover:bg-purple-100'
                  : 'border-gray-200 text-gray-300 bg-gray-50 cursor-not-allowed'
              }`}
            >
              {salaryExpanded ? '收起上月工资收益 ▲' : '展示上月工资收益 ▼'}
            </button>
          )}

          {/* 计算说明卡片 */}
          {groups.some(g => (g.modules || []).length > 0) && (() => {
            const allMods = groups.flatMap(g => g.modules || [])
            const hasMultiGroup = groups.filter(g => (g.modules || []).length > 0).length > 1
            const hasMultiplier = groups.some(g => (g.multiplier ?? 1) !== 1)

            const MODULE_RULES = {
              '底薪':           '按统计周期天数比例折算，日/周维度按天摊算',
              '货物管理费':     '按统计周期天数比例折算',
              '账目管理费':     '按统计周期天数比例折算',
              '员工管理费':     '按统计周期天数比例折算',
              '手机费':         '按统计周期天数比例折算',
              '满勤':           '本期内有缺勤、漏卡、迟到或早退记录时清零',
              '目标激励':       '本月销售额 ≥ 员工目标时计入，否则为 ¥0',
              '餐补':           '工时满 6h 计 1 餐，加班（覆盖全天）计 2 餐，按实际天数累加',
              '回店留存客人数': '本月有核销预约的会员去重计数，同一会员多次预约只计 1 人',
              '次数计手工费':   '每次核销计 1 次，单价固定，与项目金额无关',
              '学习打卡次数':   '统计本月打卡记录中有学习打卡时间的天数',
              '员工本月销售总额': '统计本员工本月所有销售交易金额之和',
              '商品销售数量':   '统计关联商品的销售条数，赠品（¥0）不计入',
            }

            const moduleRules = []
            const seen = new Set()
            for (const m of allMods) {
              if (seen.has(m.module)) continue
              seen.add(m.module)
              if (m.module === '项目计手工费') {
                const denom = m.denominatorType || 'max'
                moduleRules.push({
                  name: '项目计手工费',
                  desc: denom === 'total'
                    ? '分母固定为规定次数，每次手工费金额恒定'
                    : '分母 = max(规定次数, 实际次数)，超规定次数后单次金额递减',
                })
              } else if (m.module === '拓客人数' || m.module === '人数') {
                const ids = m.linkedProductIds || []
                const names = ids.length > 0 ? (products || []).filter(p => ids.includes(p._id)).map(p => p.name) : []
                const label = names.length > 0
                  ? (names.length <= 3 ? `[${names.join('、')}]` : `[${names.slice(0, 3).join('、')}等${names.length}件]`)
                  : '选中商品'
                moduleRules.push({ name: m.module, desc: `${label} 的销售数量 × 单价` })
              } else if (MODULE_RULES[m.module]) {
                moduleRules.push({ name: m.module, desc: MODULE_RULES[m.module] })
              }
            }

            return (
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <p className="text-xs text-gray-400 mb-3">计算说明</p>
                <div className="space-y-3">
                  {(hasMultiGroup || hasMultiplier) && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-1.5">公式结构</p>
                      <div className="space-y-1">
                        <p className="text-xs text-gray-500">· 组内模块按运算符（＋－×÷）依次计算，第一个模块值为初始值</p>
                        {hasMultiGroup && <p className="text-xs text-gray-500">· 各组结果按组间运算符汇总后得到最终薪酬</p>}
                        {hasMultiplier && <p className="text-xs text-gray-500">· 组乘数（× n）作用于该组计算结果后再参与汇总</p>}
                      </div>
                    </div>
                  )}
                  {moduleRules.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-1.5">模块说明</p>
                      <div className="space-y-2">
                        {moduleRules.map(({ name, desc }) => (
                          <div key={name}>
                            <p className="text-xs font-medium text-gray-700">{name}</p>
                            <p className="text-xs text-gray-400 leading-relaxed">{desc}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
