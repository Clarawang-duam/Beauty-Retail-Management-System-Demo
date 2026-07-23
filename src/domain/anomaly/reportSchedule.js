import dayjs from 'dayjs'
import { getWeekKey, getMonthKey } from './metrics'

/** 月报进入「生成当月」模式的窗口：每月最后 N 天 */
export const MONTH_TAIL_DAYS = 5

/**
 * 计算当前应展示 / 生成的月报目标周期。
 *
 * 规则：
 * - 每月最后 5 天（含月末）：目标为「当月」，refDate = 今天。
 *   （最后 5 天内 periodKey 恒为本月，故只会生成一次，不随日期刷新。）
 * - 其余日期：目标为「上一整月」，refDate = 上月最后一天。
 *
 * @param {dayjs.Dayjs} now
 * @returns {{ isCurrent: boolean, refDate: dayjs.Dayjs, periodKey: string }}
 */
export function getMonthTarget(now = dayjs()) {
  const daysInMonth = now.daysInMonth()
  const isTail = now.date() > daysInMonth - MONTH_TAIL_DAYS

  if (isTail) {
    return { isCurrent: true, refDate: now, periodKey: getMonthKey(now) }
  }

  const prevMonthEnd = now.subtract(1, 'month').endOf('month')
  return { isCurrent: false, refDate: prevMonthEnd, periodKey: getMonthKey(prevMonthEnd) }
}

/**
 * 计算当前应展示 / 生成的周报目标周期（周一为一周起点）。
 *
 * 规则：
 * - 周日：目标为「本周」（本周一 ~ 今天），refDate = 今天。
 * - 周一 ~ 周六：目标为「上一整周」（上周一 ~ 上周日），refDate = 上周日。
 *
 * @param {dayjs.Dayjs} now
 * @returns {{ isCurrent: boolean, refDate: dayjs.Dayjs, periodKey: string }}
 */
export function getWeekTarget(now = dayjs()) {
  const isSunday = now.day() === 0

  if (isSunday) {
    return { isCurrent: true, refDate: now, periodKey: getWeekKey(now) }
  }

  // 上一周的周日 = 本周一的前一天
  const thisMonday = dayjs(getWeekKey(now))
  const prevSunday = thisMonday.subtract(1, 'day').endOf('day')
  return { isCurrent: false, refDate: prevSunday, periodKey: getWeekKey(prevSunday) }
}
