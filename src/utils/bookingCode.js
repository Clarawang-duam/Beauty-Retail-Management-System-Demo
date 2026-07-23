import { db } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import dayjs from 'dayjs'

/**
 * 生成预约号
 * 规则：手机后4位；当日已存在相同4位则加1位随机数变5位
 */
export async function generateBookingCode(phone, date) {
  const last4 = phone.slice(-4)
  const dayStart = dayjs(date).startOf('day').toDate()
  const dayEnd = dayjs(date).endOf('day').toDate()

  const res = await db.collection(COLLECTIONS.APPOINTMENTS)
    .where({
      booking_code: last4,
      scheduled_time: db.command.gte(dayStart).and(db.command.lte(dayEnd)),
    })
    .count()

  if (res.total === 0) return last4

  // 冲突：追加1位随机数
  const extra = Math.floor(Math.random() * 10)
  return last4 + String(extra)
}
