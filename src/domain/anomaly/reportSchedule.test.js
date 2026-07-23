import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import { getWeekTarget, getMonthTarget } from './reportSchedule'

describe('getMonthTarget', () => {
  it('月初~倒数第6天：展示上一整月', () => {
    // 2026-03-01（3月共31天，最后5天为27~31）
    const t = getMonthTarget(dayjs('2026-03-01'))
    expect(t.isCurrent).toBe(false)
    expect(t.periodKey).toBe('2026-02')
  })

  it('月中：展示上一整月', () => {
    const t = getMonthTarget(dayjs('2026-03-20'))
    expect(t.isCurrent).toBe(false)
    expect(t.periodKey).toBe('2026-02')
  })

  it('倒数第6天（26号）仍展示上月', () => {
    const t = getMonthTarget(dayjs('2026-03-26'))
    expect(t.isCurrent).toBe(false)
    expect(t.periodKey).toBe('2026-02')
  })

  it('最后5天第一天（27号）：切换为当月', () => {
    const t = getMonthTarget(dayjs('2026-03-27'))
    expect(t.isCurrent).toBe(true)
    expect(t.periodKey).toBe('2026-03')
  })

  it('月末（31号）：当月', () => {
    const t = getMonthTarget(dayjs('2026-03-31'))
    expect(t.isCurrent).toBe(true)
    expect(t.periodKey).toBe('2026-03')
  })

  it('最后5天内 periodKey 恒定（只生成一次）', () => {
    const k27 = getMonthTarget(dayjs('2026-03-27')).periodKey
    const k29 = getMonthTarget(dayjs('2026-03-29')).periodKey
    const k31 = getMonthTarget(dayjs('2026-03-31')).periodKey
    expect(k27).toBe('2026-03')
    expect(k29).toBe('2026-03')
    expect(k31).toBe('2026-03')
  })

  it('2月（28天）最后5天为24~28', () => {
    expect(getMonthTarget(dayjs('2026-02-23')).isCurrent).toBe(false)
    expect(getMonthTarget(dayjs('2026-02-24')).isCurrent).toBe(true)
    expect(getMonthTarget(dayjs('2026-02-24')).periodKey).toBe('2026-02')
  })
})

describe('getWeekTarget', () => {
  // 2026-03-16 是周一，2026-03-22 是周日
  it('周一：展示上一整周', () => {
    const t = getWeekTarget(dayjs('2026-03-16'))
    expect(t.isCurrent).toBe(false)
    expect(t.periodKey).toBe('2026-03-09') // 上周一
  })

  it('周三：展示上一整周', () => {
    const t = getWeekTarget(dayjs('2026-03-18'))
    expect(t.isCurrent).toBe(false)
    expect(t.periodKey).toBe('2026-03-09')
  })

  it('周六：仍展示上一整周', () => {
    const t = getWeekTarget(dayjs('2026-03-21'))
    expect(t.isCurrent).toBe(false)
    expect(t.periodKey).toBe('2026-03-09')
  })

  it('周日：切换为本周', () => {
    const t = getWeekTarget(dayjs('2026-03-22'))
    expect(t.isCurrent).toBe(true)
    expect(t.periodKey).toBe('2026-03-16') // 本周一
  })

  it('周一~周六 periodKey 恒定（同一份上周报）', () => {
    const keys = ['2026-03-16', '2026-03-18', '2026-03-21'].map(
      (d) => getWeekTarget(dayjs(d)).periodKey
    )
    expect(new Set(keys).size).toBe(1)
  })
})
