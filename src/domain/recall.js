import dayjs from 'dayjs'
import { getMemberTags } from '../utils/memberTags'

/** 汇总会员未消耗项目 */
export function summarizeMemberProjects(memberProjects) {
  const active = (memberProjects || []).filter(
    (mp) => mp.status !== 'refunded' && mp.remaining_sessions > 0
  )
  const totalRemaining = active.reduce((s, mp) => s + mp.remaining_sessions, 0)
  const topProjects = [...active]
    .sort((a, b) => a.remaining_sessions - b.remaining_sessions)
    .slice(0, 3)
    .map((mp) => ({
      project_name: mp.project_name,
      remaining_sessions: mp.remaining_sessions,
    }))
  return { totalRemaining, topProjects, active }
}

/** 是否沉睡客（与 memberTags 口径一致） */
export function isDormantMember(member, dormantDays, newDays, now = dayjs()) {
  const isNew = member.created_at && now.diff(dayjs(member.created_at), 'day') <= newDays
  if (isNew) return false
  const lastVisit = member.last_visit_at ? dayjs(member.last_visit_at) : null
  const daysSince = lastVisit ? now.diff(lastVisit, 'day') : null
  return daysSince === null || daysSince >= dormantDays
}

export function dormantDaysForMember(member, now = dayjs()) {
  if (member.last_visit_at) {
    return now.diff(dayjs(member.last_visit_at), 'day')
  }
  if (member.created_at) {
    return now.diff(dayjs(member.created_at), 'day')
  }
  return 999
}

export function computeRecallScore({ dormantDays, totalRemaining, tags, isKey, hasLowRemaining }) {
  let score = dormantDays * 2
  score += totalRemaining * 10
  if (tags.includes('大客户')) score += 50
  if (hasLowRemaining) score += 30
  if (isKey) score += 20
  return score
}

/**
 * 筛选今日召回候选人（纯函数）
 * @returns 按 priority_score 降序
 */
export function computeRecallCandidates({
  members,
  memberProjectsByMember,
  futureAppointmentMemberIds = new Set(),
  cooldownMemberIds = new Set(),
  todayTaskMemberIds = new Set(),
  getSetting,
  txnAggregates = {},
  now = dayjs(),
}) {
  const dormantDays = Number(getSetting('tag_dormant_days', 30))
  const newDays = Number(getSetting('tag_new_days', 30))

  const candidates = []

  for (const member of members) {
    if (todayTaskMemberIds.has(member._id)) continue
    if (cooldownMemberIds.has(member._id)) continue
    if (futureAppointmentMemberIds.has(member._id)) continue
    if (!isDormantMember(member, dormantDays, newDays, now)) continue

    const mps = memberProjectsByMember[member._id] || []
    const { totalRemaining, topProjects, active } = summarizeMemberProjects(mps)
    if (totalRemaining <= 0) continue

    const tags = getMemberTags(member, txnAggregates, getSetting)
    const hasLowRemaining = active.some((mp) => mp.remaining_sessions <= 2)
    const dormantDaysCount = dormantDaysForMember(member, now)

    candidates.push({
      member,
      member_id: member._id,
      member_name: member.name,
      phone: member.phone || '',
      skin_type: member.skin_type || '',
      dormant_days: dormantDaysCount,
      total_remaining: totalRemaining,
      top_projects: topProjects,
      tags,
      priority_score: computeRecallScore({
        dormantDays: dormantDaysCount,
        totalRemaining,
        tags,
        isKey: !!member.is_key,
        hasLowRemaining,
      }),
    })
  }

  return candidates.sort((a, b) => b.priority_score - a.priority_score)
}

export function formatRecallNotificationContent({ member_name, dormant_days, total_remaining }) {
  return `【召回任务】${member_name}·沉睡${dormant_days}天·剩余${total_remaining}次`
}

export function formatRemainingProjectsText(topProjects) {
  if (!topProjects?.length) return '暂无'
  return topProjects
    .map((p) => `${p.project_name} ${p.remaining_sessions}次`)
    .join('、')
}
