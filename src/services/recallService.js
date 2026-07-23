import dayjs from 'dayjs'
import { db, _ } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import { fetchAll } from '../lib/db'
import {
  computeRecallCandidates,
  formatRecallNotificationContent,
  formatRemainingProjectsText,
} from '../domain/recall'
import { computeTxnAggregates } from '../utils/memberTags'
import { writeNotification } from '../utils/notification'
import { writeLog } from '../utils/operationLog'
import { generateRecallScript, buildFallbackScript } from './deepseekService'

/** 同页面并发（如 StrictMode 双跑 effect）时复用同一 Promise */
let activeScanPromise = null

function groupByMemberId(items) {
  const map = {}
  for (const item of items) {
    if (!item.member_id) continue
    if (!map[item.member_id]) map[item.member_id] = []
    map[item.member_id].push(item)
  }
  return map
}

/** 防重、加锁等关键路径始终读库，不用 Zustand 缓存 */
async function readSettingFromDb(key, fallback = '') {
  const res = await db.collection(COLLECTIONS.SETTINGS).where({ key }).limit(1).get()
  return res.data[0]?.value ?? fallback
}

async function getSettingValue(key, fallback, getSetting) {
  const res = await db.collection(COLLECTIONS.SETTINGS).where({ key }).limit(1).get()
  if (res.data.length > 0) return res.data[0].value
  if (getSetting) {
    const cached = getSetting(key, fallback)
    if (cached !== undefined && cached !== null && cached !== '') return cached
  }
  return fallback
}

async function setSettingValue(key, value) {
  const res = await db.collection(COLLECTIONS.SETTINGS).where({ key }).limit(1).get()
  if (res.data.length > 0) {
    await db.collection(COLLECTIONS.SETTINGS).doc(res.data[0]._id).update({ value })
  } else {
    await db.collection(COLLECTIONS.SETTINGS).add({ key, value, category: 'recall' })
  }
}

/** 今日剩余可创建条数（应对崩溃后部分写入、或多端并发） */
export function remainingDailySlots(existingCount, dailyLimit) {
  return Math.max(0, dailyLimit - existingCount)
}

function inferPreferenceText(memberId, checkoutTxns, projects) {
  const nameToCat = {}
  for (const p of projects || []) nameToCat[p.name] = p.category

  const catCount = {}
  for (const t of checkoutTxns) {
    if (t.member_id !== memberId || t.type !== 'checkout') continue
    const cat = nameToCat[t.project_name]
    if (cat) catCount[cat] = (catCount[cat] || 0) + 1
  }

  const sorted = Object.entries(catCount).sort((a, b) => b[1] - a[1])
  if (sorted.length === 0) return '偏好护理项目'
  return `偏好${sorted[0][0]}项目`
}

async function memberHasTaskToday(memberId, scanDate) {
  const res = await db.collection(COLLECTIONS.RECALL_TASKS)
    .where({ member_id: memberId, scan_date: scanDate })
    .limit(1)
    .get()
  return res.data.length > 0
}

export function runDailyRecallScan(options) {
  if (activeScanPromise) return activeScanPromise
  activeScanPromise = executeDailyRecallScan(options).finally(() => {
    activeScanPromise = null
  })
  return activeScanPromise
}

