import { useState, useEffect, useRef, useMemo } from 'react'
import { db, _ } from '../../../lib/cloudbase'
import { COLLECTIONS } from '../../../lib/collections'
import { usePermission } from '../../../hooks/usePermission'
import useAuthStore from '../../../store/authStore'
import useCacheStore from '../../../store/cacheStore'
import BatchImport from '../../../components/BatchImport'
import OperationLogPanel from '../../../components/OperationLogPanel'
import { validateMember, MEMBER_HEADERS, MEMBER_KEYS } from '../../../utils/validators'
import { findDuplicateMember } from '../../../utils/memberDuplicate'
import { exportToExcel } from '../../../utils/excelImport'
import { writeLog } from '../../../utils/operationLog'
import { computeTxnAggregates, getMemberTags, TAG_STYLES, ALL_TAGS } from '../../../utils/memberTags'
import MemberDetail from './MemberDetail'

const EMPTY_FORM = {
  name: '', phone: '', points: 0, birthday: '', gender: '', skin_type: '', allergy: '', notes: '',
}

export default function MemberManagement({ onBack }) {
  const { canEditSettings, isOwner } = usePermission()
  const user = useAuthStore((s) => s.user)
  const { getSetting, members, refreshCache } = useCacheStore()
  const memberFields = getSetting('member_fields', {
    birthday: true, gender: true, skin_type: true, allergy: true, notes: true,
  })
  const balanceEnabled = getSetting('balance_enabled', false)

  const [search, setSearch] = useState('')
  const [keyOnly, setKeyOnly] = useState(false)
  const [tab, setTab] = useState('list')
  const [selectedMember, setSelectedMember] = useState(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleteMode, setDeleteMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [logVersion, setLogVersion] = useState(0)
  const [saving, setSaving] = useState(false)
  const [duplicateMember, setDuplicateMember] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [tagFilter, setTagFilter] = useState(null)
  const [checkout3mTxns, setCheckout3mTxns] = useState([])
  const [purchaseAllTxns, setPurchaseAllTxns] = useState([])
  const moreMenuRef = useRef(null)

  useEffect(() => { refreshCache('members') }, [])

  useEffect(() => {
    const threeMonthsAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    db.collection(COLLECTIONS.TRANSACTIONS)
      .where({ type: 'checkout', operated_at: db.command.gte(threeMonthsAgo) })
      .limit(2000).get()
      .then(res => setCheckout3mTxns(res.data))
      .catch(console.error)
    // 大客户累计消费：近 1 年的 purchase + refund（退款负数自然抵减）
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)
    db.collection(COLLECTIONS.TRANSACTIONS)
      .where({ type: db.command.in(['purchase', 'refund']), operated_at: db.command.gte(oneYearAgo) })
      .limit(5000).get()
      .then(res => setPurchaseAllTxns(res.data))
      .catch(console.error)
  }, [])

  const txnAggregates = useMemo(
    () => computeTxnAggregates(checkout3mTxns, purchaseAllTxns),
    [checkout3mTxns, purchaseAllTxns]
  )

  useEffect(() => {
    if (!showMoreMenu) return
    const handleClick = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setShowMoreMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMoreMenu])

  const existingPhones = new Set(members.map((m) => String(m.phone || '').trim()).filter(Boolean))

  const resetAddForm = () => {
    setForm(EMPTY_FORM)
    setShowAddForm(false)
  }

  const openExistingMember = (m) => {
    setDuplicateMember(null)
    resetAddForm()
    const fresh = members.find((x) => x._id === m._id) || m
    setSelectedMember(fresh)
  }

  const handleAddMember = async () => {
    const name = form.name?.trim()
    const phone = form.phone?.trim()
    if (!name || !phone) { alert('姓名和手机号为必填项'); return }

    setSaving(true)
    try {
      let memberList = members
      if (memberList.length === 0) {
        await refreshCache('members')
        memberList = useCacheStore.getState().members
      }
      const dup = findDuplicateMember(name, phone, memberList)
      if (dup) {
        setDuplicateMember(dup)
        return
      }
      const data = { ...form, name, phone, points: Number(form.points) || 0 }
      await db.collection(COLLECTIONS.MEMBERS).add({ ...data, created_at: new Date() })
      await writeLog(user, '会员库', `新增会员「${name}」`)
      await refreshCache('members')
      resetAddForm()
      setLogVersion((v) => v + 1)
    } catch (err) { alert('保存失败：' + err.message) } finally { setSaving(false) }
  }

  const filteredMembers = useMemo(() => members.filter((m) => {
    if (keyOnly && !m.is_key) return false
    if (tagFilter) {
      const tags = getMemberTags(m, txnAggregates, getSetting)
      if (!tags.includes(tagFilter)) return false
    }
    return m.name?.includes(search) || m.phone?.includes(search)
  }), [members, keyOnly, tagFilter, txnAggregates, search])

  const handleDeleteSelected = async () => {
    if (!window.confirm(`确认删除选中的 ${selected.size} 位会员？此操作不可恢复。`)) return
    setSaving(true)
    try {

    const blocked = []
    for (const id of selected) {
      const member = members.find((m) => m._id === id)
      if (!member) continue
      const res = await db.collection(COLLECTIONS.MEMBER_PROJECTS)
        .where({ member_id: id, remaining_sessions: _.gt(0) })
        .limit(1)
        .get()
      if (res.data.length > 0) blocked.push(member.name)
    }

    if (blocked.length > 0) {
      alert(`以下会员仍有未消耗完的项目次数，无法删除：\n${blocked.join('、')}`)
      setSaving(false)
      return
    }

    for (const id of selected) {
      await db.collection(COLLECTIONS.MEMBERS).doc(id).remove()
    }
    await writeLog(user, '会员库', `删除 ${selected.size} 位会员`)
    await refreshCache('members')
    setDeleteMode(false)
    setSelected(new Set())
    setLogVersion((v) => v + 1)
    } catch (err) { alert('删除失败：' + err.message) } finally { setSaving(false) }
  }

  const handleBatchImport = async (rows) => {
    const col = db.collection(COLLECTIONS.MEMBERS)
    const batchAdded = []
    let count = 0
    for (const row of rows) {
      const name = String(row['姓名'] || '').trim()
      const phone = String(row['手机号'] || '').trim()
      if (!name || !phone) continue
      const dup = findDuplicateMember(name, phone, [...members, ...batchAdded])
      if (dup) continue
      await col.add({
        name,
        phone,
        points: Number(row['积分']) || 0,
        birthday: String(row['生日'] || '').trim(),
        gender: String(row['性别'] || '').trim(),
        skin_type: String(row['肤质'] || '').trim(),
        allergy: String(row['过敏史'] || '').trim(),
        notes: String(row['备注'] || '').trim(),
        created_at: new Date(),
      })
      batchAdded.push({ name, phone })
      count++
    }
    await writeLog(user, '会员库', `批量导入 ${count} 位会员`)
    await refreshCache('members')
    setLogVersion((v) => v + 1)
  }

  const handleExport = () => {
    exportToExcel(members, MEMBER_HEADERS, MEMBER_KEYS, '会员库.xlsx')
    writeLog(user, '会员库', '导出会员库')
    setLogVersion((v) => v + 1)
  }

  const handleSelectInactive = async () => {
    setScanning(true)
    try {
      const now = Date.now()
      const cutoff = 365 * 86400000
      const candidates = members.filter((m) => {
        if (!m.last_visit_at) return true
        return now - new Date(m.last_visit_at).getTime() > cutoff
      })
      if (candidates.length === 0) {
        alert('没有超过 365 天未到店的会员')
        return
      }
      const results = await Promise.all(
        candidates.map(async (m) => {
          const res = await db.collection(COLLECTIONS.MEMBER_PROJECTS)
            .where({ member_id: m._id, remaining_sessions: _.gt(0) })
            .limit(1)
            .get()
          return res.data.length === 0 ? m._id : null
        })
      )
      const eligibleIds = results.filter(Boolean)
      if (eligibleIds.length === 0) {
        alert('没有符合条件的沉睡会员（超365天未到店且无剩余项目次数）')
        return
      }
      setSelected(new Set(eligibleIds))
    } catch (err) {
      alert('扫描失败：' + err.message)
    } finally {
      setScanning(false)
    }
  }

  const handleMemberUpdated = () => {
    setLogVersion((v) => v + 1)
  }

  if (selectedMember) {
    return (
      <MemberDetail
        member={selectedMember}
        onBack={() => setSelectedMember(null)}
        onUpdated={handleMemberUpdated}
      />
    )
  }

  return (
    <div className="p-4">
      <div className="flex gap-4 max-w-6xl mx-auto">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="text-gray-500 hover:text-gray-700">← 返回</button>
              <h2 className="text-xl font-bold text-gray-800">会员库</h2>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowAddForm(true)}
                className="px-3 py-1.5 bg-pink-500 text-white rounded text-sm">
                新增
              </button>
              <div className="relative" ref={moreMenuRef}>
                <button
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className={`px-3 py-1.5 rounded text-sm tracking-widest ${showMoreMenu ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-700'} hover:bg-gray-200`}>
                  ⋮
                </button>
                {showMoreMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-20 min-w-[100px]">
                    {isOwner && (
                      <button
                        onClick={() => { setTab(tab === 'import' ? 'list' : 'import'); setShowMoreMenu(false) }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        {tab === 'import' ? '返回列表' : '批量导入'}
                      </button>
                    )}
                    {canEditSettings && (
                      <button
                        onClick={() => { handleExport(); setShowMoreMenu(false) }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        导出
                      </button>
                    )}
                    {isOwner && (
                      <button
                        onClick={() => { setDeleteMode(!deleteMode); setSelected(new Set()); setShowMoreMenu(false) }}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${deleteMode ? 'text-red-600' : 'text-gray-700'}`}>
                        {deleteMode ? '退出删除' : '删除'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {tab === 'import' ? (
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <BatchImport
                headers={MEMBER_HEADERS}
                validate={(row) => validateMember(row, { existingPhones })}
                context={{ existingPhones }}
                onImport={handleBatchImport}
                templateFilename="会员导入模板.xlsx"
              />
            </div>
          ) : (
            <>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  placeholder="搜索姓名或手机号"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                />
                <button
                  onClick={() => setKeyOnly(!keyOnly)}
                  className={`px-3 py-2 rounded-lg text-sm border transition-colors ${keyOnly ? 'bg-amber-400 border-amber-400 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-amber-300'}`}
                >
                  ★ 重点
                </button>
              </div>
              <div className="flex gap-1.5 mb-3 flex-wrap">
                <button
                  onClick={() => setTagFilter(null)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${!tagFilter ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}
                >全部</button>
                {ALL_TAGS.map(tag => (
                  <button key={tag}
                    onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
                    className={`px-3 py-1 rounded-full text-xs border transition-colors ${tagFilter === tag ? TAG_STYLES[tag] + ' font-medium' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}
                  >{tag}</button>
                ))}
              </div>

              {deleteMode && (
                <div className="mb-3 flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 flex-wrap">
                  <div className="flex items-center gap-1.5">
                    <button onClick={handleSelectInactive} disabled={scanning}
                      className="px-3 py-1 bg-orange-100 text-orange-600 border border-orange-200 rounded text-sm disabled:opacity-50">
                      {scanning ? '扫描中...' : '筛选沉睡会员'}
                    </button>
                    <span className="text-xs text-gray-400">超365天未到店且无剩余项目次数</span>
                  </div>
                  {selected.size > 0 && (
                    <>
                      <span className="text-red-600 text-sm">已选 {selected.size} 位</span>
                      <button onClick={handleDeleteSelected} disabled={saving}
                        className="px-3 py-1 bg-red-500 disabled:bg-red-300 text-white rounded text-sm">
                        {saving ? '删除中...' : '确认删除'}
                      </button>
                    </>
                  )}
                </div>
              )}

              <div className="space-y-2">
                {filteredMembers.map((m) => (
                  <div
                    key={m._id}
                    onClick={() => {
                      if (deleteMode) {
                        setSelected(prev => {
                          const s = new Set(prev); s.has(m._id) ? s.delete(m._id) : s.add(m._id); return s
                        })
                      } else {
                        setSelectedMember(m)
                      }
                    }}
                    className={`bg-white rounded-xl px-4 py-3 shadow-sm flex items-center justify-between cursor-pointer hover:shadow-md transition-shadow border-2 ${
                      deleteMode && selected.has(m._id) ? 'border-red-400 bg-red-50' : 'border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {deleteMode && (
                        <input type="checkbox" checked={selected.has(m._id)} readOnly />
                      )}
                      <div>
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="font-semibold text-gray-800">{m.name}</span>
                          {m.is_key && <span className="text-amber-400 ml-1">★</span>}
                          <span className="text-gray-400 text-sm ml-2">{m.phone}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                          <span className="text-xs text-amber-600">积分 {m.points ?? 0}</span>
                          {balanceEnabled && (
                            <span className="text-xs text-teal-600">余额 ¥{(m.balance ?? 0).toFixed(2)}</span>
                          )}
                          {getMemberTags(m, txnAggregates, getSetting).map(tag => (
                            <span key={tag} className={`text-xs px-1.5 py-0.5 rounded border ${TAG_STYLES[tag]}`}>{tag}</span>
                          ))}
                        </div>
                      </div>
                      {m.is_key && (() => {
                        const days = m.last_visit_at
                          ? Math.floor((Date.now() - new Date(m.last_visit_at).getTime()) / 86400000)
                          : null
                        const text = days === null ? '暂无到店记录' : days === 0 ? '今日到店' : `${days} 天前到店`
                        const color = days === null || days > 60 ? 'text-red-400' : days > 30 ? 'text-orange-400' : 'text-gray-400'
                        return <div className={`text-xs mt-0.5 ${color}`}>{text}</div>
                      })()}
                    </div>
                    {!deleteMode && <span className="text-gray-300">›</span>}
                  </div>
                ))}
              </div>

              {filteredMembers.length === 0 && (
                <div className="text-center text-gray-400 py-16">
                  {search ? '未找到匹配会员' : '暂无会员，点击新增或批量导入'}
                </div>
              )}
            </>
          )}
        </div>

        {isOwner && (
          <div className="w-64 shrink-0">
            <OperationLogPanel module="会员库" refreshTrigger={logVersion} />
          </div>
        )}
      </div>

      {showAddForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="font-bold text-lg mb-4">新增会员</h3>
            <div className="space-y-3">
              {[
                { key: 'name', label: '姓名', required: true },
                { key: 'phone', label: '手机号', required: true },
                { key: 'points', label: '积分', type: 'number' },
                ...(memberFields.birthday ? [{ key: 'birthday', label: '生日' }] : []),
                ...(memberFields.gender ? [{ key: 'gender', label: '性别' }] : []),
                ...(memberFields.skin_type ? [{ key: 'skin_type', label: '肤质' }] : []),
                ...(memberFields.allergy ? [{ key: 'allergy', label: '过敏史' }] : []),
                ...(memberFields.notes ? [{ key: 'notes', label: '备注' }] : []),
              ].map(({ key, label, required, type = 'text' }) => (
                <div key={key}>
                  <label className="block text-sm text-gray-600 mb-1">
                    {label}{required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                type="button"
                disabled={saving}
                onClick={resetAddForm}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleAddMember}
                disabled={saving}
                className="flex-1 py-2 bg-pink-500 disabled:bg-pink-300 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? '新增中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateMember && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-lg mb-2">会员已存在</h3>
            <p className="text-sm text-gray-600 mb-1">
              {duplicateMember.reason === 'both'
                ? '姓名与手机号均与已有会员相同，无法重复新增。'
                : '该手机号已被其他会员使用，无法重复新增。'}
            </p>
            <p className="text-sm text-gray-800 mb-5">
              已有会员：<span className="font-medium">{duplicateMember.member.name}</span>
              {duplicateMember.member.phone ? `（${duplicateMember.member.phone}）` : ''}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDuplicateMember(null)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm"
              >
                知道了
              </button>
              <button
                type="button"
                onClick={() => openExistingMember(duplicateMember.member)}
                className="flex-1 py-2 bg-pink-500 text-white rounded-lg text-sm"
              >
                查看该会员
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
