import dayjs from 'dayjs'

function toMin(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number)
  return h * 60 + m
}

export function inferAttendance(clockIn, clockOut, getSetting, scheduledShift = null) {
  if (!clockIn && !clockOut) {
    if (scheduledShift === 'off') return { actual_shift: 'off', status: '休息' }
    return { actual_shift: null, status: '缺勤' }
  }
  if (!clockIn || !clockOut) return { actual_shift: null, status: '漏卡' }

  const mStart = toMin(getSetting('morning_shift_start', '09:00'))
  const mEnd   = toMin(getSetting('morning_shift_end',   '13:00'))
  const eStart = toMin(getSetting('evening_shift_start', '14:00'))
  const eEnd   = toMin(getSetting('evening_shift_end',   '20:00'))

  const inMin  = dayjs(clockIn).hour()  * 60 + dayjs(clockIn).minute()
  const outMin = dayjs(clockOut).hour() * 60 + dayjs(clockOut).minute()

  // 加班：完整覆盖早班和晚班
  if (inMin <= mStart && outMin >= eEnd) return { actual_shift: 'overtime', status: '加班' }

  // 用实际打卡区间与早班/晚班的重叠时长归属班次
  const overlap = (aS, aE, bS, bE) => Math.max(0, Math.min(aE, bE) - Math.max(aS, bS))
  const isMorning = overlap(inMin, outMin, mStart, mEnd) > overlap(inMin, outMin, eStart, eEnd)

  if (isMorning) {
    const late = inMin > mStart
    const early = outMin < mEnd
    if (late && early) return { actual_shift: 'morning', status: '迟到早退' }
    if (late)          return { actual_shift: 'morning', status: '迟到' }
    if (early)         return { actual_shift: 'morning', status: '早退' }
    return { actual_shift: 'morning', status: '正常' }
  } else {
    const late = inMin > eStart
    const early = outMin < eEnd
    if (late && early) return { actual_shift: 'evening', status: '迟到早退' }
    if (late)          return { actual_shift: 'evening', status: '迟到' }
    if (early)         return { actual_shift: 'evening', status: '早退' }
    return { actual_shift: 'evening', status: '正常' }
  }
}
