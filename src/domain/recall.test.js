import { describe, it, expect } from 'vitest'
import dayjs from 'dayjs'
import {
  summarizeMemberProjects,
  isDormantMember,
  computeRecallCandidates,
  computeRecallScore,
  formatRecallNotificationContent,
} from './recall'

const getSetting = (key, fallback) => {
  const map = {
    tag_dormant_days: 30,
    tag_new_days: 30,
    tag_high_freq_min: 4,
    tag_big_spender_min: 3000,
  }
  return map[key] ?? fallback
}

describe('summarizeMemberProjects', () => {
  it('只计未退款且剩余>0', () => {
    const mps = [
      { project_name: '清洁', remaining_sessions: 2, status: 'active' },
      { project_name: '补水', remaining_sessions: 0, status: 'active' },
      { project_name: '面膜', remaining_sessions: 1, status: 'refunded' },
    ]
    const { totalRemaining, topProjects } = summarizeMemberProjects(mps)
    expect(totalRemaining).toBe(2)
    expect(topProjects).toHaveLength(1)
    expect(topProjects[0].project_name).toBe('清洁')
  })
})

describe('isDormantMember', () => {
  const now = dayjs('2026-07-02')

  it('新客不算沉睡', () => {
    const m = { created_at: now.subtract(10, 'day').toDate(), last_visit_at: null }
    expect(isDormantMember(m, 30, 30, now)).toBe(false)
  })

  it('超 dormant 天数算沉睡', () => {
    const m = {
      created_at: now.subtract(100, 'day').toDate(),
      last_visit_at: now.subtract(35, 'day').toDate(),
    }
    expect(isDormantMember(m, 30, 30, now)).toBe(true)
  })
})

describe('computeRecallCandidates', () => {
  const now = dayjs('2026-07-02')

  it('沉睡且有剩余次数才入选', () => {
    const members = [
      { _id: 'a', name: '张姐', created_at: now.subtract(100, 'day').toDate(), last_visit_at: now.subtract(35, 'day').toDate() },
      { _id: 'b', name: '李姐', created_at: now.subtract(100, 'day').toDate(), last_visit_at: now.subtract(5, 'day').toDate() },
    ]
    const memberProjectsByMember = {
      a: [{ project_name: '清洁', remaining_sessions: 2, status: 'active' }],
      b: [{ project_name: '清洁', remaining_sessions: 2, status: 'active' }],
    }
    const result = computeRecallCandidates({
      members,
      memberProjectsByMember,
      getSetting,
      now,
    })
    expect(result).toHaveLength(1)
    expect(result[0].member_name).toBe('张姐')
  })

  it('无剩余次数不入选', () => {
    const members = [
      { _id: 'a', name: '张姐', created_at: now.subtract(100, 'day').toDate(), last_visit_at: now.subtract(35, 'day').toDate() },
    ]
    const result = computeRecallCandidates({
      members,
      memberProjectsByMember: { a: [{ project_name: '清洁', remaining_sessions: 0, status: 'active' }] },
      getSetting,
      now,
    })
    expect(result).toHaveLength(0)
  })
})

describe('computeRecallScore', () => {
  it('剩余次数与大客户加权更高', () => {
    const low = computeRecallScore({ dormantDays: 30, totalRemaining: 1, tags: [], isKey: false, hasLowRemaining: false })
    const high = computeRecallScore({ dormantDays: 30, totalRemaining: 2, tags: ['大客户'], isKey: true, hasLowRemaining: true })
    expect(high).toBeGreaterThan(low)
  })
})

describe('formatRecallNotificationContent', () => {
  it('格式化推送文案', () => {
    expect(formatRecallNotificationContent({ member_name: '张姐', dormant_days: 35, total_remaining: 2 }))
      .toBe('【召回任务】张姐·沉睡35天·剩余2次')
  })
})
