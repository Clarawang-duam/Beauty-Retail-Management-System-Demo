import dayjs from 'dayjs'
import { COLLECTIONS } from '../lib/collections'
import { DEFAULT_SETTINGS } from '../lib/settings'

const id = (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`

/** 构建演示种子数据（内存副本，可被写入修改） */
export function buildSeedData() {
  const now = new Date()
  const today = dayjs().startOf('day')
  const ownerId = 'staff_demo_owner'
  const staffAId = 'staff_demo_mei'
  const staffBId = 'staff_demo_lin'
  const member1 = 'member_demo_01'
  const member2 = 'member_demo_02'
  const product1 = 'product_demo_mask'
  const product2 = 'product_demo_essence'
  const productKit = 'product_demo_kit'
  const project1 = 'project_demo_clean'
  const project2 = 'project_demo_hydrate'
  const mp1 = 'mp_demo_01'
  const mp2 = 'mp_demo_02'
  const mp3 = 'mp_demo_03'
  const appt1 = 'appt_demo_01'

  const settings = DEFAULT_SETTINGS.map((s) => ({
    _id: id('settings'),
    ...s,
  }))

  // 演示默认：独立账号模式；打开积分方便看界面
  const patch = (key, value) => {
    const row = settings.find((s) => s.key === key)
    if (row) row.value = value
    else settings.push({ _id: id('settings'), key, value, category: 'demo' })
  }
  patch('account_mode', 'individual')
  patch('points_enabled', true)
  patch('points_earn_rate', 1)
  patch('points_redeem_rate', 100)
  patch('balance_enabled', true)
  patch('monthly_store_target', 50000)
  patch('monthly_staff_target', 8000)
  // 演示门店坐标（上海人民广场附近），与打卡假定位一致
  patch('store_lat', '31.2304')
  patch('store_lng', '121.4737')
  patch('checkin_radius', 200)
  patch('salary_formula', {
    高级: [{
      group_id: 'g1',
      group_name: '基础',
      multiplier: 1,
      group_op: '+',
      modules: [
        { id: 'm1', module: '底薪', op: '+', mode: 'fixed', value: 3000 },
        { id: 'm2', module: '次数计手工费', op: '+', mode: 'linked', linkType: 'checkout_count', linkedRate: 20, value: 0 },
      ],
    }],
    中级: [{
      group_id: 'g1',
      group_name: '基础',
      multiplier: 1,
      group_op: '+',
      modules: [
        { id: 'm1', module: '底薪', op: '+', mode: 'fixed', value: 2500 },
        { id: 'm2', module: '次数计手工费', op: '+', mode: 'linked', linkType: 'checkout_count', linkedRate: 15, value: 0 },
      ],
    }],
    初级: [{
      group_id: 'g1',
      group_name: '基础',
      multiplier: 1,
      group_op: '+',
      modules: [
        { id: 'm1', module: '底薪', op: '+', mode: 'fixed', value: 2000 },
      ],
    }],
  })

  const staff = [
    {
      _id: ownerId,
      name: '演示老板',
      account: 'demo',
      password_hash: 'demo123',
      role: 'owner',
      level: '高级',
      status: '在职',
      created_at: now,
    },
    {
      _id: staffAId,
      name: '小美',
      account: 'staff1',
      password_hash: '123456',
      role: 'staff',
      level: '高级',
      status: '在职',
      created_at: now,
    },
    {
      _id: staffBId,
      name: '小林',
      account: 'staff2',
      password_hash: '123456',
      role: 'staff',
      level: '中级',
      status: '在职',
      created_at: now,
    },
  ]

  const products = [
    {
      _id: product1,
      name: '补水面膜',
      barcode: '690000000001',
      sale_price: 128,
      purchase_price: 40,
      kit_components: [],
      created_at: now,
    },
    {
      _id: product2,
      name: '精华液',
      barcode: '690000000002',
      sale_price: 298,
      purchase_price: 90,
      kit_components: [],
      created_at: now,
    },
    {
      _id: productKit,
      name: '焕肤体验套盒',
      barcode: '690000000099',
      sale_price: 680,
      purchase_price: 200,
      kit_components: [
        { product_id: product1, qty: 2 },
        { product_id: product2, qty: 1 },
      ],
      created_at: now,
    },
  ]

  const projects = [
    {
      _id: project1,
      name: '深层清洁',
      category: '清洁类',
      price: 198,
      total_sessions: 1,
      max_sessions: 1,
      duration_min: 60,
      duration_minutes: 60,
      related_products: [product1],
      created_at: now,
    },
    {
      _id: project2,
      name: '补水护理',
      category: '补水类',
      price: 268,
      total_sessions: 5,
      max_sessions: 5,
      duration_min: 90,
      duration_minutes: 90,
      related_products: [product1, product2],
      created_at: now,
    },
  ]

  const members = [
    {
      _id: member1,
      name: '演示会员A',
      phone: '13800000001',
      points: 120,
      balance: 500,
      birthday: `${dayjs().format('MM-DD')}`,
      gender: '女',
      skin_type: '干性',
      allergy: '',
      notes: '演示数据',
      is_key: true,
      last_visit_at: today.subtract(3, 'day').toDate(),
      created_at: today.subtract(20, 'day').toDate(),
    },
    {
      _id: member2,
      name: '演示会员B',
      phone: '13800000002',
      points: 30,
      balance: 0,
      birthday: dayjs().add(2, 'day').format('MM-DD'),
      gender: '女',
      skin_type: '混合',
      allergy: '',
      notes: '',
      is_key: false,
      last_visit_at: today.subtract(40, 'day').toDate(),
      created_at: today.subtract(60, 'day').toDate(),
    },
  ]

  const member_projects = [
    {
      _id: mp1,
      member_id: member1,
      project_id: project2,
      project_name: '补水护理',
      product_id: product2,
      paid_amount: 268,
      total_sessions: 5,
      max_sessions: 5,
      used_sessions: 1,
      remaining_sessions: 4,
      fee_count: 1,
      status: 'active',
      purchased_at: today.subtract(10, 'day').toDate(),
      serial_number: 'DEMO-SN-001',
    },
    {
      _id: mp2,
      member_id: member1,
      project_id: project1,
      project_name: '深层清洁',
      product_id: product1,
      paid_amount: 198,
      total_sessions: 1,
      max_sessions: 1,
      used_sessions: 0,
      remaining_sessions: 1,
      fee_count: 1,
      status: 'active',
      purchased_at: today.subtract(5, 'day').toDate(),
      serial_number: 'DEMO-SN-002',
    },
    {
      _id: mp3,
      member_id: member2,
      project_id: project1,
      project_name: '深层清洁',
      product_id: product1,
      paid_amount: 198,
      total_sessions: 1,
      max_sessions: 1,
      used_sessions: 0,
      remaining_sessions: 1,
      fee_count: 1,
      status: 'active',
      purchased_at: today.subtract(2, 'day').toDate(),
      serial_number: 'DEMO-SN-003',
    },
  ]

  const appointments = [
    {
      _id: appt1,
      member_id: member1,
      therapist_id: staffAId,
      project_name: '补水护理',
      project_ids: [project2],
      project_names: ['补水护理'],
      member_project_id: mp1,
      booking_code: '0001',
      scheduled_time: today.hour(10).minute(0).second(0).toDate(),
      duration_min: 90,
      status: 'confirmed',
      created_at: now,
      member_name: '演示会员A',
    },
  ]

  const inventory = [
    {
      _id: id('inv'),
      product_id: product1,
      quantity: 20,
      purchase_price: 40,
      created_at: today.subtract(30, 'day').toDate(),
    },
    {
      _id: id('inv'),
      product_id: product2,
      quantity: 12,
      purchase_price: 90,
      created_at: today.subtract(20, 'day').toDate(),
    },
  ]

  // 近两周销售 + 手工费，供老板看板 / 员工收益
  const transactions = []
  const prices = [
    { product_id: product1, product_name: '补水面膜', barcode: '690000000001', price: 128 },
    { product_id: product2, product_name: '精华液', barcode: '690000000002', price: 298 },
  ]
  for (let d = 0; d < 18; d++) {
    const day = today.subtract(d, 'day')
    if (day.day() === 0) continue
    const therapist = d % 2 === 0 ? staffAId : staffBId
    const member = d % 3 === 0 ? member2 : member1
    const p = prices[d % 2]
    const sn = `DEMO-SN-${String(100 + d)}`
    transactions.push({
      _id: id('txn'),
      type: 'purchase',
      member_id: member,
      therapist_id: therapist,
      product_id: p.product_id,
      product_name: p.product_name,
      barcode: p.barcode,
      product_price: p.price,
      serial_number: sn,
      payment_methods: [{ method: d % 2 === 0 ? '扫码' : '现金', amount: p.price }],
      operated_at: day.hour(11 + (d % 4)).minute(15).toDate(),
      is_fee: false,
    })
    if (d % 2 === 0) {
      transactions.push({
        _id: id('txn'),
        type: 'checkout',
        member_id: member,
        therapist_id: therapist,
        project_name: d % 4 === 0 ? '补水护理' : '深层清洁',
        fee_count: 1,
        product_price: 0,
        is_fee: true,
        fee_base: d % 4 === 0 ? 53.6 : 198,
        fee_paid_amount: d % 4 === 0 ? 268 : 198,
        fee_total_sessions: d % 4 === 0 ? 5 : 1,
        fee_product_id: d % 4 === 0 ? product2 : product1,
        operated_at: day.hour(15).minute(30).toDate(),
      })
    }
  }

  // 本月考勤 + 打卡（小美/小林）
  const punch_records = []
  const attendance_records = []
  const shift_schedules = []
  for (let d = 0; d < 12; d++) {
    const day = today.subtract(d, 'day')
    if (day.day() === 0) continue
    const dateStr = day.format('YYYY-MM-DD')
    for (const staffId of [staffAId, staffBId]) {
      const isMei = staffId === staffAId
      const clockIn = day.hour(isMei ? 9 : 14).minute(isMei ? 2 : 5).toDate()
      const clockOut = day.hour(isMei ? 13 : 20).minute(isMei ? 5 : 0).toDate()
      punch_records.push(
        {
          _id: id('punch'),
          staff_id: staffId,
          type: '上班',
          punched_at: clockIn,
          date: dateStr,
          location: { lat: 31.2304, lng: 121.4737, address: '演示门店', distance: 15 },
          location_status: 'ok',
          created_at: clockIn,
        },
        {
          _id: id('punch'),
          staff_id: staffId,
          type: '下班',
          punched_at: clockOut,
          date: dateStr,
          location: { lat: 31.2304, lng: 121.4737, address: '演示门店', distance: 18 },
          location_status: 'ok',
          created_at: clockOut,
        },
      )
      attendance_records.push({
        _id: id('att'),
        staff_id: staffId,
        date: dateStr,
        clock_in: clockIn,
        clock_out: clockOut,
        actual_shift: isMei ? 'morning' : 'evening',
        status: '正常',
        planned_shift: isMei ? 'morning' : 'evening',
      })
      shift_schedules.push({
        _id: id('shift'),
        staff_id: staffId,
        date: dateStr,
        shift: isMei ? 'morning' : 'evening',
      })
    }
  }

  // 今日小美已上班（方便看板看到当天）
  if (!punch_records.some((p) => p.staff_id === staffAId && p.date === today.format('YYYY-MM-DD') && p.type === '上班')) {
    // loop above already covers today if not Sunday
  }

  return {
    [COLLECTIONS.SETTINGS]: settings,
    [COLLECTIONS.STAFF]: staff,
    [COLLECTIONS.PRODUCTS]: products,
    [COLLECTIONS.PROJECTS]: projects,
    [COLLECTIONS.MEMBERS]: members,
    [COLLECTIONS.MEMBER_PROJECTS]: member_projects,
    [COLLECTIONS.INVENTORY]: inventory,
    [COLLECTIONS.APPOINTMENTS]: appointments,
    [COLLECTIONS.TRANSACTIONS]: transactions,
    [COLLECTIONS.PUNCH_RECORDS]: punch_records,
    [COLLECTIONS.ATTENDANCE_RECORDS]: attendance_records,
    [COLLECTIONS.SHIFT_SCHEDULES]: shift_schedules,
    [COLLECTIONS.SHIFT_ROTATIONS]: [],
    [COLLECTIONS.OPERATION_LOGS]: [],
    [COLLECTIONS.POINTS_RECORDS]: [],
    [COLLECTIONS.BALANCE_RECORDS]: [],
    [COLLECTIONS.NOTIFICATIONS]: [],
    [COLLECTIONS.RECALL_TASKS]: [],
    [COLLECTIONS.GIFT_MATERIALS]: [],
    [COLLECTIONS.GIFT_RECORDS]: [],
    [COLLECTIONS.CONSUMABLES]: [],
  }
}

export const DEMO_LOGIN_HINT = { account: 'demo', password: 'demo123' }