async function executeDailyRecallScan({ getSetting, user, refreshCache }) {
  const todayStr = dayjs().format('YYYY-MM-DD')

  const lastScan = await readSettingFromDb('last_recall_scan_date', '')
  if (lastScan === todayStr) return { skipped: true, created: 0 }

  // 先占位加锁，再拉数据，避免两次扫描同时通过检查
  await setSettingValue('last_recall_scan_date', todayStr)
  if (refreshCache) await refreshCache('settings')

  const dailyLimit = Number(await getSettingValue('recall_daily_limit', 9, getSetting))
  const cooldownDays = Number(await getSettingValue('recall_contact_cooldown_days', 7, getSetting))

  const [members, memberProjects, appointments, existingTasks, pendingTasks, recentTasks, checkout3m, purchase1y, projects] =
    await Promise.all([
      fetchAll(COLLECTIONS.MEMBERS),
      fetchAll(COLLECTIONS.MEMBER_PROJECTS),
      fetchAll(COLLECTIONS.APPOINTMENTS),
      db.collection(COLLECTIONS.RECALL_TASKS).where({ scan_date: todayStr }).limit(100).get(),
      db.collection(COLLECTIONS.RECALL_TASKS).where({ status: 'pending' }).limit(200).get(),
      db.collection(COLLECTIONS.RECALL_TASKS)
        .where({
          status: _.in(['contacted', 'dismissed']),
          created_at: _.gte(dayjs().subtract(cooldownDays, 'day').toDate()),
        })
        .limit(500)
        .get(),
      db.collection(COLLECTIONS.TRANSACTIONS)
        .where({ type: 'checkout', operated_at: _.gte(dayjs().subtract(90, 'day').toDate()) })
        .limit(2000)
        .get()
        .then((r) => r.data),
      db.collection(COLLECTIONS.TRANSACTIONS)
        .where({
          type: _.in(['purchase', 'refund']),
          operated_at: _.gte(dayjs().subtract(365, 'day').toDate()),
        })
        .limit(5000)
        .get()
        .then((r) => r.data),
      fetchAll(COLLECTIONS.PROJECTS),
    ])

  const slotsRemaining = remainingDailySlots(existingTasks.data.length, dailyLimit)
  if (slotsRemaining === 0) return { skipped: true, created: 0 }

  const todayTaskMemberIds = new Set(existingTasks.data.map((t) => t.member_id))
  for (const task of pendingTasks.data) {
    todayTaskMemberIds.add(task.member_id)
  }

  const cooldownMemberIds = new Set()
  for (const task of recentTasks.data) {
    if (task.status === 'contacted' && task.contacted_at) {
      if (dayjs().diff(dayjs(task.contacted_at), 'day') < cooldownDays) {
        cooldownMemberIds.add(task.member_id)
      }
    }
    if (task.status === 'dismissed') {
      const dismissedAt = task.dismissed_at || task.created_at
      if (dismissedAt && dayjs().diff(dayjs(dismissedAt), 'day') < cooldownDays) {
        cooldownMemberIds.add(task.member_id)
      }
    }
  }

  const futureAppointmentMemberIds = new Set()
  for (const appt of appointments) {
    if (!appt.member_id || appt.status === 'cancelled') continue
    if (appt.date && appt.date >= todayStr) {
      futureAppointmentMemberIds.add(appt.member_id)
    }
  }

  const memberProjectsByMember = groupByMemberId(memberProjects)
  const txnAggregates = computeTxnAggregates(checkout3m, purchase1y)

  let getSettingFn = getSetting
  if (!getSettingFn) {
    const settingsRes = await db.collection(COLLECTIONS.SETTINGS).limit(100).get()
    const map = {}
    settingsRes.data.forEach((item) => { map[item.key] = item.value })
    getSettingFn = (key, fallback) => (map[key] !== undefined ? map[key] : fallback)
  }

  const candidates = computeRecallCandidates({
    members,
    memberProjectsByMember,
    futureAppointmentMemberIds,
    cooldownMemberIds,
    todayTaskMemberIds,
    getSetting: getSettingFn,
    txnAggregates,
  })

  const toCreate = candidates
    .filter((c) => !todayTaskMemberIds.has(c.member_id))
    .slice(0, slotsRemaining)

  const now = new Date()
  let created = 0

  for (const c of toCreate) {
    if (created >= slotsRemaining) break
    if (await memberHasTaskToday(c.member_id, todayStr)) continue

    const preferenceText = inferPreferenceText(c.member_id, checkout3m, projects)
    const taskDoc = {
      member_id: c.member_id,
      member_name: c.member_name,
      phone: c.phone,
      skin_type: c.skin_type,
      dormant_days: c.dormant_days,
      total_remaining: c.total_remaining,
      top_projects: c.top_projects,
      preference_text: preferenceText,
      tags: c.tags,
      priority_score: c.priority_score,
      ai_script: '',
      status: 'pending',
      scan_date: todayStr,
      created_at: now,
    }
    const addRes = await db.collection(COLLECTIONS.RECALL_TASKS).add(taskDoc)

    await db.collection(COLLECTIONS.NOTIFICATIONS).add({
      type: 'recall_task',
      content: formatRecallNotificationContent(c) + '·点击查看话术',
      recall_task_id: addRes.id,
      member_id: c.member_id,
      task_status: 'pending',
      created_at: now,
    })

    todayTaskMemberIds.add(c.member_id)
    created++
  }

  if (user && created > 0) {
    await writeLog(user, 'AI召回', `今日扫描生成 ${created} 条召回任务`)
  }

  return { skipped: false, created }
}

