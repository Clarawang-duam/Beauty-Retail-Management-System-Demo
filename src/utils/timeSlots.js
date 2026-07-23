import dayjs from 'dayjs'

// "09:00" → 当天该时刻的分钟数（距离 00:00）
export function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(':').map(Number)
  return h * 60 + m
}

// 分钟数 → "09:00"
export function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// 向上取整到最近的 step 分钟倍数（5分钟倍数）
export function roundUpToStep(minutes, step = 5) {
  return Math.ceil(minutes / step) * step
}

// 生成栅格列：从 startMin 到 endMin，每隔 slotDuration 一列
// 返回 [{ label: '09:00', startMin: 540 }, ...]
export function generateSlots(settings) {
  const morningStart = timeToMinutes(settings.morning_shift_start || '09:00')
  const eveningEnd = timeToMinutes(settings.evening_shift_end || '20:00')
  const slotDuration = settings.slot_duration || 30

  const slots = []
  for (let t = morningStart; t < eveningEnd; t += slotDuration) {
    slots.push({ label: minutesToTime(t), startMin: t })
  }
  return slots
}

// 将 Date/timestamp 转为当天分钟数
export function dateToMinutes(date) {
  const d = dayjs(date)
  return d.hour() * 60 + d.minute()
}

// 将「选定日期 + 时间字符串」拼成 Date
export function buildDateTime(dateStr, timeStr) {
  return dayjs(`${dateStr} ${timeStr}`, 'YYYY-MM-DD HH:mm').toDate()
}

// 检查两个时间段是否重叠
export function overlaps(aStart, aDuration, bStart, bDuration) {
  const aEnd = aStart + aDuration
  const bEnd = bStart + bDuration
  return aStart < bEnd && bStart < aEnd
}
