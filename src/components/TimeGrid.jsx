import { useMemo, useRef } from 'react'
import { generateSlots, timeToMinutes, dateToMinutes, overlaps } from '../utils/timeSlots'
import useCacheStore from '../store/cacheStore'

const CELL_W = 80   // px per slot
const CELL_H = 56   // px per row

/**
 * 时间栅格组件
 *
 * Props:
 *   appointments: [{ _id, member_name, therapist_id, scheduled_time, duration_min, status }]
 *   rows: number                    并发行数（max_clients_per_slot）
 *   preview: { startMin, duration } 当前正在填写的预约（红色预览），null 则不显示
 *   onCellClick: (startMin) => void 点击空白格回调
 *   selectedId: string              日程页点击高亮的预约 ID
 *   onAppointmentClick: (appt) => void
 *   readOnly: boolean
 */
export default function TimeGrid({
  appointments = [],
  rows = 2,
  preview = null,
  onCellClick,
  selectedId,
  onAppointmentClick,
  readOnly = false,
}) {
  const { getSetting } = useCacheStore()
  const scrollRef = useRef(null)

  const settings = {
    morning_shift_start: getSetting('morning_shift_start', '09:00'),
    morning_shift_end: getSetting('morning_shift_end', '13:00'),
    evening_shift_start: getSetting('evening_shift_start', '14:00'),
    evening_shift_end: getSetting('evening_shift_end', '20:00'),
    slot_duration: getSetting('slot_duration', 30),
  }

  const slots = useMemo(() => generateSlots(settings), [
    settings.morning_shift_start, settings.evening_shift_end, settings.slot_duration,
  ])

  const morningEnd = timeToMinutes(settings.morning_shift_end)
  const eveningStart = timeToMinutes(settings.evening_shift_start)
  const shiftStart = timeToMinutes(settings.morning_shift_start)
  const slotDuration = settings.slot_duration

  // 将预约分配到行
  const assignedRows = useMemo(() => {
    const rowData = Array.from({ length: rows }, () => [])
    appointments.forEach((appt) => {
      const startMin = dateToMinutes(appt.scheduled_time)
      const dur = appt.duration_min || slotDuration

      // 找第一个不冲突的行
      for (let r = 0; r < rows; r++) {
        const conflict = rowData[r].some((a) =>
          overlaps(startMin, dur, dateToMinutes(a.scheduled_time), a.duration_min || slotDuration)
        )
        if (!conflict) {
          rowData[r].push(appt)
          break
        }
      }
    })
    return rowData
  }, [appointments, rows, slotDuration])

  const totalWidth = slots.length * CELL_W

  // 某格是否在午休区间
  const isLunchSlot = (startMin) => startMin >= morningEnd && startMin < eveningStart

  // 像素位置计算
  const minToX = (min) => ((min - shiftStart) / slotDuration) * CELL_W
  const durationToW = (dur) => (dur / slotDuration) * CELL_W

  const handleGridClick = (e) => {
    if (readOnly || !onCellClick) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left + (scrollRef.current?.scrollLeft || 0)
    const colIndex = Math.floor(x / CELL_W)
    if (colIndex >= 0 && colIndex < slots.length) {
      onCellClick(slots[colIndex].startMin)
    }
  }

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto border border-gray-200 rounded-xl bg-white"
      style={{ maxWidth: '100%' }}
    >
      <div style={{ width: totalWidth, minWidth: totalWidth }}>
        {/* 时间轴表头 */}
        <div className="flex border-b border-gray-200 sticky top-0 bg-white z-10">
          {slots.map((slot) => (
            <div
              key={slot.startMin}
              style={{ width: CELL_W, minWidth: CELL_W }}
              className={`text-xs text-center py-1.5 border-r border-gray-100 shrink-0 ${
                isLunchSlot(slot.startMin) ? 'bg-gray-100 text-gray-400' : 'text-gray-500'
              }`}
            >
              {slot.label}
            </div>
          ))}
        </div>

        {/* 栅格行 */}
        <div className="relative" onClick={handleGridClick}>
          {Array.from({ length: rows }).map((_, rowIdx) => (
            <div
              key={rowIdx}
              className="flex border-b border-gray-100 last:border-0 relative"
              style={{ height: CELL_H }}
            >
              {slots.map((slot) => (
                <div
                  key={slot.startMin}
                  style={{ width: CELL_W, minWidth: CELL_W, height: CELL_H }}
                  className={`border-r border-gray-100 shrink-0 ${
                    isLunchSlot(slot.startMin) ? 'bg-gray-50' : ''
                  } ${!readOnly ? 'hover:bg-blue-50 cursor-pointer' : ''}`}
                />
              ))}

              {/* 已有预约块（绿色） */}
              {assignedRows[rowIdx]?.map((appt) => {
                const startMin = dateToMinutes(appt.scheduled_time)
                const dur = appt.duration_min || slotDuration
                const x = minToX(startMin)
                const w = Math.max(durationToW(dur) - 2, 20)
                const isSelected = appt._id === selectedId
                return (
                  <div
                    key={appt._id}
                    onClick={(e) => {
                      e.stopPropagation()
                      onAppointmentClick?.(appt)
                    }}
                    style={{ position: 'absolute', left: x + 1, top: 4, width: w, height: CELL_H - 8 }}
                    className={`rounded text-xs px-1.5 py-1 overflow-hidden cursor-pointer z-10 transition-all ${
                      isSelected
                        ? 'bg-purple-500 text-white ring-2 ring-purple-300'
                        : 'bg-green-400 text-white hover:bg-green-500'
                    }`}
                  >
                    <div className="font-medium truncate">{appt.member_name}</div>
                    <div className="opacity-80 truncate">{appt.project_name}</div>
                  </div>
                )
              })}

              {/* 当前填写预览（红色），仅第一行显示 */}
              {rowIdx === 0 && preview && (
                <div
                  style={{
                    position: 'absolute',
                    left: minToX(preview.startMin) + 1,
                    top: 4,
                    width: Math.max(durationToW(preview.duration) - 2, 20),
                    height: CELL_H - 8,
                  }}
                  className="rounded bg-red-400 opacity-80 z-20 pointer-events-none"
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
