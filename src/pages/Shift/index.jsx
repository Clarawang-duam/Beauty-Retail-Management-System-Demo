import { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { db, _ } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import useAuthStore from '../../store/authStore'
import useCacheStore from '../../store/cacheStore'
import { usePermission } from '../../hooks/usePermission'

const SHIFT_LABELS = { morning: '早', evening: '晚', off: '休' }
const SHIFT_COLORS = {
  morning: 'bg-green-100 text-green-700',
  evening: 'bg-blue-100 text-blue-700',
  off: 'bg-gray-100 text-gray-500',
}
const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日']

function cycleShift(current) {
  if (!current) return 'morning'
  if (current === 'morning') return 'evening'
  if (current === 'evening') return 'off'
  return null
}

function getRotationShift(date, rotation) {
  if (!rotation?.start_date || !rotation?.cycle_days || !rotation?.pattern?.length) return null
  const diff = dayjs(date).diff(dayjs(rotation.start_date), 'day')
  if (diff < 0) return null
  return rotation.pattern[diff % rotation.cycle_days] || null
}

function ShiftBadge({ shift }) {
  if (!shift) return <span className="text-[10px] text-gray-200">—</span>
  return (
    <span className={`text-[10px] rounded px-1 leading-snug ${SHIFT_COLORS[shift]}`}>
      {SHIFT_LABELS[shift]}
    </span>
  )
}

function RotationPanel({ activeStaff, rotationMap, pendingRotations, onStage }) {
  const [staffId, setStaffId] = useState(activeStaff[0]?._id || '')
  const [startDate, setStartDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [cycleDays, setCycleDays] = useState(3)
  const [pattern, setPattern] = useState(['morning', 'evening', 'off'])

  useEffect(() => {
    const pending = pendingRotations.get(staffId)
    const existing = pending || rotationMap[staffId]
    if (existing) {
      setStartDate(existing.start_date)
      setCycleDays(existing.cycle_days)
      setPattern([...(existing.pattern || [])])
    } else {
      setStartDate(dayjs().format('YYYY-MM-DD'))
      setCycleDays(3)
      setPattern(['morning', 'evening', 'off'])
    }
  }, [staffId])

  const handleCycleDaysChange = (n) => {
    const clamped = Math.max(1, Math.min(30, n))
    setCycleDays(clamped)
    setPattern(prev => {
      const next = Array(clamped).fill(null)
      for (let i = 0; i < Math.min(prev.length, clamped); i++) next[i] = prev[i]
      return next
    })
  }

  const isPending = pendingRotations.has(staffId)

  return (
    <div className="bg-white rounded-xl shadow-sm mt-2 p-4 space-y-4">
      <div>
        <label className="block text-xs text-gray-400 mb-1">员工</label>
        <select
          value={staffId}
          onChange={e => setStaffId(e.target.value)}
          className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        >
          {activeStaff.map(s => (
            <option key={s._id} value={s._id}>
              {s.name}{pendingRotations.has(s._id) ? ' *' : ''}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">起始日期</label>
        <input
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">周期天数</label>
        <input
          type="number"
          min="1"
          max="30"
          value={cycleDays}
          onChange={e => {
            const v = e.target.value
            if (v === '') { setCycleDays(''); return }   // 允许编辑时为空
            const n = parseInt(v)
            if (!isNaN(n)) handleCycleDaysChange(n)
          }}
          onBlur={() => { if (cycleDays === '' || isNaN(Number(cycleDays))) setCycleDays(pattern.length || 1) }}
          className="w-20 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-2">
          排班规律（循环：第1天 → 第{cycleDays}天）
        </label>
        <div className="flex flex-wrap gap-2">
          {pattern.map((p, idx) => (
            <div key={idx} className="flex flex-col items-center gap-1">
              <span className="text-[10px] text-gray-400">第{idx + 1}天</span>
              <select
                value={p || ''}
                onChange={e => {
                  const next = [...pattern]
                  next[idx] = e.target.value || null
                  setPattern(next)
                }}
                className="border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none"
              >
                <option value="">未排</option>
                <option value="morning">早班</option>
                <option value="evening">晚班</option>
                <option value="off">休息</option>
              </select>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => onStage({ staff_id: staffId, start_date: startDate, cycle_days: cycleDays, pattern })}
        className="w-full py-2.5 bg-purple-500 hover:bg-purple-600 text-white rounded-xl text-sm font-medium transition-colors"
      >
        {isPending ? '已暂存（点右上角保存生效）' : '应用轮班设置'}
      </button>
    </div>
  )
}

export default function ShiftPage() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)
  const { isOwner } = usePermission()
  const { staff: allStaff } = useCacheStore()

  const canEdit = isOwner || user?.level === '高级'
  const activeStaff = useMemo(
    () => (allStaff || []).filter(s => s.status !== '离职' && (isOwner || s.role !== 'owner')),
    [isOwner, allStaff]
  )

  const [currentMonth, setCurrentMonth] = useState(() => dayjs().startOf('month'))
  const [selectedStaffId, setSelectedStaffId] = useState(null)
  const [schedules, setSchedules] = useState([])
  const [rotations, setRotations] = useState([])
  const [saving, setSaving] = useState(false)
  const [showRotationPanel, setShowRotationPanel] = useState(false)

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)
  // key: `${staffId}::${date}`, value: { staffId, dateStr, shift } (shift=null means delete)
  const [pendingSchedules, setPendingSchedules] = useState(new Map())
  // key: staffId, value: rotation form
  const [pendingRotations, setPendingRotations] = useState(new Map())

  useEffect(() => {
    loadData()
  }, [currentMonth])

  const loadData = async () => {
    const startDate = currentMonth.format('YYYY-MM-DD')
    const endDate = currentMonth.endOf('month').format('YYYY-MM-DD')
    const empty = { data: [] }
    const [schRes, rotRes] = await Promise.all([
      db.collection(COLLECTIONS.SHIFT_SCHEDULES)
        .where({ date: _.gte(startDate).and(_.lte(endDate)) })
        .limit(300)
        .get()
        .catch(() => empty),
      db.collection(COLLECTIONS.SHIFT_ROTATIONS).limit(50).get()
        .catch(() => empty),
    ])
    setSchedules(schRes.data || [])
    setRotations(rotRes.data || [])
  }

  const shiftMap = useMemo(() => {
    const map = {}
    for (const s of schedules) map[`${s.staff_id}::${s.date}`] = s.shift
    return map
  }, [schedules])

  const rotationMap = useMemo(() => {
    const map = {}
    for (const r of rotations) map[r.staff_id] = r
    return map
  }, [rotations])

  const getShift = useCallback((staffId, date) => {
    const key = `${staffId}::${date}`
    if (isEditing && pendingSchedules.has(key)) {
      const { shift } = pendingSchedules.get(key)
      return shift !== null ? shift : getRotationShift(date, rotationMap[staffId])
    }
    if (key in shiftMap) return shiftMap[key]
    return getRotationShift(date, rotationMap[staffId])
  }, [isEditing, pendingSchedules, shiftMap, rotationMap])

  const handleCellClick = (staffId, dateStr) => {
    if (!canEdit || !isEditing) return
    const current = getShift(staffId, dateStr)
    const nextShift = cycleShift(current)
    const key = `${staffId}::${dateStr}`
    setPendingSchedules(prev => {
      const updated = new Map(prev)
      const hasExisting = schedules.some(s => s.staff_id === staffId && s.date === dateStr)
      if (nextShift === null && !hasExisting) {
        updated.delete(key)
      } else {
        updated.set(key, { staffId, dateStr, shift: nextShift })
      }
      return updated
    })
  }

  const enterEdit = () => {
    setPendingSchedules(new Map())
    setPendingRotations(new Map())
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setPendingSchedules(new Map())
    setPendingRotations(new Map())
    setIsEditing(false)
    setShowRotationPanel(false)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      for (const { staffId, dateStr, shift } of pendingSchedules.values()) {
        const existing = schedules.find(s => s.staff_id === staffId && s.date === dateStr)
        if (shift === null) {
          if (existing) await db.collection(COLLECTIONS.SHIFT_SCHEDULES).doc(existing._id).remove()
        } else if (existing) {
          await db.collection(COLLECTIONS.SHIFT_SCHEDULES).doc(existing._id).update({ shift })
        } else {
          await db.collection(COLLECTIONS.SHIFT_SCHEDULES).add({
            staff_id: staffId, date: dateStr, shift,
            created_by: user.uid, created_at: new Date(),
          })
        }
      }
      for (const [staffId, form] of pendingRotations.entries()) {
        const existing = rotations.find(r => r.staff_id === staffId)
        if (existing) {
          await db.collection(COLLECTIONS.SHIFT_ROTATIONS).doc(existing._id).update({
            start_date: form.start_date, cycle_days: form.cycle_days, pattern: form.pattern,
          })
        } else {
          await db.collection(COLLECTIONS.SHIFT_ROTATIONS).add({
            ...form, created_by: user.uid, created_at: new Date(),
          })
        }
      }
      await loadData()
      setIsEditing(false)
      setPendingSchedules(new Map())
      setPendingRotations(new Map())
      setShowRotationPanel(false)
    } catch (err) {
      alert('保存失败：' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const calendarDays = useMemo(() => {
    const startOffset = (currentMonth.day() + 6) % 7
    const daysInMonth = currentMonth.daysInMonth()
    const days = []
    for (let i = 0; i < startOffset; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) days.push(currentMonth.date(d))
    while (days.length % 7 !== 0) days.push(null)
    return days
  }, [currentMonth])

  const displayStaff = useMemo(
    () => selectedStaffId ? activeStaff.filter(s => s._id === selectedStaffId) : activeStaff,
    [selectedStaffId, activeStaff]
  )

  const today = dayjs().format('YYYY-MM-DD')
  const cellMinH = selectedStaffId ? 60 : Math.max(60, displayStaff.length * 22 + 18)
  const pendingCount = pendingSchedules.size + pendingRotations.size

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => navigate('/settings')} className="text-gray-500">← 返回</button>
        <h1 className="text-lg font-bold text-gray-800">排班管理</h1>
        <div className="ml-auto flex items-center gap-2">
          {saving ? (
            <span className="text-xs text-gray-400">保存中...</span>
          ) : isEditing ? (
            <>
              {pendingCount > 0 && (
                <span className="text-xs text-orange-500">{pendingCount} 处改动</span>
              )}
              <button
                onClick={cancelEdit}
                className="px-3 py-1 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-3 py-1 text-sm bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors"
              >
                保存
              </button>
            </>
          ) : canEdit ? (
            <button
              onClick={enterEdit}
              className="px-3 py-1 text-sm bg-purple-500 hover:bg-purple-600 text-white rounded-lg transition-colors"
            >
              排班
            </button>
          ) : null}
        </div>
      </div>

      {/* Staff tabs */}
      <div className="bg-white border-b px-4 py-2 flex gap-2 overflow-x-auto">
        {[{ _id: null, name: '全员' }, ...activeStaff].map(s => (
          <button
            key={s._id ?? 'all'}
            onClick={() => setSelectedStaffId(s._id)}
            className={`px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              selectedStaffId === s._id
                ? 'bg-purple-100 text-purple-700'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
          >
            {s.name}
          </button>
        ))}
      </div>

      <div className="p-4 max-w-2xl mx-auto">
        {/* Month navigator */}
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setCurrentMonth(m => m.subtract(1, 'month'))}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-200 text-xl text-gray-500"
          >
            ‹
          </button>
          <span className="font-semibold text-gray-800">{currentMonth.format('YYYY年MM月')}</span>
          <button
            onClick={() => setCurrentMonth(m => m.add(1, 'month'))}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-gray-200 text-xl text-gray-500"
          >
            ›
          </button>
        </div>

        {/* Calendar */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="grid grid-cols-7 bg-gray-50 border-b">
            {WEEK_DAYS.map(d => (
              <div key={d} className="text-center py-2 text-xs font-medium text-gray-400">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarDays.map((day, idx) => {
              const dateStr = day?.format('YYYY-MM-DD')
              const isToday = dateStr === today
              return (
                <div
                  key={idx}
                  className={`border-b border-r border-gray-100 p-1 ${
                    !day ? 'bg-gray-50' : isToday ? 'bg-blue-50' : ''
                  }`}
                  style={{ minHeight: cellMinH }}
                >
                  {day && (
                    <>
                      <div className={`text-xs mb-0.5 leading-none ${isToday ? 'text-blue-600 font-bold' : 'text-gray-400'}`}>
                        {day.date()}
                      </div>
                      <div className="space-y-0.5">
                        {displayStaff.map(s => {
                          const key = `${s._id}::${dateStr}`
                          const hasPending = isEditing && pendingSchedules.has(key)
                          return (
                            <div
                              key={s._id}
                              onClick={() => handleCellClick(s._id, dateStr)}
                              className={`flex items-center gap-0.5 rounded px-0.5 ${
                                isEditing && canEdit
                                  ? 'cursor-pointer hover:bg-gray-100 active:opacity-60'
                                  : 'cursor-default'
                              } ${hasPending ? 'ring-1 ring-orange-300 rounded' : ''}`}
                            >
                              {!selectedStaffId && (
                                <span className="text-[9px] text-gray-400 w-5 shrink-0 truncate leading-tight">
                                  {s.name.slice(0, 2)}
                                </span>
                              )}
                              <ShiftBadge shift={getShift(s._id, dateStr)} />
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-gray-500">
          {[['morning', '早班'], ['evening', '晚班'], ['off', '休息']].map(([k, label]) => (
            <span key={k} className="flex items-center gap-1">
              <span className={`px-1.5 py-0.5 rounded text-[10px] ${SHIFT_COLORS[k]}`}>{SHIFT_LABELS[k]}</span>
              {label}
            </span>
          ))}
          {isEditing && canEdit && <span className="ml-auto text-orange-400">编辑中 · 点格子切换</span>}
        </div>

        {/* Rotation panel — only shown in edit mode */}
        {isEditing && canEdit && (
          <div className="mt-5 mb-8">
            <button
              onClick={() => setShowRotationPanel(v => !v)}
              className="w-full bg-white rounded-xl shadow-sm px-4 py-3 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span>轮班周期设置{pendingRotations.size > 0 ? ` · ${pendingRotations.size} 人待保存` : ''}</span>
              <span className="text-gray-400 text-xs">{showRotationPanel ? '收起 ▲' : '展开 ▼'}</span>
            </button>

            {showRotationPanel && activeStaff.length > 0 && (
              <RotationPanel
                activeStaff={activeStaff}
                rotationMap={rotationMap}
                pendingRotations={pendingRotations}
                onStage={(form) => {
                  setPendingRotations(prev => new Map(prev).set(form.staff_id, form))
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
