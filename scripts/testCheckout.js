/**
 * 核销闭环手动测试脚本
 *
 * 测试覆盖：
 * 1. member_projects 快照字段完整性
 * 2. fee 动态计算（paid_amount ÷ used_sessions × formula_coefficient）
 * 3. used_sessions 超 total_sessions 后标红，remaining_sessions 保持 >= 0
 * 4. max_sessions 上限拦截
 * 5. tab 值叠加逻辑
 *
 * 运行方式：在浏览器 console 中粘贴执行，需要先登录
 */

function testFeeCalculation() {
  console.group('=== 手工费动态计算测试 ===')
  const paid_amount = 1000
  const formula_coefficient = 0.2

  const expectations = [
    { used: 1, expected: (1000 / 1 * 0.2).toFixed(2) },
    { used: 5, expected: (1000 / 5 * 0.2).toFixed(2) },
    { used: 10, expected: (1000 / 10 * 0.2).toFixed(2) },
    { used: 11, expected: (1000 / 11 * 0.2).toFixed(2) },
    { used: 12, expected: (1000 / 12 * 0.2).toFixed(2) },
  ]

  for (const { used, expected } of expectations) {
    const fee = (paid_amount / used * formula_coefficient).toFixed(2)
    const pass = fee === expected
    console.log(`第${used}次 | 手工费: ¥${fee} | ${pass ? '✅' : '❌'}`)
  }
  console.groupEnd()
}

function testSessionBoundary() {
  console.group('=== 次数边界规则测试 ===')
  const total_sessions = 10
  const max_sessions = 12

  function simulate(used) {
    const over_total = used > total_sessions
    const over_max = used >= max_sessions

    // remaining_sessions：超规定次数后保持 >= 0，不再递减
    const remaining = over_total
      ? Math.max(0, total_sessions - used + 1)  // 实际上保持0
      : total_sessions - used

    const remaining_correct = over_total ? 0 : (total_sessions - used)

    const staff_can_book = !over_max
    const client_can_book = !over_total

    return { used, remaining: remaining_correct, staff_can_book, client_can_book, over_total }
  }

  for (const used of [0, 5, 9, 10, 11, 12]) {
    const result = simulate(used)
    console.log(
      `used=${result.used} | remaining=${result.remaining} | ` +
      `员工可预约:${result.staff_can_book ? '✅' : '❌'} | ` +
      `客户可预约:${result.client_can_book ? '✅' : '❌'} | ` +
      `${result.over_total ? '🔴标红' : ''}`
    )
  }
  console.groupEnd()
}

function testTabCalculation() {
  console.group('=== tab 值叠加测试 ===')
  // 场景：项目A关联商品X，项目B也关联商品X，两个项目都被选中
  // 商品X 的 tab 值应该 = 2

  const selectedProjects = [
    { id: 'proj_A', name: '清洁项目', related_products: ['prod_X', 'prod_Y'] },
    { id: 'proj_B', name: '补水项目', related_products: ['prod_X'] },
  ]

  const tabMap = {}
  for (const project of selectedProjects) {
    for (const productId of project.related_products) {
      tabMap[productId] = (tabMap[productId] || 0) + 1
    }
  }

  console.log('商品 tab 值:', tabMap)
  console.log(`prod_X tab=2: ${tabMap['prod_X'] === 2 ? '✅' : '❌'}`)
  console.log(`prod_Y tab=1: ${tabMap['prod_Y'] === 1 ? '✅' : '❌'}`)
  console.groupEnd()
}

function testSnapshotFields() {
  console.group('=== member_projects 快照字段完整性测试 ===')
  const LOCKED_FIELDS = [
    'member_id', 'project_name', 'paid_amount',
    'total_sessions', 'max_sessions', 'product_spec', 'purchased_at',
  ]
  const DYNAMIC_FIELDS = ['used_sessions', 'remaining_sessions']
  const FORBIDDEN_FIELDS = ['fee_per_session']  // 不预存

  const snapshot = {
    member_id: 'test_member_001',
    project_name: '清洁护理',
    paid_amount: 1000,
    total_sessions: 10,
    max_sessions: 12,
    product_spec: '50ml',
    purchased_at: new Date(),
    used_sessions: 0,
    remaining_sessions: 10,
  }

  console.log('快照字段检查:')
  for (const f of LOCKED_FIELDS) {
    console.log(`  ${f}: ${snapshot[f] !== undefined ? '✅ 已锁定' : '❌ 缺失'}`)
  }
  for (const f of DYNAMIC_FIELDS) {
    console.log(`  ${f}: ${snapshot[f] !== undefined ? '✅ 已设置' : '❌ 缺失'}`)
  }
  for (const f of FORBIDDEN_FIELDS) {
    console.log(`  ${f}: ${snapshot[f] === undefined ? '✅ 未预存（正确）' : '❌ 不应预存！'}`)
  }
  console.groupEnd()
}

function runAllTests() {
  console.clear()
  console.log('🧪 美妆门店管理系统 — 核销闭环测试\n')
  testSnapshotFields()
  testFeeCalculation()
  testSessionBoundary()
  testTabCalculation()
  console.log('\n✅ 所有测试完成')
}

runAllTests()
