import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { db } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import useCacheStore from '../../store/cacheStore'
import useAuthStore from '../../store/authStore'
import { useOperator } from '../../hooks/useOperator'
import OperatorSelector from '../../components/OperatorSelector'
import { generateSerialNumber } from '../../utils/serialNumber'
import { toArray } from '../../utils/array'
import { fetchAll } from '../../lib/db'
import { buildFifoDeductions, deductionsToPlan, computeFee } from '../../domain/fee'
import { getProjectFeeRate } from '../../domain/salary'
import { markConvertedIfNeeded } from '../../services/recallService'

export default function CheckoutDetail() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const { appointment, member } = state || {}

  const user = useAuthStore((s) => s.user)
  const { getSetting, projects, products } = useCacheStore()
  const { operatorId, operatorName, operatorLevel, isShared, needsOperator, setActiveStaff } = useOperator()
  const salaryFormula = getSetting('salary_formula', null)
  const levelFormula = salaryFormula?.[operatorLevel || '初级'] || []
  const formulaCoefficient = getProjectFeeRate(
    levelFormula,
    Number(getSetting('formula_coefficient', 0.2)) || 0.2
  )
  const maxPerItem = Math.max(1, Number(getSetting('checkout_max_per_item', 2)) || 1)
  const maxProjects = Math.max(0, Number(getSetting('checkout_max_projects', 0)) || 0)
  const allowOverCheckout = getSetting('allow_over_checkout', true)
  const [showOperatorSwitch, setShowOperatorSwitch] = useState(false)
  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false)

  const [slots, setSlots] = useState([{ id: 0, category: '', projectId: '' }])
  const [memberProjects, setMemberProjects] = useState([])
  const [productOverrides, setProductOverrides] = useState({})
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [sessionCounts, setSessionCounts] = useState({})
  const [overCheckout, setOverCheckout] = useState({}) // { [productId]: boolean }

  useEffect(() => {
    if (!member?._id) return
    fetchAll(COLLECTIONS.MEMBER_PROJECTS, { member_id: member._id }).then(setMemberProjects)
  }, [member])

  // 从预约自动填入 slot（兼容旧单选 project_id 和新多选 project_ids）
  useEffect(() => {
    if (memberProjects.length === 0) return
    const ids = appointment?.project_ids?.length > 0
      ? appointment.project_ids
      : appointment?.project_id
      ? [appointment.project_id]
      : []
    if (ids.length === 0) return
    const newSlots = ids.map((id, i) => {
      const proj = projects.find((p) => p._id === id)
      return { id: i, category: proj?.category || '', projectId: proj?._id || '' }
    })
    setSlots(newSlots)
  }, [memberProjects])

  const categories = [...new Set(projects.map((p) => p.category))]

  // 子商品 ID → 父套盒商品对象
  const childToParent = useMemo(() => {
    const map = {}
    products.forEach((p) => {
      toArray(p.kit_components).forEach((c) => {
        const cid = typeof c === 'string' ? c : c.product_id
        map[cid] = p
      })
    })
    return map
  }, [products])

  const resetOverrides = () => {
    setProductOverrides({})
    setOverCheckout({})
  }

  const addSlot = () => {
    setSlots((prev) => [...prev, { id: Date.now(), category: '', projectId: '' }])
    resetOverrides()
  }

  const removeSlot = (slotId) => {
    setSlots((prev) => prev.filter((s) => s.id !== slotId))
    resetOverrides()
  }

  const handleSelectCategory = (slotId, category) => {
    setSlots((prev) =>
      prev.map((s) => s.id === slotId ? { ...s, category, projectId: '' } : s)
    )
    resetOverrides()
  }

  const handleSelectProject = (slotId, projectId) => {
    setSlots((prev) =>
      prev.map((s) => s.id === slotId ? { ...s, projectId } : s)
    )
    resetOverrides()
  }

  // 已填入项目的 slot
  const filledSlots = slots
    .filter((s) => s.projectId)
    .map((slot) => {
      const proj = projects.find((p) => p._id === slot.projectId)
      return {
        slotId: slot.id,
        projectId: slot.projectId,
        projectName: proj?.name || '',
      }
    })

  // 每个商品的消耗汇总
  const productConsumptionMap = {}
  filledSlots.forEach((slot) => {
    const productIds = [
      ...new Set(
        memberProjects
          .filter((mp) => mp.project_name === slot.projectName && mp.status !== 'refunded')
          .map((mp) => mp.product_id)
          .filter(Boolean)
      ),
    ]
    productIds.forEach((productId) => {
      if (!productConsumptionMap[productId]) {
        const allSnaps = memberProjects
          .filter((mp) => mp.product_id === productId
            && mp.status !== 'refunded'
            && mp.remaining_sessions > mp.total_sessions - mp.max_sessions)
          .sort((a, b) => a.remaining_sessions - b.remaining_sessions)
        if (allSnaps.length === 0) return
        const totalRemaining = allSnaps.reduce((s, mp) => s + mp.remaining_sessions, 0)
        // 仅计正余次，用于 FIFO 可用量判断
        const normalTotalRemaining = allSnaps.reduce((s, mp) => s + Math.max(0, mp.remaining_sessions), 0)
        const kitParent = childToParent[productId] || null
        productConsumptionMap[productId] = {
          allSnaps,
          totalRemaining,
          normalTotalRemaining,
          product: products.find((p) => p._id === productId) || null,
          fromProjects: [slot.projectName],
          fromSlots: [{ projectId: slot.projectId, projectName: slot.projectName }],
          kitParentId: kitParent?._id || null,
          kitParentName: kitParent?.name || null,
        }
      } else {
        if (!productConsumptionMap[productId].fromProjects.includes(slot.projectName)) {
          productConsumptionMap[productId].fromProjects.push(slot.projectName)
          productConsumptionMap[productId].fromSlots.push({ projectId: slot.projectId, projectName: slot.projectName })
        }
      }
    })
  })

  // 有效选择：默认选 allSnaps[0]；员工可覆盖，null = 本次跳过
  const effectiveSelections = {}
  Object.entries(productConsumptionMap).forEach(([productId, cons]) => {
    const hasOverride = productId in productOverrides
    // 默认选余次最少且 >0 的快照（allSnaps 已按余次升序）；全为 0/负时退回最小那张
    const positiveSnaps = cons.allSnaps.filter((s) => s.remaining_sessions > 0)
    const defaultId = positiveSnaps.length > 0
      ? positiveSnaps[0]._id
      : (cons.allSnaps[0]?._id ?? null)
    const primaryId = hasOverride
      ? (productOverrides[productId]?.primaryId ?? null)
      : defaultId
    effectiveSelections[productId] = { primaryId }
  })

  // 点击快照行：已是主则取消（本次跳过），未选则设为主
  const togglePrimary = (productId, snapId) => {
    const currentPrimary = effectiveSelections[productId]?.primaryId
    const newPrimaryId = currentPrimary === snapId ? null : snapId
    setProductOverrides((prev) => ({
      ...prev,
      [productId]: { primaryId: newPrimaryId },
    }))
  }

  // FIFO 扣次计划：{ [productId]: { [snapId]: 扣次 } }
  const fifoDeductionPlan = {}
  Object.entries(productConsumptionMap).forEach(([productId, cons]) => {
    const deductions = buildFifoDeductions({
      snaps: cons.allSnaps,
      primaryId: effectiveSelections[productId]?.primaryId,
      count: sessionCounts[productId] ?? 1,
      overCheckout: overCheckout[productId],
    })
    fifoDeductionPlan[productId] = deductionsToPlan(deductions)
  })

  // 每个 slot 的「产品不足」判断（基于正余次 FIFO 可用量）
  const slotInsufficiencyMap = {}
  filledSlots.forEach((slot) => {
    slotInsufficiencyMap[slot.slotId] = Object.entries(productConsumptionMap).some(([productId, cons]) => {
      if (!cons.fromProjects.includes(slot.projectName)) return false
      const count = sessionCounts[productId] ?? 1
      return cons.normalTotalRemaining < count
    })
  })

  // 有超核销选中时备注必填
  const hasOverCheckout = Object.values(overCheckout).some(Boolean)

  const validateCheckout = () => {
    if (!isShared && needsOperator) { alert('请先返回首页选择操作人'); return false }
    if (filledSlots.length === 0) { alert('请至少选择一个项目'); return false }
    if (hasOverCheckout && !notes.trim()) { alert('存在超核销项目，备注为必填项'); return false }

    for (const [productId, cons] of Object.entries(productConsumptionMap)) {
      const sel = effectiveSelections[productId]
      if (!sel?.primaryId) continue

      const deductions = buildFifoDeductions({
        snaps: cons.allSnaps,
        primaryId: sel.primaryId,
        count: sessionCounts[productId] ?? 1,
        overCheckout: overCheckout[productId],
      })
      for (const { snap, deductCount } of deductions) {
        if (snap.used_sessions + deductCount > snap.max_sessions) {
          const isOver = snap.remaining_sessions === 0
          alert(`「${cons.product?.name}」${isOver ? '超核销' : '消耗'}后将超出最多手工次数（${snap.max_sessions}次），不可继续核销`)
          return false
        }
      }
    }
    return true
  }

  const handleCheckoutClick = () => {
    if (!validateCheckout()) return
    if (isShared) {
      setShowCheckoutConfirm(true)
    } else {
      submitCheckout()
    }
  }

  const submitCheckout = async () => {
    setShowCheckoutConfirm(false)
    setSaving(true)
    try {
      const now = new Date()
      const checkoutSerialNumber = generateSerialNumber()
      let firstSnapId = ''

      for (const [productId, cons] of Object.entries(productConsumptionMap)) {
        const sel = effectiveSelections[productId]
        if (!sel?.primaryId) continue

        const deductions = buildFifoDeductions({
          snaps: cons.allSnaps,
          primaryId: sel.primaryId,
          count: sessionCounts[productId] ?? 1,
          overCheckout: overCheckout[productId],
        })
        if (deductions.length === 0) continue

        const slotUsingProduct = cons.fromSlots?.[0] || null

        for (const { snap, deductCount } of deductions) {
          if (!firstSnapId) firstSnapId = snap._id

          await db.collection(COLLECTIONS.MEMBER_PROJECTS).doc(snap._id).update({
            used_sessions: snap.used_sessions + deductCount,
            remaining_sessions: snap.remaining_sessions - deductCount,
          })

          const { feeBase, fee } = computeFee({
            paidAmount: snap.paid_amount,
            usedSessions: snap.used_sessions,
            deductCount,
            totalSessions: snap.total_sessions,
            coefficient: formulaCoefficient,
          })

          await db.collection(COLLECTIONS.TRANSACTIONS).add({
            serial_number: checkoutSerialNumber,
            member_id: member._id,
            member_project_id: snap._id,
            therapist_id: operatorId,
            product_name: slotUsingProduct?.projectName || '',
            product_spec: snap.product_spec || '',
            barcode: '',
            product_price: fee,
            discount: 1.0,
            type: 'checkout',
            is_fee: true,
            fee_base: feeBase,
            fee_count: deductCount,
            fee_paid_amount: snap.paid_amount,
            fee_total_sessions: snap.total_sessions,
            fee_product_id: productId,
            fee_project_id: slotUsingProduct?.projectId || '',
            fee_project_name: slotUsingProduct?.projectName || '',
            notes,
            operated_at: now,
          })

          const unitPrice = snap.product_paid_price ?? cons.product?.sale_price
          await db.collection(COLLECTIONS.TRANSACTIONS).add({
            serial_number: generateSerialNumber(),
            member_id: member._id,
            member_project_id: snap._id,
            therapist_id: operatorId,
            product_name: cons.product?.name || '',
            product_spec: cons.product?.spec || '',
            barcode: cons.product?.barcode || '',
            product_price: unitPrice,
            discount: 1.0,
            type: 'checkout',
            operated_at: now,
          })
        }
      }

      if (appointment?._id) {
        await db.collection(COLLECTIONS.APPOINTMENTS).doc(appointment._id).update({
          status: 'checked_in',
          operated_at: now,
          member_project_id: firstSnapId,
          booking_code: null,
        })
      }

      if (member?._id) {
        await db.collection(COLLECTIONS.MEMBERS).doc(member._id).update({ last_visit_at: now })
        try { await markConvertedIfNeeded(member._id, checkoutSerialNumber) } catch (_) {}
      }

      setSessionCounts({})
      setOverCheckout({})
      setActiveStaff(null)
      navigate('/')
    } catch (err) {
      alert('核销失败：' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // 留存商品分组（套盒子商品聚合到父套盒组）
  const displayGroups = []
  const handledKitParentIds = new Set()
  Object.entries(productConsumptionMap).forEach(([productId, cons]) => {
    if (cons.kitParentId) {
      if (!handledKitParentIds.has(cons.kitParentId)) {
        handledKitParentIds.add(cons.kitParentId)
        const children = Object.entries(productConsumptionMap).filter(
          ([, c]) => c.kitParentId === cons.kitParentId
        )
        displayGroups.push({ type: 'kit', parentName: cons.kitParentName, children })
      }
    } else {
      displayGroups.push({ type: 'single', productId, cons })
    }
  })

  const renderProductRows = (productId, cons, isKitChild) => {
    const count = sessionCounts[productId] ?? 1
    const normalTotalRem = cons.normalTotalRemaining
    const isInsufficient = normalTotalRem < count
    const hasZeroSnap = cons.allSnaps.some(s => s.remaining_sessions === 0)

    return cons.allSnaps.map((snap, snapIdx) => {
      const deductCount = fifoDeductionPlan[productId]?.[snap._id] ?? 0
      const willDeduct = deductCount > 0
      const overTotal = snap.used_sessions >= snap.total_sessions
      const unitPrice = snap.product_paid_price ?? cons.product?.sale_price

      return (
        <tr
          key={snap._id}
          onClick={() => togglePrimary(productId, snap._id)}
          className={`border-b last:border-0 cursor-pointer transition-colors ${
            willDeduct ? 'bg-pink-50' : 'hover:bg-gray-50'
          }`}
        >
          <td className={`py-2 ${isKitChild ? 'pl-4' : ''}`}>
            {snapIdx === 0 && (
              <>
                <div className="font-medium text-base">{cons.product?.name}</div>
                {cons.product?.spec && (
                  <div className="text-gray-400 text-sm">{cons.product.spec}</div>
                )}
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {cons.fromProjects.map((pName) => (
                    <span key={pName} className="text-sm bg-blue-50 text-blue-500 px-1.5 py-0.5 rounded-full">
                      {pName}
                    </span>
                  ))}
                </div>
                {isInsufficient && (
                  <div className="text-sm text-orange-500">⚠ 余次不足</div>
                )}
              </>
            )}
          </td>
          <td className={`py-2 text-right font-bold text-base ${overTotal ? 'text-red-500' : 'text-red-800'}`}>
            {snap.remaining_sessions}
            {overTotal && ' ⚠'}
          </td>
          <td className="py-2 text-right">¥{unitPrice}</td>
          <td className="py-2 text-center">
            {snapIdx === 0 && (() => {
              // 单次消耗上限 = min(设置上限, 可用正余次)；点击在 1..上限 循环
              const countCap = Math.min(maxPerItem, normalTotalRem)
              const canCycle = countCap >= 2
              return (
              <div className="flex flex-col items-center gap-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!canCycle) return
                    setSessionCounts(prev => ({
                      ...prev,
                      [productId]: ((prev[productId] ?? 1) % countCap) + 1,
                    }))
                  }}
                  className={`px-2 py-0.5 rounded-full text-sm font-medium border transition-colors ${
                    canCycle
                      ? count > 1
                        ? 'bg-pink-500 text-white border-pink-500'
                        : 'border-gray-300 text-gray-600 hover:border-pink-300'
                      : 'border-gray-200 text-gray-400 cursor-default opacity-60'
                  }`}
                >
                  {count}次
                </button>
                {allowOverCheckout && hasZeroSnap && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setOverCheckout(prev => ({ ...prev, [productId]: !prev[productId] }))
                    }}
                    className={`px-2 py-0.5 rounded-full text-xs font-medium transition-colors ${
                      overCheckout[productId]
                        ? 'bg-gray-300 text-gray-500'
                        : 'bg-red-500 text-white hover:bg-red-600'
                    }`}
                  >
                    {overCheckout[productId] ? '已选中' : '超核销'}
                  </button>
                )}
              </div>
              )
            })()}
          </td>
          <td className="py-2 text-center">
            {willDeduct
              ? <span className="text-pink-500 font-bold">✓</span>
              : <span className="text-gray-300 text-lg">○</span>
            }
          </td>
        </tr>
      )
    })
  }

  if (!member) {
    return (
      <div className="br-checkout flex items-center justify-center">
        <div className="text-gray-600 bg-white/90 rounded-xl px-6 py-4">数据加载失败，请返回重试</div>
      </div>
    )
  }

  return (
    <div className="br-checkout">
      <div className="br-checkout-layer">
      <div className="px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/checkout')} className="text-gray-500">← 返回</button>
        <h1 className="text-lg font-bold text-gray-800">核销详情</h1>
        {isShared && operatorName && (
          <button onClick={() => setShowOperatorSwitch(true)} className="flex items-center gap-0.5 text-base font-semibold text-[#0F6B5C]">
            {operatorName}<span className="text-xs text-[#0F6B5C]/70">▾</span>
          </button>
        )}
      </div>

      <div className="p-4 max-w-5xl mx-auto w-full">
        <div className="flex flex-col gap-4 md:grid md:grid-cols-[3fr_2fr] md:items-start">

          {/* ── 左列：会员信息 + 项目选择 ── */}
          <div className="space-y-4">
            {/* ① 会员基础信息 */}
            <div className="bg-red-50 border border-red-200 rounded-xl p-4">
              <div className="text-2xl font-bold text-red-800 mb-2">{member.name}</div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-base text-gray-600">
                <span>{member.phone}</span>
                {member.skin_type && <span>肤质：{member.skin_type}</span>}
                {member.allergy && (
                  <span className="text-red-600 font-medium">⚠ 过敏：{member.allergy}</span>
                )}
              </div>
            </div>

            {/* ② 项目选择区 */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-700 text-base">项目</h3>
                <button
                  onClick={addSlot}
                  disabled={maxProjects > 0 && slots.length >= maxProjects}
                  className="w-8 h-8 rounded-full bg-green-500 text-white text-xl flex items-center justify-center disabled:bg-gray-300 disabled:cursor-not-allowed"
                  title={maxProjects > 0 && slots.length >= maxProjects ? `单次最多 ${maxProjects} 个项目` : ''}
                >
                  +
                </button>
              </div>

              {slots.map((slot, slotIdx) => {
                const proj = slot.projectId ? projects.find((p) => p._id === slot.projectId) : null
                const isInsufficient = slotInsufficiencyMap[slot.id] || false
                const usedProjectIds = new Set(
                  slots.filter((s) => s.id !== slot.id && s.projectId).map((s) => s.projectId)
                )
                const memberProjectNames = new Set(
                  memberProjects.filter((mp) => mp.status !== 'refunded').map((mp) => mp.project_name)
                )
                const categoryProjects = (slot.category
                  ? projects.filter((p) => p.category === slot.category)
                  : projects
                ).filter((p) => !usedProjectIds.has(p._id) && memberProjectNames.has(p.name))

                const slotProjectName = proj?.name || ''
                // 取 FIFO 实际会扣次的快照中余次最少的那张，避免展示已用完的快照
                const primarySnap = Object.entries(productConsumptionMap)
                  .filter(([, cons]) => cons.fromProjects.includes(slotProjectName))
                  .flatMap(([pid, cons]) => {
                    const plan = fifoDeductionPlan[pid] || {}
                    return cons.allSnaps.filter(s => (plan[s._id] ?? 0) > 0)
                  })
                  .reduce((min, s) => !min || s.remaining_sessions < min.remaining_sessions ? s : min, null)
                const overTotal = Object.entries(productConsumptionMap)
                  .filter(([, cons]) => cons.fromProjects.includes(slotProjectName))
                  .some(([pid]) => overCheckout[pid])

                return (
                  <div key={slot.id} className="mb-3 last:mb-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base font-medium text-gray-700 shrink-0">
                        项目{slotIdx + 1}
                      </span>
                      <select
                        value={slot.category}
                        onChange={(e) => handleSelectCategory(slot.id, e.target.value)}
                        className="text-sm border border-gray-200 rounded px-2 py-1.5 text-gray-500 focus:outline-none bg-white"
                      >
                        <option value="">大类</option>
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => removeSlot(slot.id)}
                        className="text-gray-300 hover:text-red-400 ml-auto text-base"
                      >
                        ✕
                      </button>
                    </div>

                    <div className={`flex items-center gap-2 rounded-lg px-3 py-2.5 ${
                      slot.projectId
                        ? 'bg-green-50 border border-green-200'
                        : 'bg-gray-50 border border-gray-200'
                    }`}>
                      <select
                        value={slot.projectId}
                        onChange={(e) => handleSelectProject(slot.id, e.target.value)}
                        className={`flex-1 text-base bg-transparent focus:outline-none ${
                          slot.projectId ? 'text-green-800 font-medium' : 'text-gray-400'
                        }`}
                      >
                        <option value="">选择项目名称</option>
                        {categoryProjects.map((p) => (
                          <option key={p._id} value={p._id}>{p.name}</option>
                        ))}
                      </select>
                      {slot.projectId && isInsufficient && (
                        <span className="text-sm text-orange-500 shrink-0 whitespace-nowrap">
                          ⚠ 产品不足
                        </span>
                      )}
                    </div>

                    {primarySnap && (
                      <div className={`text-sm mt-1 px-1 ${overTotal ? 'text-red-500' : 'text-green-600'}`}>
                        已用 {primarySnap.used_sessions}/{primarySnap.total_sessions}次 · 剩余 {primarySnap.remaining_sessions}次
                        {overTotal && ' 🔴 超规定次数'}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ── 右列：留存商品 + 备注 + 确认核销 ── */}
          <div className="space-y-4 md:sticky md:top-4">
            {/* ③ 留存商品 */}
            {displayGroups.length > 0 && (
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <h3 className="font-semibold text-gray-700 text-base mb-3">留存商品</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-gray-400 border-b">
                      <tr>
                        <th className="text-left pb-2">品名</th>
                        <th className="text-right pb-2">余次</th>
                        <th className="text-right pb-2">单价</th>
                        <th className="text-center pb-2 w-16">耗次</th>
                        <th className="text-center pb-2 w-10">本次</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayGroups.map((group) => {
                        if (group.type === 'kit') {
                          return [
                            <tr key={`kit-${group.parentName}`} className="bg-gray-50">
                              <td colSpan={4} className="py-1.5 px-1 text-sm font-medium text-gray-500">
                                套盒：{group.parentName}
                              </td>
                            </tr>,
                            ...group.children.flatMap(([productId, cons]) =>
                              renderProductRows(productId, cons, true)
                            ),
                          ]
                        }
                        return renderProductRows(group.productId, group.cons, false)
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="text-sm text-gray-400 mt-2">
                  点击行选择本次扣次来源；再次点击取消（本次跳过该商品）
                </div>
              </div>
            )}

            {/* ④ 备注 */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-700 text-base mb-2">
                备注{hasOverCheckout && <span className="text-red-500 ml-1">*</span>}
              </h3>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="本次服务备注（可选）"
                className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-base resize-none focus:outline-none focus:ring-2 focus:ring-pink-300"
              />
            </div>

            <button
              onClick={handleCheckoutClick}
              disabled={saving}
              className="w-full py-4 bg-pink-500 hover:bg-pink-600 disabled:bg-pink-300 text-white font-semibold rounded-xl text-xl"
            >
              {saving ? '核销中...' : '确认核销'}
            </button>
          </div>

        </div>
      </div>
      </div>

      {showCheckoutConfirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-6">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h2 className="text-base font-semibold text-gray-800 mb-5">确认核销</h2>
            <p className="text-xl text-gray-500 mb-1 text-center">当前核销美容师</p>
            <p className="text-2xl mb-6 text-center">
              「
              <button
                onClick={() => setShowOperatorSwitch(true)}
                className="font-bold text-purple-600 hover:text-purple-700"
              >
                {operatorName || '请选择'}
              </button>
              」
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCheckoutConfirm(false)}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-gray-600 font-medium text-sm"
              >
                取消
              </button>
              <button
                onClick={submitCheckout}
                disabled={saving || !operatorId}
                className="flex-1 py-3 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:bg-pink-300 text-white font-semibold text-sm"
              >
                {saving ? '核销中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showOperatorSwitch && (
        <OperatorSelector
          onSelect={(s) => { setActiveStaff(s); setShowOperatorSwitch(false) }}
          onCancel={() => setShowOperatorSwitch(false)}
        />
      )}
    </div>
  )
}
