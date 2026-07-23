import { useState, useEffect } from 'react'
import dayjs from 'dayjs'
import { db, _ } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import useCacheStore from '../store/cacheStore'
import { inferAttendance } from '../utils/attendance'
import RecallTaskCard from './RecallTaskCard'

function relativeTime(date) {
  if (!date) return ''
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

function typeIcon(type) {
  if (type === 'appointment')  return '📅'
  if (type === 'verification') return '🔑'
  if (type === 'punch_request') return '🕐'
  if (type === 'recall_task') return '📣'
  if (type === 'recall_success') return '🎉'
  return '📦'
}

async function resolveShift(staffId, date) {
  const [schRes, rotRes] = await Promise.all([
    db.collection(COLLECTIONS.SHIFT_SCHEDULES).where({ staff_id: staffId, date }).get(),
    db.collection(COLLECTIONS.SHIFT_ROTATIONS).where({ staff_id: staffId }).get(),
  ])
  let scheduledShift = schRes.data[0]?.shift || null
  if (!scheduledShift && rotRes.data.length) {
    const rot = rotRes.data[0]
    if (rot.start_date && rot.cycle_days && rot.pattern?.length) {
      const diff = dayjs(date).diff(dayjs(rot.start_date), 'day')
      if (diff >= 0) scheduledShift = rot.pattern[diff % rot.cycle_days] || null
    }
  }
  return scheduledShift
}

async function refreshAttendance(staffId, date, getSetting) {
  const [punchRes, scheduledShift] = await Promise.all([
    db.collection(COLLECTIONS.PUNCH_RECORDS)
      .where({ staff_id: staffId, date, type: _.in(['上班', '下班']) })
      .get(),
    resolveShift(staffId, date),
  ])

  const activePunches = punchRes.data
    .filter(p => !p.is_pending)
    .sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at))

  const clockIn  = activePunches.find(p => p.type === '上班')?.punched_at || null
  const clockOut = [...activePunches].reverse().find(p => p.type === '下班')?.punched_at || null

  const { actual_shift, status } = inferAttendance(clockIn, clockOut, getSetting, scheduledShift)
  const payload = { clock_in: clockIn, clock_out: clockOut, planned_shift: scheduledShift, actual_shift, status }

  const existing = await db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
    .where({ staff_id: staffId, date })
    .get()

  if (existing.data.length > 0) {
    await db.collection(COLLECTIONS.ATTENDANCE_RECORDS).doc(existing.data[0]._id).update(payload)
  } else {
    await db.collection(COLLECTIONS.ATTENDANCE_RECORDS).add({
      ...payload, staff_id: staffId, date, created_at: new Date(),
    })
  }
}

export default function NotificationPanel({ onClose }) {
  const { getSetting } = useCacheStore()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(null)

  useEffect(() => {
    db.collection(COLLECTIONS.NOTIFICATIONS)
      .orderBy('created_at', 'desc')
      .limit(50)
      .get()
      .then((res) => setItems(res.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleApprove = async (item) => {
    setProcessing(item._id)
    try {
      const shift = await resolveShift(item.staff_id, item.date)
      let timeStr
      if (item.card_type === '上班') {
        timeStr = shift === '晚班'
          ? getSetting('evening_shift_start', '14:00')
          : getSetting('morning_shift_start', '09:00')
      } else {
        timeStr = shift === '晚班'
          ? getSetting('evening_shift_end', '20:00')
          : getSetting('morning_shift_end', '13:00')
      }
      const [h, m] = timeStr.split(':').map(Number)
      const punchedAt = dayjs(item.date).hour(h).minute(m).second(0).toDate()

      await db.collection(COLLECTIONS.PUNCH_RECORDS)
        .doc(item.punch_record_id)
        .update({ is_pending: false, request_status: 'approved', punched_at: punchedAt })

      await db.collection(COLLECTIONS.NOTIFICATIONS)
        .doc(item._id)
        .update({ request_status: 'approved' })

      await refreshAttendance(item.staff_id, item.date, getSetting)

      setItems(prev => prev.map(i =>
        i._id === item._id ? { ...i, request_status: 'approved' } : i
      ))
    } catch (err) {
      alert('操作失败：' + err.message)
    } finally {
      setProcessing(null)
    }
  }

  const handleReject = async (item) => {
    setProcessing(item._id)
    try {
      await db.collection(COLLECTIONS.PUNCH_RECORDS)
        .doc(item.punch_record_id)
        .update({ request_status: 'rejected' })

      await db.collection(COLLECTIONS.NOTIFICATIONS)
        .doc(item._id)
        .update({ request_status: 'rejected' })

      setItems(prev => prev.map(i =>
        i._id === item._id ? { ...i, request_status: 'rejected' } : i
      ))
    } catch (err) {
      alert('操作失败：' + err.message)
    } finally {
      setProcessing(null)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-80 bg-white shadow-2xl z-50 flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-800">消息</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center text-gray-400 text-sm py-12">加载中...</div>
          ) : items.length === 0 ? (
            <div className="text-center text-gray-400 text-sm py-12">暂无消息</div>
          ) : (
            items.map((item) => (
              item.type === 'recall_task' ? (
                <RecallTaskCard
                  key={item._id}
                  item={item}
                  onUpdate={(id, patch) => setItems((prev) => prev.map((i) => i._id === id ? { ...i, ...patch } : i))}
                />
              ) : (
              <div key={item._id} className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50">
                <div className="flex items-start gap-2">
                  <span className="text-base mt-0.5 shrink-0">{typeIcon(item.type)}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-700 leading-relaxed">{item.content}</p>
                    <p className="text-xs text-gray-400 mt-1">{relativeTime(item.created_at)}</p>
                    {item.type === 'punch_request' && (
                      <div className="mt-2">
                        {item.request_status === 'pending' ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleApprove(item)}
                              disabled={processing === item._id}
                              className="flex-1 py-1.5 bg-green-500 hover:bg-green-600 disabled:bg-green-200 text-white text-xs rounded-lg font-medium"
                            >{processing === item._id ? '处理中...' : '批准'}</button>
                            <button
                              onClick={() => handleReject(item)}
                              disabled={processing === item._id}
                              className="flex-1 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-600 text-xs rounded-lg font-medium"
                            >拒绝</button>
                          </div>
                        ) : (
                          <span className={`text-xs font-medium ${
                            item.request_status === 'approved' ? 'text-green-600' : 'text-gray-400'
                          }`}>
                            {item.request_status === 'approved' ? '✓ 已批准' : '✗ 已拒绝'}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              )
            ))
          )}
        </div>
      </div>
    </>
  )
}
