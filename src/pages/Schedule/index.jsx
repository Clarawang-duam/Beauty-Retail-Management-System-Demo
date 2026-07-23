import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { db } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import useCacheStore from '../../store/cacheStore'
import useAuthStore from '../../store/authStore'
import { useOperator } from '../../hooks/useOperator'
import AttendanceCalendar from '../../components/AttendanceCalendar'
import EarningsPanel from '../../components/EarningsPanel'
import MemberDetail from '../Settings/MemberManagement/MemberDetail'
import { computeTxnAggregates, getMemberTags, TAG_STYLES, ALL_TAGS } from '../../utils/memberTags'

export default function SchedulePage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { getSetting, staff, activeStaff, members, products, refreshCache } = useCacheStore()
  const { operatorId, operatorLevel } = useOperator()
  const isOwner = user?.role === 'owner'

  const [activeTab, setActiveTab] = useState('考勤')
  const [memberPanelTab, setMemberPanelTab] = useState('visits') // visits | spend
  const [earnTxns, setEarnTxns] = useState([])
  const [earnLoading, setEarnLoading] = useState(false)
  const [earnStaffId, setEarnStaffId] = useState(operatorId)
  const [earnPeriod, setEarnPeriod] = useState('current') // current | last
  const [memberTxns, setMemberTxns] = useState([])
  const [memberLoading, setMemberLoading] = useState(false)
  const [selectedKeyMember, setSelectedKeyMember] = useState(null)
  const [keyMemberSearch, setKeyMemberSearch] = useState('')
  const [warningProjects, setWarningProjects] = useState([])
  const [warningPopupMember, setWarningPopupMember] = useState(null)
  const [dismissSet, setDismissSet] = useState(new Set())
  const [dismissSaving, setDismissSaving] = useState(false)
  const [checkout3mTxns, setCheckout3mTxns] = useState([])
  const [purchaseAllTxns, setPurchaseAllTxns] = useState([])
  const [tagFilter, setTagFilter] = useState(null)

  const canSeeAll = isOwner || user?.level === '高级'
  const staffToShow = canSeeAll
    ? activeStaff().filter((s) => s.role !== 'owner')
    : activeStaff().filter((s) => s._id === operatorId)

  const attendanceStaff = useMemo(
    () => canSeeAll
      ? activeStaff().filter(s => s.role !== 'owner')
      : activeStaff().filter(s => s._id === operatorId),
    [canSeeAll, operatorId]
  )

  // 共用模式切换操作人时，重置收益查看对象
  useEffect(() => {
    setEarnStaffId(operatorId)
  }, [operatorId])

  const earnBase = earnPeriod === 'last' ? dayjs().subtract(1, 'month') : dayjs()
  const earnDimLabel = earnPeriod === 'last' ? `${earnBase.month() + 1}月` : '本月'

  useEffect(() => {
    if (activeTab !== '收益' || !earnStaffId) return
    if (members.length === 0) refreshCache('members')
    setEarnLoading(true)
    const monthStart = earnBase.startOf('month').toDate()
    const monthEnd = earnBase.endOf('month').toDate()
    db.collection(COLLECTIONS.TRANSACTIONS)
      .where({ therapist_id: earnStaffId, operated_at: db.command.gte(monthStart).and(db.command.lte(monthEnd)) })
      .limit(1000)
      .get()
      .then((res) => setEarnTxns(res.data))
      .catch(console.error)
      .finally(() => setEarnLoading(false))
  }, [activeTab, earnStaffId, earnPeriod])

  useEffect(() => {
    if (activeTab !== '会员') return
    if (members.length === 0) refreshCache('members')
    setMemberLoading(true)
    const monthStart = dayjs().startOf('month').toDate()
    const monthEnd = dayjs().endOf('month').toDate()
    db.collection(COLLECTIONS.TRANSACTIONS)
      .where({ operated_at: db.command.gte(monthStart).and(db.command.lte(monthEnd)) })
      .limit(1000)
      .get()
      .then((res) => setMemberTxns(res.data))
      .catch(console.error)
      .finally(() => setMemberLoading(false))
    db.collection(COLLECTIONS.MEMBER_PROJECTS)
      .where({ remaining_sessions: db.command.gte(0).and(db.command.lte(2)) })
      .limit(1000)
      .get()
      .then((res) => setWarningProjects(
        res.data.filter(mp => mp.status !== 'refunded' && !mp.warning_dismissed)
      ))
      .catch(console.error)
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    db.collection(COLLECTIONS.TRANSACTIONS)
      .where({ type: 'checkout', operated_at: db.command.gte(threeMonthsAgo) })
      .limit(2000).get()
      .then(res => setCheckout3mTxns(res.data))
      .catch(console.error)
    // 近 1 年 purchase+refund：供大客户口径 + 年度消费排名（与会员库口径一致）
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    db.collection(COLLECTIONS.TRANSACTIONS)
      .where({ type: db.command.in(['purchase', 'refund']), operated_at: db.command.gte(oneYearAgo) })
      .limit(5000).get()
      .then(res => setPurchaseAllTxns(res.data))
      .catch(console.error)
  }, [activeTab])

  // 年度会员消费排名（净额：purchase 正 + refund/促销负，求和），前 50
  const spendRank = useMemo(() => {
    const map = {}
    for (const t of purchaseAllTxns) {
      if (!t.member_id) continue
      if (t.type !== 'purchase' && t.type !== 'refund') continue
      map[t.member_id] = (map[t.member_id] || 0) + (t.product_price || 0)
    }
    return Object.entries(map)
      .map(([member_id, amount]) => ({ member_id, amount }))
      .filter((x) => x.amount > 0)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 50)
  }, [purchaseAllTxns])

  const lastTxnDateByMember = useMemo(() => {
    const map = {}
    memberTxns.forEach((t) => {
      if (!t.member_id) return
      const ts = new Date(t.operated_at).getTime()
      if (!map[t.member_id] || ts > map[t.member_id]) map[t.member_id] = ts
    })
    return map
  }, [memberTxns])

  const txnAggregates = useMemo(
    () => computeTxnAggregates(checkout3mTxns, purchaseAllTxns),
    [checkout3mTxns, purchaseAllTxns]
  )

  const warningProjectsByMember = useMemo(() => {
    const map = {}
    warningProjects.forEach(mp => {
      if (!map[mp.member_id]) map[mp.member_id] = []
      map[mp.member_id].push(mp)
    })
    return map
  }, [warningProjects])

  const keyMembers = useMemo(() => {
    const q = keyMemberSearch.trim()
    return members
      .filter((m) => {
        if (!m.is_key) return false
        if (!q) return true
        return m.name?.includes(q) || m.phone?.includes(q)
      })
      .map((m) => ({
        ...m,
        _resolvedLastVisit: lastTxnDateByMember[m._id]
          ? new Date(lastTxnDateByMember[m._id]).toISOString()
          : m.last_visit_at,
        _tags: getMemberTags(m, txnAggregates, getSetting),
      }))
      .filter(m => !tagFilter || m._tags.includes(tagFilter))
      .sort((a, b) => {
        const aWarn = (warningProjectsByMember[a._id]?.length || 0) > 0
        const bWarn = (warningProjectsByMember[b._id]?.length || 0) > 0
        if (aWarn !== bWarn) return aWarn ? -1 : 1
        if (!a._resolvedLastVisit && !b._resolvedLastVisit) return 0
        if (!a._resolvedLastVisit) return -1
        if (!b._resolvedLastVisit) return 1
        return new Date(a._resolvedLastVisit) - new Date(b._resolvedLastVisit)
      })
  }, [members, keyMemberSearch, lastTxnDateByMember, warningProjectsByMember, txnAggregates, tagFilter])

  const monthlyVisits = useMemo(() => {
    const datesByMember = {}
    memberTxns.forEach((t) => {
      if (!t.member_id) return
      const dateStr = dayjs(t.operated_at).format('YYYY-MM-DD')
      if (!datesByMember[t.member_id]) datesByMember[t.member_id] = new Set()
      datesByMember[t.member_id].add(dateStr)
    })
    return Object.entries(datesByMember)
      .map(([member_id, dates]) => ({ member_id, count: dates.size }))
      .sort((a, b) => b.count - a.count)
  }, [memberTxns])

  const handleDismissConfirm = async () => {
    if (dismissSet.size === 0) { setWarningPopupMember(null); return }
    setDismissSaving(true)
    try {
      await Promise.all([...dismissSet].map(id =>
        db.collection(COLLECTIONS.MEMBER_PROJECTS).doc(id).update({ warning_dismissed: true })
      ))
      setWarningProjects(prev => prev.filter(mp => !dismissSet.has(mp._id)))
    } catch (e) {
      console.error(e)
    } finally {
      setDismissSaving(false)
      setWarningPopupMember(null)
      setDismissSet(new Set())
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => navigate('/')} className="text-gray-500">← 返回</button>
        <div className="flex gap-1">
          {['考勤', '收益', '会员'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
                activeTab === tab ? 'bg-[#40C8B8] text-white' : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 max-w-6xl mx-auto">
        {activeTab === '收益' ? (
          <>
            <div className="flex items-center justify-between gap-3 mb-4">
              {canSeeAll ? (
                <div className="flex gap-2 flex-wrap min-w-0">
                  {staffToShow.map((s) => (
                    <button
                      key={s._id}
                      onClick={() => setEarnStaffId(s._id)}
                      className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                        earnStaffId === s._id
                          ? 'bg-green-500 text-white border-green-500'
                          : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div />
              )}
              <div className="flex gap-2 shrink-0">
                {[{ key: 'current', label: '本月' }, { key: 'last', label: '上月' }].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setEarnPeriod(p.key)}
                    className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                      earnPeriod === p.key
                        ? 'bg-[#40C8B8] text-white border-[#40C8B8]'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <EarningsPanel
              txns={earnTxns}
              loading={earnLoading}
              staffLevel={staff.find((s) => s._id === earnStaffId)?.level || operatorLevel || '初级'}
              getSetting={getSetting}
              members={members}
              dimLabel={earnDimLabel}
              showLastMonthSalary
              staffId={earnStaffId}
            />
          </>
        ) : activeTab === '会员' ? (
          <>
            {selectedKeyMember && (
              <div className="fixed inset-0 bg-white z-50 overflow-y-auto">
                <MemberDetail
                  member={selectedKeyMember}
                  onBack={() => setSelectedKeyMember(null)}
                  onUpdated={() => {
                    setSelectedKeyMember(null)
                    refreshCache('members')
                  }}
                />
              </div>
            )}
            {memberLoading ? (
              <div className="text-center py-12 text-gray-400 text-sm">加载中...</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-[1fr_288px] gap-4 items-start">
                {/* 左栏：重点会员关怀（双列卡片） */}
                <div className="bg-white rounded-xl p-4 shadow-sm md:max-h-[calc(100vh-96px)] md:overflow-y-auto">
                  <p className="text-xs text-gray-400 mb-2">重点会员关怀（{keyMembers.length} 人）</p>
                  <input
                    type="text"
                    placeholder="搜索姓名或电话"
                    value={keyMemberSearch}
                    onChange={(e) => setKeyMemberSearch(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-2 focus:outline-none focus:border-[#40C8B8]"
                  />
                  <div className="flex gap-1.5 mb-3 flex-wrap">
                    <button onClick={() => setTagFilter(null)}
                      className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${!tagFilter ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200'}`}>
                      全部
                    </button>
                    {ALL_TAGS.map(tag => (
                      <button key={tag} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                        className={`px-2.5 py-0.5 rounded-full text-xs border transition-colors ${tagFilter === tag ? TAG_STYLES[tag] + ' font-medium' : 'bg-white text-gray-500 border-gray-200'}`}>
                        {tag}
                      </button>
                    ))}
                  </div>
                  {keyMembers.length === 0 ? (
                    <p className="text-xs text-gray-400 text-center py-8">
                      {keyMemberSearch ? '未找到匹配会员' : '暂无重点会员'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {keyMembers.map((m) => {
                        const days = m._resolvedLastVisit
                          ? Math.floor((Date.now() - new Date(m._resolvedLastVisit).getTime()) / 86400000)
                          : null
                        const text = days === null ? '暂无到店记录' : days === 0 ? '今日到店' : `${days} 天前到店`
                        const color = days === null || days > 60 ? 'text-red-400' : days > 30 ? 'text-orange-400' : 'text-gray-400'
                        const warnings = warningProjectsByMember[m._id] || []
                        return (
                          <button
                            key={m._id}
                            onClick={() => setSelectedKeyMember(m)}
                            className="text-left p-3 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-gray-800 text-sm truncate">{m.name}</span>
                              <span className="text-amber-400 text-xs ml-1 shrink-0">★</span>
                            </div>
                            <div className={`text-xs ${color}`}>{text}</div>
                            {(warnings.length > 0 || m._tags.length > 0) && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {warnings.length > 0 && (
                                  <span
                                    onClick={(e) => { e.stopPropagation(); setWarningPopupMember(m); setDismissSet(new Set()) }}
                                    className="inline-block text-xs px-2 py-0.5 rounded-full bg-orange-50 text-orange-500 border border-orange-200 hover:bg-orange-100 cursor-pointer"
                                  >
                                    {warnings.length} 项预警
                                  </span>
                                )}
                                {m._tags.map(tag => (
                                  <span key={tag} className={`inline-block text-xs px-2 py-0.5 rounded-full border ${TAG_STYLES[tag]}`}>{tag}</span>
                                ))}
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                {/* 右栏：本月到店 / 年度消费排名 */}
                <div className="bg-white rounded-xl p-4 shadow-sm md:max-h-[calc(100vh-96px)] md:overflow-y-auto">
                  <div className="flex gap-1 mb-3">
                    {[['visits', '会员本月到店'], ['spend', '会员消费排名（年）']].map(([k, label]) => (
                      <button key={k} onClick={() => setMemberPanelTab(k)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                          memberPanelTab === k ? 'bg-[#40C8B8] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}>{label}</button>
                    ))}
                  </div>

                  {memberPanelTab === 'visits' ? (
                    monthlyVisits.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-8">本月暂无到店记录</p>
                    ) : (
                      <div className="space-y-2.5">
                        {monthlyVisits.map(({ member_id, count }, idx) => {
                          const m = members.find((m) => m._id === member_id)
                          return (
                            <div key={member_id} className="flex items-center gap-2">
                              <span className="text-xs text-gray-300 w-5 text-right shrink-0">{idx + 1}</span>
                              <span className="text-sm text-gray-700 flex-1 truncate">{m?.name || '未知'}</span>
                              <span className="text-sm font-semibold text-[#40C8B8] shrink-0">{count} 次</span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  ) : (
                    spendRank.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-8">近 1 年暂无消费记录</p>
                    ) : (
                      <div className="space-y-2.5">
                        {spendRank.map(({ member_id, amount }, idx) => {
                          const m = members.find((m) => m._id === member_id)
                          return (
                            <div key={member_id} className="flex items-center gap-2">
                              <span className={`text-xs w-5 text-right shrink-0 ${idx < 3 ? 'text-[#40C8B8] font-bold' : 'text-gray-300'}`}>{idx + 1}</span>
                              <span className="text-sm text-gray-700 flex-1 truncate">{m?.name || '未知'}</span>
                              {isOwner && <span className="text-sm font-semibold text-[#40C8B8] shrink-0">¥{amount.toFixed(0)}</span>}
                            </div>
                          )
                        })}
                      </div>
                    )
                  )}
                </div>
              </div>
            )}
          </>
        ) : (
          <AttendanceCalendar staffList={attendanceStaff} requestableStaffId={operatorId} />
        )}
      </div>

      {warningPopupMember && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-5 max-h-[85vh] flex flex-col">
            <h3 className="font-bold text-gray-800 text-base mb-4 shrink-0">{warningPopupMember.name} · 预警项目</h3>
            <div className="space-y-3 mb-5 overflow-y-auto flex-1">
              {(warningProjectsByMember[warningPopupMember._id] || []).map(mp => {
                const prodName = products.find(p => p._id === mp.product_id)?.name
                const isDismissed = dismissSet.has(mp._id)
                return (
                  <div key={mp._id} className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-800 truncate">{mp.project_name}</div>
                      {prodName && <div className="text-xs text-gray-400 truncate">{prodName}</div>}
                      <div className={`text-xs mt-0.5 ${mp.remaining_sessions === 0 ? 'text-red-500' : 'text-orange-500'}`}>
                        剩余 {mp.remaining_sessions} 次
                      </div>
                    </div>
                    <button
                      onClick={() => setDismissSet(prev => {
                        const next = new Set(prev)
                        if (next.has(mp._id)) next.delete(mp._id)
                        else next.add(mp._id)
                        return next
                      })}
                      className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
                        isDismissed
                          ? 'bg-gray-100 text-gray-400 border-gray-200'
                          : 'bg-white text-gray-500 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {isDismissed ? '已选不提醒' : '不再提醒'}
                    </button>
                  </div>
                )
              })}
            </div>
            <div className="flex gap-3 shrink-0">
              <button
                onClick={() => { setWarningPopupMember(null); setDismissSet(new Set()) }}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm"
              >
                取消
              </button>
              <button
                onClick={handleDismissConfirm}
                disabled={dismissSaving}
                className="flex-1 py-2 bg-[#40C8B8] text-white rounded-lg text-sm font-medium disabled:opacity-50"
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
