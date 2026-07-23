import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryDb } from './memoryDb'
import { COLLECTIONS } from '../lib/collections'
import { DEMO_STORAGE_KEY } from './mode'
import dayjs from 'dayjs'

function installLocalStorage() {
  const map = new Map()
  globalThis.localStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: (k) => { map.delete(k) },
    clear: () => { map.clear() },
  }
}

describe('demo memoryDb', () => {
  beforeEach(() => {
    installLocalStorage()
    localStorage.removeItem(DEMO_STORAGE_KEY)
  })

  it('登录账号可查', async () => {
    const { db, reset } = createMemoryDb()
    reset()
    const res = await db.collection(COLLECTIONS.STAFF)
      .where({ account: 'demo', password_hash: 'demo123' })
      .get()
    expect(res.data).toHaveLength(1)
    expect(res.data[0].role).toBe('owner')
  })

  it('当日预约号可查', async () => {
    const { db, reset } = createMemoryDb()
    reset()
    const dayStart = dayjs().startOf('day').toDate()
    const dayEnd = dayjs().endOf('day').toDate()
    const res = await db.collection(COLLECTIONS.APPOINTMENTS).where({
      booking_code: '0001',
      scheduled_time: db.command.gte(dayStart).and(db.command.lte(dayEnd)),
      status: db.command.neq('cancelled'),
    }).get()
    expect(res.data).toHaveLength(1)
    expect(res.data[0].project_ids).toContain('project_demo_hydrate')
  })

  it('RegExp 搜索会员', async () => {
    const { db, reset } = createMemoryDb()
    reset()
    const res = await db.collection(COLLECTIONS.MEMBERS).where(db.command.or([
      { name: db.RegExp({ regexp: '演示', options: 'i' }) },
      { phone: db.RegExp({ regexp: '0001', options: 'i' }) },
    ])).get()
    expect(res.data.length).toBeGreaterThanOrEqual(1)
  })

  it('doc update / remove / add', async () => {
    const { db, reset } = createMemoryDb()
    reset()
    const addRes = await db.collection(COLLECTIONS.MEMBERS).add({
      name: '临时客',
      phone: '13900000099',
      points: 0,
      created_at: new Date(),
    })
    await db.collection(COLLECTIONS.MEMBERS).doc(addRes.id).update({ notes: 'hi' })
    const got = await db.collection(COLLECTIONS.MEMBERS).doc(addRes.id).get()
    expect(got.data[0].notes).toBe('hi')
    await db.collection(COLLECTIONS.MEMBERS).doc(addRes.id).remove()
    const gone = await db.collection(COLLECTIONS.MEMBERS).doc(addRes.id).get()
    expect(gone.data).toHaveLength(0)
  })

  it('persist 后日期字段仍可比较', async () => {
    const { reset } = createMemoryDb()
    reset()
    const { db: db2 } = createMemoryDb()
    const dayStart = dayjs().startOf('day').toDate()
    const dayEnd = dayjs().endOf('day').toDate()
    const res = await db2.collection(COLLECTIONS.APPOINTMENTS).where({
      booking_code: '0001',
      scheduled_time: db2.command.gte(dayStart).and(db2.command.lte(dayEnd)),
    }).get()
    expect(res.data).toHaveLength(1)
  })

  it('看板种子：销售/手工费/考勤/薪酬/门店坐标可查', async () => {
    const { db, reset } = createMemoryDb()
    reset()
    const prevStart = dayjs().subtract(1, 'day').startOf('day').toDate()
    const end = dayjs().endOf('day').toDate()
    const monthStart = dayjs().startOf('month').format('YYYY-MM-DD')
    const monthEnd = dayjs().endOf('month').format('YYYY-MM-DD')

    const [txn, att, all, sf, lat] = await Promise.all([
      db.collection(COLLECTIONS.TRANSACTIONS)
        .where({ operated_at: db.command.gte(prevStart).and(db.command.lte(end)) })
        .limit(1000).get(),
      db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
        .where({ date: db.command.gte(monthStart).and(db.command.lte(monthEnd)) })
        .limit(2000).get(),
      db.collection(COLLECTIONS.TRANSACTIONS).limit(1000).get(),
      db.collection(COLLECTIONS.SETTINGS).where({ key: 'salary_formula' }).get(),
      db.collection(COLLECTIONS.SETTINGS).where({ key: 'store_lat' }).get(),
    ])

    expect(all.data.filter((t) => t.type === 'purchase').length).toBeGreaterThan(10)
    expect(all.data.filter((t) => t.is_fee).length).toBeGreaterThan(5)
    expect(att.data.length).toBeGreaterThan(10)
    expect(txn.data.length).toBeGreaterThan(0)
    expect(sf.data[0]?.value?.高级).toBeTruthy()
    expect(lat.data[0]?.value).toBe('31.2304')
    expect(att.data[0].planned_shift).toBeTruthy()
  })
})