export async function loadRecallTask(taskId) {
  const res = await db.collection(COLLECTIONS.RECALL_TASKS).doc(taskId).get()
  return res.data?.[0] || null
}

export async function generateTaskScript(task, getSetting) {
  if (task.ai_script) return task.ai_script

  const apiKey =
    getSetting?.('deepseek_api_key') ||
    import.meta.env.VITE_DEEPSEEK_API_KEY ||
    ''

  const ctx = {
    member_name: task.member_name,
    dormant_days: task.dormant_days,
    remaining_text: formatRemainingProjectsText(task.top_projects),
    skin_type: task.skin_type,
    preference_text: task.preference_text,
  }

  let script
  try {
    script = await generateRecallScript(ctx, apiKey)
  } catch (err) {
    console.error('DeepSeek 生成失败，使用模板话术', err)
    script = buildFallbackScript(ctx)
  }

  await db.collection(COLLECTIONS.RECALL_TASKS).doc(task._id).update({ ai_script: script })
  return script
}

export async function markTaskContacted({ taskId, user, operatorId, operatorName, note = '' }) {
  const now = new Date()
  await db.collection(COLLECTIONS.RECALL_TASKS).doc(taskId).update({
    status: 'contacted',
    contacted_at: now,
    contacted_by: operatorId,
    contacted_by_name: operatorName,
    contact_note: note,
  })

  const notifRes = await db.collection(COLLECTIONS.NOTIFICATIONS)
    .where({ recall_task_id: taskId })
    .limit(5)
    .get()
  await Promise.all(
    notifRes.data.map((n) =>
      db.collection(COLLECTIONS.NOTIFICATIONS).doc(n._id).update({ task_status: 'contacted' })
    )
  )

  const task = await loadRecallTask(taskId)
  if (user && task) {
    await writeLog(user, 'AI召回', `已联系会员「${task.member_name}」${note ? `（${note}）` : ''}`)
  }
}

export async function markTaskDismissed({ taskId, user }) {
  const now = new Date()
  await db.collection(COLLECTIONS.RECALL_TASKS).doc(taskId).update({
    status: 'dismissed',
    dismissed_at: now,
  })

  const notifRes = await db.collection(COLLECTIONS.NOTIFICATIONS)
    .where({ recall_task_id: taskId })
    .limit(5)
    .get()
  await Promise.all(
    notifRes.data.map((n) =>
      db.collection(COLLECTIONS.NOTIFICATIONS).doc(n._id).update({ task_status: 'dismissed' })
    )
  )

  const task = await loadRecallTask(taskId)
  if (user && task) {
    await writeLog(user, 'AI召回', `暂不理会召回「${task.member_name}」`)
  }
}

const CONVERSION_WINDOW_DAYS = 30

export async function markConvertedIfNeeded(memberId, txnId) {
  const cutoff = dayjs().subtract(CONVERSION_WINDOW_DAYS, 'day').toDate()
  const res = await db.collection(COLLECTIONS.RECALL_TASKS)
    .where({ member_id: memberId, status: 'contacted', contacted_at: _.gte(cutoff) })
    .limit(10)
    .get()

  if (!res.data.length) return

  const now = new Date()
  for (const task of res.data) {
    await db.collection(COLLECTIONS.RECALL_TASKS).doc(task._id).update({
      status: 'converted',
      converted_at: now,
      converted_txn_id: txnId || '',
    })
    await writeNotification(`${task.member_name} 召回成功，已到店消费 🎉`, 'recall_success')
  }
}
