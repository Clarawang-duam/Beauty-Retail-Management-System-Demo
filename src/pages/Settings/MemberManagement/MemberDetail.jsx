import { useState, useMemo } from 'react'
import { db } from '../../../lib/cloudbase'
import { COLLECTIONS } from '../../../lib/collections'
import useCacheStore from '../../../store/cacheStore'
import { findDuplicateMember } from '../../../utils/memberDuplicate'
import { usePermission } from '../../../hooks/usePermission'
import useAuthStore from '../../../store/authStore'
import { writeLog } from '../../../utils/operationLog'
import { toArray } from '../../../utils/array'
import { splitKitUnits } from '../../../domain/kit'
import { useMemberData } from '../../../hooks/useMemberData'
import CheckoutRecordPanel from './CheckoutRecordPanel'
import ProjectCard from './ProjectCard'
import { TakeAwayModal, EditProjectModal } from './ProjectModals'
import ProjectMap from './ProjectMap'
import { getCategoryTemplates } from '../../../utils/categories'

function parseBirthdayMD(birthday) {
  if (!birthday) return null
  const s = String(birthday).trim()
  let m = s.match(/\d{4}[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (m) return { month: +m[1], day: +m[2] }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/)
  if (m) return { month: +m[1], day: +m[2] }
  m = s.match(/(\d{1,2})月(\d{1,2})/)
  if (m) return { month: +m[1], day: +m[2] }
  return null
}

const PROJECT_COLORS = [
  { bg: 'bg-pink-50', border: 'border-pink-200' },
  { bg: 'bg-sky-50', border: 'border-sky-200' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { bg: 'bg-orange-50', border: 'border-orange-200' },
  { bg: 'bg-violet-50', border: 'border-violet-200' },
  { bg: 'bg-amber-50', border: 'border-amber-200' },
]

const EMPTY_HIST = {
  project_id: '',
  paid_amount: '',
  project_sessions: '',
  purchased_at: new Date().toISOString().slice(0, 10),
  productSessions: {}, // { product_id: used_sessions_string }，无关联商品时 key 为 ''
  notes: '',
}

export default function MemberDetail({ member, onBack, onUpdated }) {
  const { canEditSettings, isOwner } = usePermission()
  const user = useAuthStore((s) => s.user)
  const { getSetting, refreshCache, projects, products, staff, members } = useCacheStore()
  const [isKey, setIsKey] = useState(member.is_key ?? false)
  const memberFields = getSetting('member_fields', {
    birthday: true, gender: true, skin_type: true, allergy: true, notes: true,
  })
  const balanceEnabled = getSetting('balance_enabled', false)

  const { memberProjects, pointsRecords, balanceRecords, checkoutTxns, refetchProjects } = useMemberData(member._id)
  const fetchMemberProjects = refetchProjects
  const [showPointsHistory, setShowPointsHistory] = useState(false)
  const [showBalanceHistory, setShowBalanceHistory] = useState(false)
  const [editForm, setEditForm] = useState({ ...member })
  const [editing, setEditing] = useState(false)
  const [showAddProject, setShowAddProject] = useState(false)
  const [histForm, setHistForm] = useState(EMPTY_HIST)
  const [saving, setSaving] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [duplicateMember, setDuplicateMember] = useState(null)
  const [productSearch, setProductSearch] = useState('')
  const [productSearchResults, setProductSearchResults] = useState(null)
  const [editingProject, setEditingProject] = useState(null)
  const [projectEditForm, setProjectEditForm] = useState({ used_sessions: 0, notes: '' })
  const [expandedGroups, setExpandedGroups] = useState(new Set())
  const [takingProduct, setTakingProduct] = useState(null) // { mpId, productName }
  const [showCompleted, setShowCompleted] = useState(false)
  const [selectedGroupKey, setSelectedGroupKey] = useState(null) // 当前查看核销记录的项目卡片
  const [cardView, setCardView] = useState('grid2') // 'grid2' 双排 | 'grid3' 三排
  const [categoryFilter, setCategoryFilter] = useState('') // '' = 全部

  const staffNameMap = useMemo(
    () => Object.fromEntries((staff || []).map((s) => [s._id, s.name])),
    [staff]
  )

  const selectedProject = useMemo(
    () => projects.find((p) => p._id === histForm.project_id) ?? null,
    [projects, histForm.project_id]
  )

  const relatedProducts = useMemo(() => {
    if (!selectedProject) return []
    const ids = toArray(selectedProject.related_products)
    return products.filter((p) => ids.includes(p._id))
  }, [selectedProject, products])

  const templateProductIds = useMemo(() => {
    if (!selectedProject) return []
    return toArray(selectedProject.related_products)
  }, [selectedProject])

  // 当前商品列表是否与项目模板不一致
  const productsDiffer = useMemo(() => {
    if (!selectedProject) return false
    const currentIds = Object.keys(histForm.productSessions).filter((id) => id !== '')
    if (currentIds.length === 0) return false
    return !currentIds.some((id) => templateProductIds.includes(id))
  }, [histForm.productSessions, templateProductIds, selectedProject])

  const projectColorMap = useMemo(() => {
    const names = [...new Set(memberProjects.map((mp) => mp.project_name))].sort()
    const map = {}
    names.forEach((name, i) => { map[name] = i % PROJECT_COLORS.length })
    return map
  }, [memberProjects])

  const projectGroups = useMemo(() => {
    const childToParent = {}
    for (const p of products) {
      for (const c of toArray(p.kit_components)) {
        const pid = typeof c === 'string' ? c : c.product_id
        childToParent[pid] = p
      }
    }
    const groups = []
    const seen = new Set()
    for (const mp of memberProjects) {
      if (seen.has(mp._id)) continue
      const parentProd = childToParent[mp.product_id]
      if (parentProd) {
        const siblings = memberProjects.filter(
          (m) =>
            !seen.has(m._id) &&
            childToParent[m.product_id]?._id === parentProd._id &&
            m.project_name === mp.project_name &&
            Number(m.purchased_at) === Number(mp.purchased_at)
        )
        siblings.forEach((s) => seen.add(s._id))
        groups.push({
          type: 'kit',
          key: `${parentProd._id}|${mp.project_name}|${Number(mp.purchased_at)}`,
          parent: parentProd,
          children: siblings,
          project_name: mp.project_name,
          purchased_at: mp.purchased_at,
        })
      } else {
        seen.add(mp._id)
        const ownProd = products.find((p) => p._id === mp.product_id)
        const ownKit = toArray(ownProd?.kit_components)
        groups.push({
          type: ownKit.length > 0 ? 'kit_old' : 'single',
          key: mp._id,
          mp,
          parent: ownKit.length > 0 ? ownProd : null,
          project_name: mp.project_name,
          purchased_at: mp.purchased_at,
        })
      }
    }
    return groups
  }, [memberProjects, products])

  const { activeGroups, completedGroups } = useMemo(() => {
    const active = [], completed = []
    projectGroups.forEach(group => {
      let maxRemaining
      if (group.type === 'single') maxRemaining = group.mp.remaining_sessions
      else if (group.type === 'kit') maxRemaining = Math.max(...group.children.map(c => c.remaining_sessions))
      else maxRemaining = group.mp.remaining_sessions
      if (maxRemaining > 0) active.push(group)
      else completed.push(group)
    })
    return { activeGroups: active, completedGroups: completed }
  }, [projectGroups])

  const handleProjectSelect = (projectId) => {
    const proj = projects.find((p) => p._id === projectId)
    if (!proj) { setHistForm({ ...EMPTY_HIST, purchased_at: histForm.purchased_at }); return }
    setHistForm((prev) => ({
      ...prev, project_id: projectId, project_sessions: '', productSessions: { '': '' }, notes: '',
    }))
    setProductSearch('')
    setProductSearchResults(null)
  }

  const handleProjectSessionsChange = (value) => {
    const newSessions = {}
    for (const key of Object.keys(histForm.productSessions)) {
      newSessions[key] = value
    }
    setHistForm((prev) => ({ ...prev, project_sessions: value, productSessions: newSessions }))
  }

  const setProductSession = (productId, value) => {
    setHistForm((prev) => ({
      ...prev,
      productSessions: { ...prev.productSessions, [productId]: value },
    }))
  }

  const removeProduct = (productId) => {
    setHistForm((prev) => {
      const next = { ...prev.productSessions }
      delete next[productId]
      return { ...prev, productSessions: Object.keys(next).length > 0 ? next : { '': '' } }
    })
  }

  const handleProductSearch = () => {
    const val = productSearch.trim()
    if (!val) { setProductSearchResults(null); return }
    const alreadyAdded = Object.keys(histForm.productSessions)
    setProductSearchResults(
      products.filter((p) =>
        (p.name.toLowerCase().includes(val.toLowerCase()) || String(p.barcode ?? '').includes(val))
        && !alreadyAdded.includes(p._id)
      )
    )
  }

  const addProduct = (productId) => {
    setHistForm((prev) => {
      const next = { ...prev.productSessions }
      // 移除无商品占位 key
      delete next['']
      next[productId] = prev.project_sessions || ''
      return { ...prev, productSessions: next }
    })
    setProductSearch('')
    setProductSearchResults(null)
  }

  const handleHistSave = async () => {
    const { project_id, paid_amount, purchased_at, productSessions, notes } = histForm
    if (!project_id || paid_amount === '') { alert('请填写所有必填项'); return }
    const allFilled = Object.values(productSessions).every((v) => v !== '')
    if (!allFilled) { alert('请填写所有商品的已做次数'); return }
    if (productsDiffer && !notes.trim()) { alert('商品与项目模板不一致，备注为必填'); return }

    setSaving(true)
    try {
      const proj = projects.find((p) => p._id === project_id)
      const paidNum = Number(paid_amount)
      const purchasedTs = new Date(purchased_at).getTime()
      const entryCount = Object.keys(productSessions).length
      const baseAmount = +(paidNum / entryCount).toFixed(2)

      for (const [productId, usedStr] of Object.entries(productSessions)) {
        const prod = productId ? products.find((p) => p._id === productId) : null
        const usedNum = Number(usedStr)
        const totalNum = proj.total_sessions ?? 0
        const maxNum = proj.max_sessions ?? totalNum

        // 套盒按子件拆分（含单价分摊）；非套盒走单件
        const kitUnits = prod ? splitKitUnits({ product: prod, paidAmount: baseAmount, products }) : null
        const units = kitUnits ?? [{
          product_id: prod?._id ?? '',
          product_spec: prod?.spec ?? '',
          paid_amount: baseAmount,
          product_paid_price: baseAmount,
        }]

        for (const u of units) {
          await db.collection(COLLECTIONS.MEMBER_PROJECTS).add({
            member_id: member._id,
            project_name: proj.name,
            product_id: u.product_id,
            product_spec: u.product_spec,
            product_paid_price: u.product_paid_price,
            paid_amount: u.paid_amount,
            total_sessions: totalNum,
            max_sessions: maxNum,
            used_sessions: usedNum,
            remaining_sessions: totalNum - usedNum,
            purchased_at: purchasedTs,
            notes: notes.trim() || '',
          })
        }
      }

      await writeLog(user, '会员库', `为会员「${member.name}」手动录入历史项目「${proj.name}」`)
      setShowAddProject(false)
      setHistForm({ ...EMPTY_HIST, purchased_at: new Date().toISOString().slice(0, 10) })
      setProductSearch('')
      setProductSearchResults(null)
      fetchMemberProjects()
    } finally {
      setSaving(false)
    }
  }

  const openProjectEdit = (mp) => {
    setEditingProject(mp)
    setProjectEditForm({ used_sessions: mp.used_sessions, notes: mp.notes ?? '', paid_amount: mp.paid_amount ?? '' })
  }

  const handleProjectDelete = async (mp) => {
    if (!window.confirm('确认删除该项目记录？此操作不可恢复。')) return
    await db.collection(COLLECTIONS.MEMBER_PROJECTS).doc(mp._id).remove()
    fetchMemberProjects()
  }

  const handleTakeAway = async () => {
    await db.collection(COLLECTIONS.MEMBER_PROJECTS).doc(takingProduct.mpId).remove()
    await writeLog(user, '会员库', `「${member.name}」拿走了「${takingProduct.productName}」`)
    setTakingProduct(null)
    fetchMemberProjects()
  }

  const handleProjectSave = async () => {
    const usedNum = Number(projectEditForm.used_sessions)
    const paidNum = Number(projectEditForm.paid_amount)
    await db.collection(COLLECTIONS.MEMBER_PROJECTS).doc(editingProject._id).update({
      used_sessions: usedNum,
      remaining_sessions: editingProject.total_sessions - usedNum,
      notes: projectEditForm.notes,
      paid_amount: paidNum,
      product_paid_price: paidNum,
    })
    setEditingProject(null)
    fetchMemberProjects()
  }

  // 取项目卡片对应的所有快照 ID
  const groupSnapIds = (group) =>
    group.type === 'kit' ? group.children.map((c) => c._id) : [group.mp._id]

  const toggleSelectGroup = (group) => {
    setSelectedGroupKey((prev) => (prev === group.key ? null : group.key))
  }

  // 当前选中卡片的核销记录（合并全部子快照，按日期倒序）
  const selectedGroup = useMemo(
    () => projectGroups.find((g) => g.key === selectedGroupKey) ?? null,
    [projectGroups, selectedGroupKey]
  )
  const selectedRecords = useMemo(() => {
    if (!selectedGroup) return []
    const ids = new Set(groupSnapIds(selectedGroup))
    return checkoutTxns
      .filter((t) => ids.has(t.member_project_id))
      .map((t) => {
        const prod = products.find((p) => p._id === t.fee_product_id)
        const feeCount = t.fee_count ?? 1
        return { ...t, productName: prod?.name || '', feeCount }
      })
  }, [selectedGroup, checkoutTxns, products])

  const toggleGroup = (key) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  const handleToggleKey = async () => {
    const next = !isKey
    const msg = next
      ? `确认将「${member.name}」设为重点会员？`
      : `确认取消「${member.name}」的重点会员标记？`
    if (!window.confirm(msg)) return
    await db.collection(COLLECTIONS.MEMBERS).doc(member._id).update({ is_key: next })
    await refreshCache('members')
    setIsKey(next)
  }

  const handleSave = async () => {
    const name = editForm.name?.trim()
    const phone = editForm.phone?.trim()
    if (!name || !phone) { alert('姓名和手机号不能为空'); return }
    const { _id, _openid, ...updateData } = editForm
    updateData.name = name
    updateData.phone = phone
    // 仅老板可改余额；变动时补记一条余额明细，保证「历史余额信息」对得上
    const oldBal = +(member.balance ?? 0)
    const newBal = +(updateData.balance ?? 0)
    const balanceChanged = isOwner && balanceEnabled && newBal !== oldBal
    if (balanceChanged && !Number.isFinite(newBal)) { alert('余额必须是数字'); return }

    setProfileSaving(true)
    try {
      let memberList = members
      if (memberList.length === 0) {
        await refreshCache('members')
        memberList = useCacheStore.getState().members
      }
      const dup = findDuplicateMember(name, phone, memberList, member._id)
      if (dup) {
        setDuplicateMember(dup)
        return
      }

      try {
        await db.collection(COLLECTIONS.MEMBERS).doc(member._id).update(updateData)
      } catch (err) {
        alert('保存失败：' + err.message)
        return
      }
      if (balanceChanged) {
        // 明细记录尽力而为：即使写入失败，余额本身已保存，不阻断流程
        try {
          await db.collection(COLLECTIONS.BALANCE_RECORDS).add({
            member_id: member._id,
            type: 'adjust',
            amount: +(newBal - oldBal).toFixed(2),
            bonus_amount: 0,
            note: `手动调整余额 ¥${oldBal.toFixed(2)} → ¥${newBal.toFixed(2)}`,
            staff_id: user?.uid || '',
            created_at: new Date(),
          })
          await writeLog(user, '会员库', `调整会员「${name}」余额 ¥${oldBal.toFixed(2)} → ¥${newBal.toFixed(2)}`)
        } catch (err) {
          alert('余额已更新，但写入余额明细失败：' + err.message)
        }
      }
      await writeLog(user, '会员库', `修改会员「${name}」信息`)
      await refreshCache('members')
      setEditing(false)
      onUpdated?.()
      onBack()
    } finally {
      setProfileSaving(false)
    }
  }

  // 大类筛选标签
  const catOf = (group) => projects.find((p) => p.name === group.project_name)?.category || ''
  const catCount = {}
  for (const g of [...activeGroups, ...completedGroups]) {
    const c = catOf(g)
    if (c) catCount[c] = (catCount[c] || 0) + 1
  }
  const memberCats = new Set(Object.keys(catCount))
  const allCategoryTemplates = (() => {
    const tpl = getCategoryTemplates(getSetting('project_categories', null), projects)
    return [...tpl.filter((c) => memberCats.has(c)), ...tpl.filter((c) => !memberCats.has(c))] // 拥有的在前，灰色在后
  })()

  const twoCol = selectedGroupKey && selectedGroup
  // 看核销记录时自动退回单排；否则按所选双排/三排
  const browsing = !selectedGroupKey
  const gridClass = !browsing
    ? 'space-y-3'
    : cardView === 'grid3'
    ? 'grid grid-cols-3 gap-3 items-start'
    : 'grid grid-cols-2 gap-3 items-start'
  const compactCards = browsing && cardView === 'grid3' // 仅三排隐藏商品名
  return (
    <div className="p-4 mx-auto max-w-6xl">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700">← 返回</button>
        <h2 className="text-xl font-bold text-gray-800">会员详情</h2>
        <button
          onClick={handleToggleKey}
          className={`text-xl leading-none transition-colors ${isKey ? 'text-amber-400' : 'text-gray-300 hover:text-amber-300'}`}
          title={isKey ? '取消重点会员' : '标记为重点会员'}
        >
          ★
        </button>
        {!editing && (
          <button onClick={() => setEditing(true)}
            className="ml-auto px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm">
            编辑
          </button>
        )}
      </div>

      {/* 基础信息 */}
      <div className="bg-red-50 rounded-xl p-4 mb-4">
        <h3 className="font-semibold text-red-700 mb-3">基础信息</h3>
        {editing ? (
          <div className="space-y-2">
            {[
              { key: 'name', label: '姓名' },
              { key: 'phone', label: '手机号' },
              { key: 'points', label: '积分', type: 'number' },
              ...(isOwner && balanceEnabled ? [{ key: 'balance', label: '余额', type: 'number' }] : []),
              ...(memberFields.gender ? [{ key: 'gender', label: '性别' }] : []),
              ...(memberFields.skin_type ? [{ key: 'skin_type', label: '肤质' }] : []),
              ...(memberFields.allergy ? [{ key: 'allergy', label: '过敏史' }] : []),
              ...(memberFields.notes ? [{ key: 'notes', label: '备注' }] : []),
            ].map(({ key, label, type = 'text' }) => (
              <div key={key} className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-16 shrink-0">{label}</span>
                <input
                  type={type}
                  value={editForm[key] ?? ''}
                  onChange={(e) => setEditForm({ ...editForm, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>
            ))}
            {memberFields.birthday && (() => {
              const bd = parseBirthdayMD(editForm.birthday)
              const month = bd?.month ?? ''
              const day = bd?.day ?? ''
              const update = (m, d) => setEditForm({ ...editForm, birthday: (m || d) ? `${m}月${d}日` : '' })
              return (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 w-16 shrink-0">生日</span>
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      type="number" min="1" max="12"
                      value={month}
                      onChange={(e) => update(e.target.value, day)}
                      className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center"
                      placeholder="月"
                    />
                    <span className="text-sm text-gray-500">月</span>
                    <input
                      type="number" min="1" max="31"
                      value={day}
                      onChange={(e) => update(month, e.target.value)}
                      className="w-14 border border-gray-300 rounded px-2 py-1 text-sm text-center"
                      placeholder="日"
                    />
                    <span className="text-sm text-gray-500">日</span>
                  </div>
                </div>
              )
            })()}
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                disabled={profileSaving}
                onClick={() => setEditing(false)}
                className="flex-1 py-1.5 border border-gray-300 rounded text-gray-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                type="button"
                disabled={profileSaving}
                onClick={handleSave}
                className="flex-1 py-1.5 bg-pink-500 text-white rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {profileSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-4">
            {/* 左侧 1/3：基础信息，2 列 */}
            <div className="w-1/3 min-w-0 grid grid-cols-2 gap-x-3 gap-y-2 text-sm self-start">
              <div><span className="text-gray-500">姓名：</span><span className="font-medium">{member.name}</span></div>
              <div><span className="text-gray-500">手机：</span>{member.phone}</div>
              <div>
                <span className="text-gray-500">积分：</span><span className="text-amber-600 font-medium">{member.points ?? 0}</span>
                <button onClick={() => setShowPointsHistory(true)} className="ml-1.5 text-xs text-pink-500 hover:underline">历史积分信息</button>
              </div>
              {getSetting('balance_enabled', false) && (
                <div>
                  <span className="text-gray-500">余额：</span><span className="text-teal-600 font-medium">¥{(member.balance ?? 0).toFixed(2)}</span>
                  <button onClick={() => setShowBalanceHistory(true)} className="ml-1.5 text-xs text-pink-500 hover:underline">历史余额信息</button>
                </div>
              )}
              {memberFields.birthday && member.birthday && (
                <div><span className="text-gray-500">生日：</span>{member.birthday}</div>
              )}
              {memberFields.gender && member.gender && (
                <div><span className="text-gray-500">性别：</span>{member.gender}</div>
              )}
              {memberFields.skin_type && member.skin_type && (
                <div className="col-span-2"><span className="text-gray-500">肤质：</span>{member.skin_type}</div>
              )}
              {memberFields.allergy && member.allergy && (
                <div className="col-span-2"><span className="text-gray-500">过敏史：</span>{member.allergy}</div>
              )}
              {memberFields.notes && member.notes && (
                <div className="col-span-2"><span className="text-gray-500">备注：</span>{member.notes}</div>
              )}
            </div>
            {/* 右侧 2/3：上次到店 + 解锁项目地图 */}
            <div className="flex-1 min-w-0 border-l border-red-100 pl-4 space-y-3">
              <div className="text-sm text-gray-600">
                <span className="text-gray-500">上次到店：</span>
                {member.last_visit_at
                  ? `${new Date(member.last_visit_at).toLocaleDateString()}（${Math.floor((Date.now() - new Date(member.last_visit_at).getTime()) / 86400000)} 天前）`
                  : '暂无到店记录'}
              </div>
              {getSetting('project_map_enabled', true) && (
                <ProjectMap
                  memberProjects={memberProjects}
                  projects={projects}
                  levels={getSetting('project_map_levels', null)}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* 项目区头部：视图切换 + 添加 */}
      <div className="flex items-center gap-2 mb-4">
        <span className="font-semibold text-gray-700">购买的项目</span>
        <div className="ml-auto flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5">
          <button
            onClick={() => setCardView('grid2')}
            title="双排"
            className={`px-2 py-1 rounded-full transition-colors ${
              cardView === 'grid2' ? 'bg-white shadow-sm text-pink-600' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="1" y="2" width="6" height="12" rx="1" />
              <rect x="9" y="2" width="6" height="12" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => setCardView('grid3')}
            title="三排"
            className={`px-2 py-1 rounded-full transition-colors ${
              cardView === 'grid3' ? 'bg-white shadow-sm text-pink-600' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <rect x="1" y="2" width="3.5" height="12" rx="0.8" />
              <rect x="6.25" y="2" width="3.5" height="12" rx="0.8" />
              <rect x="11.5" y="2" width="3.5" height="12" rx="0.8" />
            </svg>
          </button>
        </div>
        {canEditSettings && (
          <button
            onClick={() => {
              setHistForm({ ...EMPTY_HIST, purchased_at: new Date().toISOString().slice(0, 10) })
              setProductSearch('')
              setProductSearchResults(null)
              setShowAddProject(true)
            }}
            className="px-3 py-1 bg-pink-500 text-white rounded text-sm"
          >
            + 添加历史项目
          </button>
        )}
      </div>

      {/* 大类筛选标签 */}
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          onClick={() => setCategoryFilter('')}
          className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
            categoryFilter === '' ? 'bg-pink-500 text-white border-pink-500' : 'bg-white text-gray-600 border-gray-200'
          }`}
        >全部</button>
        {allCategoryTemplates.map((c) => {
          const has = memberCats.has(c)
          const active = categoryFilter === c
          return (
            <button
              key={c}
              disabled={!has}
              onClick={() => setCategoryFilter(active ? '' : c)}
              className={`px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                !has ? 'bg-gray-50 text-gray-300 border-gray-100 cursor-not-allowed'
                  : active ? 'bg-pink-500 text-white border-pink-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-pink-300'
              }`}
            >{c}（{catCount[c] || 0}）</button>
          )
        })}
      </div>

      {/* 项目列表（选中卡片时切两栏：左列表 右核销记录） */}
      <div className={twoCol ? 'md:grid md:grid-cols-[3fr_2fr] md:gap-4 md:items-start' : ''}>
      <div className={gridClass}>
        {[
          ...activeGroups,
          ...(showCompleted ? completedGroups : []),
        ].filter((group) => !categoryFilter || catOf(group) === categoryFilter).map((group) => (
          <ProjectCard
            key={group.key}
            group={group}
            colorClass={PROJECT_COLORS[projectColorMap[group.project_name] ?? 0]}
            expanded={expandedGroups.has(group.key)}
            isSelected={selectedGroupKey === group.key}
            compact={compactCards}
            products={products}
            canEditSettings={canEditSettings}
            isOwner={isOwner}
            onToggleSelect={toggleSelectGroup}
            onToggleExpand={toggleGroup}
            onTakeAway={setTakingProduct}
            onEdit={openProjectEdit}
            onDelete={handleProjectDelete}
          />
        ))}
        {completedGroups.length > 0 && (
          <button
            onClick={() => setShowCompleted(v => !v)}
            className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl bg-gray-100 text-sm text-gray-500 hover:bg-gray-200 transition-colors ${browsing ? 'col-span-full' : ''}`}
          >
            <span>已完成项目（{completedGroups.length}）</span>
            <span>{showCompleted ? '▴ 收起' : '▾ 展开'}</span>
          </button>
        )}
        {memberProjects.length === 0 && (
          <div className={`text-center text-gray-400 py-8 ${browsing ? 'col-span-full' : ''}`}>暂无项目记录</div>
        )}
      </div>

      {/* 右栏：核销记录 */}
      {twoCol && (
        <CheckoutRecordPanel
          group={selectedGroup}
          records={selectedRecords}
          staffNameMap={staffNameMap}
          onClose={() => setSelectedGroupKey(null)}
        />
      )}
      </div>

      {/* 历史积分信息弹窗 */}
      {showPointsHistory && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-800 text-lg">历史积分信息</h3>
              <button onClick={() => setShowPointsHistory(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="space-y-2">
              {pointsRecords.length === 0 ? (
                <div className="text-center text-gray-400 py-8">暂无积分记录</div>
              ) : pointsRecords.map((r) => (
                <div key={r._id} className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-700">{r.note}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {new Date(r.created_at).toLocaleDateString()} {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className={`text-base font-semibold ${r.points > 0 ? 'text-amber-500' : 'text-gray-500'}`}>
                    {r.points > 0 ? '+' : ''}{r.points} 分
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setShowPointsHistory(false)} className="mt-4 w-full py-2 bg-pink-500 text-white rounded-lg text-sm">确认</button>
          </div>
        </div>
      )}

      {/* 历史余额信息弹窗 */}
      {showBalanceHistory && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-800 text-lg">历史余额信息</h3>
              <button onClick={() => setShowBalanceHistory(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="space-y-2">
              {balanceRecords.length === 0 ? (
                <div className="text-center text-gray-400 py-8">暂无余额记录</div>
              ) : balanceRecords.map((r) => (
                <div key={r._id} className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-700">{r.note}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {new Date(r.created_at).toLocaleDateString()} {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                  <div className={`text-base font-semibold ${r.amount > 0 ? 'text-teal-500' : 'text-gray-500'}`}>
                    {r.amount > 0 ? '+' : ''}¥{Math.abs(r.amount).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
            <button onClick={() => setShowBalanceHistory(false)} className="mt-4 w-full py-2 bg-pink-500 text-white rounded-lg text-sm">确认</button>
          </div>
        </div>
      )}

      {/* 拿走确认弹窗 */}
      {takingProduct && (
        <TakeAwayModal
          productName={takingProduct.productName}
          onCancel={() => setTakingProduct(null)}
          onConfirm={handleTakeAway}
        />
      )}

      {/* 编辑项目弹窗 */}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          productName={editingProject.product_id ? products.find((p) => p._id === editingProject.product_id)?.name : ''}
          form={projectEditForm}
          setForm={setProjectEditForm}
          onCancel={() => setEditingProject(null)}
          onSave={handleProjectSave}
        />
      )}

      {/* 添加历史项目弹窗 */}
      {showAddProject && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5">
            <h3 className="font-bold text-gray-800 text-lg mb-4">添加历史项目</h3>

            <div className="space-y-3">
              {/* 项目 */}
              <div>
                <label className="text-sm text-gray-500 mb-1 block">项目 *</label>
                <select
                  value={histForm.project_id}
                  onChange={(e) => handleProjectSelect(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">请选择项目</option>
                  {projects.map((p) => (
                    <option key={p._id} value={p._id}>{p.name}</option>
                  ))}
                </select>
              </div>

              {/* 项目参数只读展示 */}
              {selectedProject && (
                <div className="flex gap-4 px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-500">
                  <span>规定次数：<strong className="text-gray-700">{selectedProject.total_sessions}</strong></span>
                  <span>最多手工：<strong className="text-gray-700">{selectedProject.max_sessions}</strong></span>
                </div>
              )}

              {/* 实付金额 */}
              <div>
                <label className="text-sm text-gray-500 mb-1 block">实付金额（元）*</label>
                <input
                  type="number"
                  min="0"
                  value={histForm.paid_amount}
                  onChange={(e) => setHistForm({ ...histForm, paid_amount: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="客户实际付款金额"
                />
              </div>

              {/* 项目已做次数 */}
              {histForm.project_id && (
                <div>
                  <label className="text-sm text-gray-500 mb-1 block">项目已做次数 *</label>
                  <input
                    type="number"
                    min="0"
                    value={histForm.project_sessions}
                    onChange={(e) => handleProjectSessionsChange(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    placeholder="自动填入各商品已做次数"
                  />
                </div>
              )}

              {/* 各商品已做次数 */}
              {histForm.project_id && (
                <div>
                  <label className="text-sm text-gray-500 mb-2 block">各商品已做次数 *</label>
                  <div className="space-y-2">
                    {Object.keys(histForm.productSessions).map((productId) => {
                      const prod = productId ? products.find((p) => p._id === productId) : null
                      const used = histForm.productSessions[productId] ?? ''
                      const total = selectedProject?.total_sessions ?? 0
                      const remaining = used !== '' ? Math.max(0, total - Number(used)) : null
                      const overUsed = used !== '' && Number(used) > total
                      const isTemplateProduct = templateProductIds.includes(productId)
                      return (
                        <div key={productId || '__none__'} className="flex items-center gap-2 p-2 border border-gray-200 rounded-lg">
                          <div className="flex-1 min-w-0">
                            {prod ? (
                              <>
                                <div className="text-sm font-medium text-gray-700 truncate">
                                  {prod.name}
                                  {!isTemplateProduct && <span className="ml-1 text-xs text-orange-500">新增</span>}
                                </div>
                                {prod.spec && <div className="text-xs text-gray-400">{prod.spec}</div>}
                              </>
                            ) : (
                              <div className="text-sm text-gray-400">无关联商品</div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <input
                              type="number"
                              min="0"
                              value={used}
                              onChange={(e) => setProductSession(productId, e.target.value)}
                              className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-center"
                              placeholder="0"
                            />
                            {remaining !== null && (
                              <span className={`text-xs w-14 text-right ${overUsed ? 'text-red-500' : 'text-gray-400'}`}>
                                剩余 {remaining}
                              </span>
                            )}
                            {prod && (
                              <button
                                type="button"
                                onClick={() => removeProduct(productId)}
                                className="text-gray-300 hover:text-red-400 text-base leading-none"
                              >✕</button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* 新增商品搜索 */}
                  <div className="mt-2">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="搜索商品名称或条形码"
                        value={productSearch}
                        onChange={(e) => { setProductSearch(e.target.value); if (!e.target.value) setProductSearchResults(null) }}
                        onKeyDown={(e) => e.key === 'Enter' && handleProductSearch()}
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                      />
                      <button type="button" onClick={handleProductSearch}
                        className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-sm">
                        搜索
                      </button>
                    </div>
                    {productSearchResults !== null && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {productSearchResults.length === 0
                          ? <span className="text-xs text-gray-400">没有匹配的商品</span>
                          : productSearchResults.map((p) => (
                            <button key={p._id} type="button" onClick={() => addProduct(p._id)}
                              className="px-2.5 py-1 bg-white border border-gray-300 rounded-full text-xs text-gray-600 hover:border-pink-400 hover:text-pink-600">
                              + {p.name}{p.spec ? `（${p.spec}）` : ''}
                            </button>
                          ))
                        }
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 购买日期 */}
              <div>
                <label className="text-sm text-gray-500 mb-1 block">购买日期 *</label>
                <input
                  type="date"
                  value={histForm.purchased_at}
                  onChange={(e) => setHistForm({ ...histForm, purchased_at: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>

              {/* 备注 */}
              <div>
                <label className="text-sm text-gray-500 mb-1 block">
                  备注{productsDiffer && <span className="text-red-500 ml-1">*（商品与模板不一致，必填）</span>}
                </label>
                <textarea
                  value={histForm.notes}
                  onChange={(e) => setHistForm({ ...histForm, notes: e.target.value })}
                  className={`w-full border rounded-lg px-3 py-2 text-sm resize-none ${productsDiffer && !histForm.notes.trim() ? 'border-red-300' : 'border-gray-300'}`}
                  rows={2}
                  placeholder={productsDiffer ? '请说明商品变化原因' : '选填'}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setShowAddProject(false); setHistForm(EMPTY_HIST) }}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm"
              >
                取消
              </button>
              <button
                onClick={handleHistSave}
                disabled={saving}
                className="flex-1 py-2 bg-pink-500 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {saving ? '保存中...' : '确认录入'}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateMember && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-lg mb-2">手机号冲突</h3>
            <p className="text-sm text-gray-600 mb-1">
              {duplicateMember.reason === 'both'
                ? '姓名与手机号均与其他会员相同，无法保存。'
                : '该手机号已被其他会员使用，无法保存。'}
            </p>
            <p className="text-sm text-gray-800 mb-5">
              已有会员：<span className="font-medium">{duplicateMember.member.name}</span>
              {duplicateMember.member.phone ? `（${duplicateMember.member.phone}）` : ''}
            </p>
            <button
              type="button"
              onClick={() => setDuplicateMember(null)}
              className="w-full py-2 bg-pink-500 text-white rounded-lg text-sm"
            >
              知道了
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
