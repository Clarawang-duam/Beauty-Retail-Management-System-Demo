import { describe, it, expect } from 'vitest'
import { remainingDailySlots } from './recallService'

describe('remainingDailySlots', () => {
  it('已有任务数达到上限时返回 0', () => {
    expect(remainingDailySlots(9, 9)).toBe(0)
    expect(remainingDailySlots(10, 9)).toBe(0)
  })

  it('部分写入后只补剩余名额', () => {
    expect(remainingDailySlots(3, 9)).toBe(6)
  })

  it('无已有任务时返回完整上限', () => {
    expect(remainingDailySlots(0, 9)).toBe(9)
  })
})
