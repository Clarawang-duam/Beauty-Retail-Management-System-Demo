import { useState, useEffect, useMemo } from 'react'
import dayjs from 'dayjs'
import { db, _ } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import { inferAttendance } from '../utils/attendance'
import useCacheStore from '../store/cacheStore'

const STATUS = {
  '正常':   { bg: 'bg-green-500',  text: 'text-white' },
  '漏卡':   { bg: 'bg-amber-400',  text: 'text-white' },
  '缺勤':   { bg: 'bg-red-500',    text: 'text-white' },
  '加班':   { bg: 'bg-violet-500', text: 'text-white' },
  '休息':   { bg: 'bg-slate-300',  text: 'text-slate-600' },
  '迟到':   { bg: 'bg-orange-400', text: 'text-white' },
  '早退':   { bg: 'bg-orange-400', text: 'text-white' },
  '迟到早退': { bg: 'bg-orange-500', text: 'text-white' },
}

function fmtTime(iso) {
  if (!iso) return null
  return dayjs(iso).format('HH:mm')
}
const WEEK_DAYS = ['一', '二', '三', '四', '五', '六', '日']

export default function AttendanceCalendar({ staffList, requestableStaffId }) {
  const { getSetting } = useCacheStore()
  const [currentMonth, setCurrentMonth] = useState(() => dayjs().startOf('month'))
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(false)
  const [pendingSet, setPendingSet] = useState(new Set()) // `${staff_id}::${date}`
  const [modal, setModal] = useState(null) // { dateStr, rec, staffId, staffName }
  const [selectedCard, setSelectedCard] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const staffIdsKey = staffList.map(s => s._id).join(',')
  const earliestMonth = useMemo(() => dayjs().subtract(2, 'month').startOf('month'), [])

  useEffect(() => {
    if (!staffList.length) { setRecords([]); return }
    loadMonthData()
  }, [currentMonth, staffIdsKey])

  useEffect(() => {
    if (!staffList.length) return
    const cutoff = earliestMonth.format('YYYY-MM-DD')
    const staffIds = staffList.map(s => s._id)
    db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
      .where({ staff_id: _.in(staffIds), date: _.lt(cutoff) })
      .limit(200)
      .get()
      .then(res => {
        for (const r of res.data) {
          db.collection(COLLECTIONS.ATTENDANCE_RECORDS).doc(r._id).remove().catch(() => {})
        }
      })
      .catch(() => {})
  }, [staffIdsKey])

  const loadMonthData = async () => {
    setLoading(true)
    const startDate = currentMonth.format('YYYY-MM-DD')
    const endDate = currentMonth.endOf('month').format('YYYY-MM-DD')
    const today = dayjs().format('YYYY-MM-DD')
    const staffIds = staffList.map(s => s._id)
    const empty = { data: [] }

    const [attRes, punchRes, schRes, rotRes, pendingRes] = await Promise.all([
      db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
        .where({ staff_id: _.in(staffIds), date: _.gte(startDate).and(_.lte(endDate)) })
        .limit(500).get().catch(() => empty),
      db.collection(COLLECTIONS.PUNCH_RECORDS)
        .where({ staff_id: _.in(staffIds), date: _.gte(startDate).and(_.lte(endDate)), type: _.in(['上班', '下班']) })
        .limit(1000).get().catch(() => empty),
      db.collection(COLLECTIONS.SHIFT_SCHEDULES)
        .where({ staff_id: _.in(staffIds), date: _.gte(startDate).and(_.lte(endDate)) })
        .limit(500).get().catch(() => empty),
      db.collection(COLLECTIONS.SHIFT_ROTATIONS)
        .where({ staff_id: _.in(staffIds) })
        .limit(50).get().catch(() => empty),
      db.collection(COLLECTIONS.PUNCH_RECORDS)
        .where({ staff_id: _.in(staffIds), date: _.gte(startDate).and(_.lte(endDate)), is_pending: true })
        .limit(200).get().catch(() => empty),
    ])

    const newPendingSet = new Set()
    for (const p of pendingRes.data) {
      if (p.request_status === 'pending') newPendingSet.add(`${p.staff_id}::${p.date}`)
    }
    setPendingSet(newPendingSet)

    const existingMap = {}
    for (const r of attRes.data) existingMap[`${r.staff_id}::${r.date}`] = r

    const punchMap = {}
    for (const p of punchRes.data) {
      if (p.is_pending) continue
      const k = `${p.staff_id}::${p.date}`
      if (!punchMap[k]) punchMap[k] = []
      punchMap[k].push(p)
    }

    const schMap = {}
    for (const s of schRes.data) schMap[`${s.staff_id}::${s.date}`] = s.shift

    const rotMap = {}
    for (const r of rotRes.data) rotMap[r.staff_id] = r

    const writeStart = earliestMonth.format('YYYY-MM-DD')
    for (let d = 1; d <= currentMonth.daysInMonth(); d++) {
      const date = currentMonth.date(d).format('YYYY-MM-DD')
      if (date >= today) continue
      if (date < writeStart) continue

      for (const s of staffList) {
        const key = `${s._id}::${date}`
        if (existingMap[key]) continue

        const punches = (punchMap[key] || []).sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at))
        const clockIn  = punches.find(p => p.type === '上班')?.punched_at || null
        const clockOut = [...punches].reverse().find(p => p.type === '下班')?.punched_at || null

        let scheduledShift = schMap[key] || null
        if (!scheduledShift) {
          const rot = rotMap[s._id]
          if (rot?.start_date && rot?.cycle_days && rot?.pattern?.length) {
            const diff = dayjs(date).diff(dayjs(rot.start_date), 'day')
            if (diff >= 0) scheduledShift = rot.pattern[diff % rot.cycle_days] || null
          }
        }

        const { actual_shift, status } = inferAttendance(clockIn, clockOut, getSetting, scheduledShift)
        const rec = {
          staff_id: s._id, date,
          clock_in: clockIn, clock_out: clockOut,
          planned_shift: scheduledShift, actual_shift, status,
          created_at: new Date(),
        }
        try {
          const doubleCheck = await db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
            .where({ staff_id: s._id, date })
            .limit(1).get()
          if (doubleCheck.data?.length > 0) {
            existingMap[key] = doubleCheck.data[0]
            continue
          }
          const res = await db.collection(COLLECTIONS.ATTENDANCE_RECORDS).add(rec)
          existingMap[key] = { ...rec, _id: res.id }
        } catch {
          // 并发写入冲突时忽略
        }
      }
    }

    setRecords(Object.values(existingMap))
    setLoading(false)
  }

  const recordMap = useMemo(() => {
    const map = {}
    for (const r of records) map[`${r.staff_id}::${r.date}`] = r
    return map
  }, [records])

  const calendarDays = useMemo(() => {
    const startOffset = (currentMonth.day() + 6) % 7
    const daysInMonth = currentMonth.daysInMonth()
    const days = []
    for (let i = 0; i < startOffset; i++) days.push(null)
    for (let d = 1; d <= daysInMonth; d++) days.push(currentMonth.date(d))
    while (days.length % 7 !== 0) days.push(null)
    return days
  }, [currentMonth])

  const today = dayjs().format('YYYY-MM-DD')

  const openModal = (dateStr, rec, staffId) => {
    const staffName = staffList.find(s => s._id === staffId)?.name || ''
    setModal({ dateStr, rec, staffId, staffName })
    setSelectedCard(rec?.status === '漏卡' ? (!rec?.clock_in ? '上班' : '下班') : null)
  }

  const handleSubmitRequest = async () => {
    if (!selectedCard || !modal) return
    setSubmitting(true)
    try {
      const now = new Date()
      const addRes = await db.collection(COLLECTIONS.PUNCH_RECORDS).add({
        staff_id: modal.staffId,
        type: selectedCard,
        is_pending: true,
        request_status: 'pending',
        punched_at: null,
        planned_shift: modal.rec?.planned_shift || null,
        date: modal.dateStr,
        created_at: now,
      })
      await db.collection(COLLECTIONS.NOTIFICATIONS).add({
        type: 'punch_request',
        content: `${modal.staffName} 申请 ${modal.dateStr} 补【${selectedCard}卡】`,
        staff_id: modal.staffId,
        staff_name: modal.staffName,
        date: modal.dateStr,
        card_type: selectedCard,
        punch_record_id: addRes.id,
        planned_shift: modal.rec?.planned_shift || null,
        request_status: 'pending',
        created_at: now,
      })
      setPendingSet(prev => new Set([...prev, `${modal.staffId}::${modal.dateStr}`]))
      setModal(null)
      alert('补卡申请已发送，请等待老板审批')
    } catch (err) {
      alert('发送失败：' + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const morningStart = getSetting('morning_shift_start', '09:00')
  const morningEnd   = getSetting('morning_shift_end',   '13:00')
  const eveningStart = getSetting('evening_shift_start', '14:00')
  const eveningEnd   = getSetting('evening_shift_end',   '20:00')

  return (
    <div className="space-y-4">
      {/* 月份导航 */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentMonth(m => m.subtract(1, 'month'))}
          disabled={currentMonth.isSame(earliestMonth, 'month')}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed text-lg text-gray-500"
        >‹</button>
        <span className="font-semibold text-gray-700">{currentMonth.format('YYYY年MM月')}</span>
        <button
          onClick={() => setCurrentMonth(m => m.add(1, 'month'))}
          className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-lg text-gray-500"
        >›</button>
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(STATUS).map(([label, cfg]) => (
          <span key={label} className={`px-1.5 py-0.5 rounded text-xs font-medium ${cfg.bg} ${cfg.text}`}>
            {label}
          </span>
        ))}
      </div>

      {loading ? (
        <div className="text-center text-gray-400 text-sm py-8">加载中...</div>
      ) : (
        <div className="space-y-3">
          {staffList.map(staff => (
            <div key={staff._id} className="bg-white rounded-xl p-3 shadow-sm">
              <div className="text-sm font-semibold text-gray-700 mb-2">{staff.name}</div>
              <div className="grid grid-cols-7 mb-1">
                {WEEK_DAYS.map(d => (
                  <div key={d} className="text-center text-[10px] text-gray-400">{d}</div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-0.5">
                {calendarDays.map((day, idx) => {
                  if (!day) return <div key={idx} />
                  const dateStr = day.format('YYYY-MM-DD')
                  const isToday = dateStr === today
                  const isFuture = dateStr > today
                  const rec = recordMap[`${staff._id}::${dateStr}`]
                  const cfg = rec ? STATUS[rec.status] : null
                  const clockIn  = rec ? fmtTime(rec.clock_in)  : null
                  const clockOut = rec ? fmtTime(rec.clock_out) : null
                  const showTimes = cfg && rec.status !== '休息' && (clockIn || clockOut)
                  const hasPending = pendingSet.has(`${staff._id}::${dateStr}`)
                  const isOwnBadCell = requestableStaffId
                    && staff._id === requestableStaffId
                    && !isFuture
                    && ['缺勤', '漏卡', '迟到', '早退', '迟到早退'].includes(rec?.status)
                  const clickable = isOwnBadCell && !hasPending
                  return (
                    <div
                      key={idx}
                      title={rec ? `${rec.status}${rec.planned_shift ? ` (排班:${rec.planned_shift})` : ''}` : ''}
                      onClick={clickable ? () => openModal(dateStr, rec, staff._id) : undefined}
                      className={[
                        'relative flex flex-col items-center justify-start rounded pt-1 pb-1 min-h-[84px] text-xs font-medium bg-gray-50',
                        isFuture ? 'text-gray-300' : 'text-gray-700',
                        isToday ? 'ring-1 ring-blue-400' : '',
                        clickable ? 'cursor-pointer active:opacity-75' : '',
                      ].join(' ')}
                    >
                      <span>{day.date()}</span>
                      {cfg && (
                        <span className={`mt-0.5 px-1.5 rounded leading-tight text-sm ${cfg.bg} ${cfg.text}`}>
                          {rec.status}
                        </span>
                      )}
                      {showTimes && (
                        <span className="flex flex-col items-center leading-tight mt-0.5 text-gray-400 text-xs">
                          <span>↑{clockIn  ?? '--:--'}</span>
                          <span>↓{clockOut ?? '--:--'}</span>
                        </span>
                      )}
                      {hasPending && (
                        <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-orange-400 rounded-full border border-white" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 补卡申请弹窗 */}
      {modal && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setModal(null)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 bg-white rounded-2xl z-50 p-5 shadow-2xl max-w-sm mx-auto space-y-4">
            <h3 className="font-semibold text-gray-800 text-base">补卡申请 · {modal.dateStr}</h3>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 space-y-1.5">
              <div>如果您是早班，需在 <b>{morningStart}</b> 到店，<b>{morningEnd}</b> 离店</div>
              <div>如果您是晚班，需在 <b>{eveningStart}</b> 到店，<b>{eveningEnd}</b> 离店</div>
            </div>

            <div>
              <div className="text-xs text-gray-500 mb-2">选择补哪张卡</div>
              <div className="flex gap-2">
                {(modal.rec?.status !== '漏卡' || !modal.rec?.clock_in) && (
                  <button
                    onClick={() => setSelectedCard('上班')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                      selectedCard === '上班'
                        ? 'border-pink-500 bg-pink-50 text-pink-600'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >补上班卡</button>
                )}
                {(modal.rec?.status !== '漏卡' || !modal.rec?.clock_out) && (
                  <button
                    onClick={() => setSelectedCard('下班')}
                    className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-colors ${
                      selectedCard === '下班'
                        ? 'border-pink-500 bg-pink-50 text-pink-600'
                        : 'border-gray-200 text-gray-600'
                    }`}
                  >补下班卡</button>
                )}
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-gray-200 text-gray-500 text-sm"
              >取消</button>
              <button
                onClick={handleSubmitRequest}
                disabled={!selectedCard || submitting}
                className="flex-1 py-2.5 rounded-xl bg-pink-500 hover:bg-pink-600 disabled:bg-pink-200 text-white text-sm font-medium transition-colors"
              >{submitting ? '发送中...' : '确认发送'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
