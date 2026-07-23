# 美妆门店管理系统 · Demo · CLAUDE.md

> **本仓为独立演示版**：始终本地内存库（`src/demo/`），不连 CloudBase。生产仓见同组织 `Beauty-Retail-Management-System`。

## 产品概述

面向中小型美妆门店（1-10名员工）的一体化管理工具，覆盖预约调度、手工核销、销售收款、会员管理、员工薪酬结算五大场景。

**完整规格见 PRD_v0.8.md（v1.2，2026-06-08）**。本文件是开发快速上下文，侧重规则和注意事项，不重复 PRD 中的完整描述。

---

## 技术栈

| 项目 | 版本 / 说明 |
|------|------------|
| React | ^19.2.6 |
| Vite | ^8.0.12 |
| Tailwind CSS | **v3**（^3.4.19，非 v4） |
| React Router | v7，HashRouter |
| Zustand | ^5.0.13（with persist） |
| 数据层 | `src/demo/memoryDb.js`（localStorage），无 CloudBase |
| dayjs | ^1.11.20 |
| Recharts | ^3.8.1（老板看板图表） |
| xlsx | ^0.18.5（批量导入导出） |
| @zxing/browser | ^0.2.0（摄像头扫码，1500ms 防抖） |

**本地开发**：`npm run dev` → http://localhost:5174  
**演示账号**：`demo` / `demo123`；预约号 `0001`

---

## 目录结构

```
src/
├── App.jsx                    ← HashRouter + 路由表
├── main.jsx
├── lib/
│   ├── cloudbase.js           ← CloudBase 初始化，导出 db / auth / storage
│   ├── collections.js         ← 所有集合名常量（COLLECTIONS 对象）
│   ├── settings.js            ← DEFAULT_SETTINGS（初始化时写入 /setup）
│   └── db/index.js            ← 数据访问层：fetchAll() 统一分页（替代手写 while 循环）
├── domain/                    ← 业务规则纯函数（无 db / 无 React，可单测）
│   └── fee.js                 ← 手工费 computeFee / FIFO 扣次 buildFifoDeductions / deductionsToPlan
├── store/
│   ├── cacheStore.js          ← Zustand persist；静态数据缓存（settings/products/projects/staff）
│   └── authStore.js           ← 登录状态 + activeStaff（shared 模式用）
├── hooks/
│   ├── usePermission.js       ← isOwner / canEditSettings / canManageSettings 等
│   └── useOperator.js         ← operatorId/Name/Level，区分 individual/shared 账号模式
├── utils/
│   ├── attendance.js          ← 考勤状态推算逻辑
│   ├── memberTags.js          ← getMemberTags / computeTxnAggregates / TAG_STYLES / ALL_TAGS
│   ├── operationLog.js        ← writeLog()，写 operation_logs 集合
│   ├── serialNumber.js        ← 整单流水号生成
│   ├── bookingCode.js         ← 预约号生成（手机后4位，冲突+1位）
│   ├── timeSlots.js           ← 时间槽工具
│   ├── array.js               ← toArray()（CloudBase 对象格式→数组）
│   ├── validators.js
│   ├── excelImport.js
│   ├── notification.js
│   └── uploadFile.js          ← CloudBase Storage 上传
├── components/
│   ├── EarningsPanel.jsx      ← 员工收益面板（员工看板 + /staff-earnings 共用）
│   ├── AttendanceCalendar.jsx
│   ├── BatchImport.jsx
│   ├── NotificationPanel.jsx  ← 首页右侧消息 drawer
│   ├── OperationLogPanel.jsx
│   ├── OperatorSelector.jsx   ← shared 模式选人底部弹窗
│   ├── ProtectedRoute.jsx
│   └── TimeGrid.jsx           ← 预约时间栅格
└── pages/
    ├── Login/          ← /login
    ├── Setup/          ← /setup（首次初始化）
    ├── Home/           ← /（首页）
    ├── Appointment/    ← /appointment + /appointment/success
    ├── Checkout/       ← /checkout（手工登记）+ /checkout/detail（核销详情）
    ├── Sales/          ← /sales + /sales/success
    ├── Schedule/       ← /schedule（员工看板：日程/考勤/收益）
    ├── Dashboard/      ← /dashboard（老板看板，owner专属）
    ├── StaffEarnings/  ← /staff-earnings（员工个人业绩，owner专属）
    ├── Punch/          ← /punch + /punch/detail
    ├── Shift/          ← /shift（排班月历）
    ├── Refund/         ← /refund
    └── Settings/       ← /settings/*
        ├── index.jsx                  ← 10个折叠面板 + 入口网格
        ├── ProjectManagement/
        ├── ProductManagement/
        ├── InventoryManagement/
        ├── MemberManagement/
        │   ├── index.jsx             ← 会员列表 + 标签筛选
        │   └── MemberDetail.jsx      ← 会员详情（项目/积分/余额历史 Tab）
        ├── StaffManagement/
        ├── PromoManagement/
        ├── TransactionManagement/
        ├── MiniprogramContent/
        └── MaterialManagement/       ← 物料管理（赠品物料 + 消耗品）
            └── index.jsx
```

---

## 五条核心规则（不可违反）

1. **settings 表驱动**：所有可配置数值从 `useCacheStore().getSetting(key, default)` 读取，不硬编码
2. **手工费动态计算**：核销时实时算 `paid_amount ÷ max(usedAfter, total_sessions) × formula_coefficient`，不预存 fee
3. **member_projects 是快照表**：购买时锁定字段（paid_amount / total_sessions 等），模板改动不影响存量
4. **单一 Web 应用，role 区分权限**：staff / owner，非双端；权限逻辑用 `usePermission()` hook
5. **缓存分层**：
   - 启动时拉取一次，保存设置后按需刷新：`settings / products / projects / staff`
   - 实时读写云端：`appointments / members / member_projects / transactions / inventory`

---

## 数据库集合速查

| 集合 | 说明 |
|------|------|
| settings | key-value 全局配置（10个折叠面板） |
| staff | 员工表，role: staff/owner，level: 高级/中级/初级 |
| products | 商品目录；kit_components 非空则为套盒 |
| projects | 项目模板；related_products 需 toArray() |
| members | 会员；balance（储值余额）；last_visit_at（最近到店） |
| member_projects | 会员项目快照，购买时锁定，核销时更新次数 |
| shift_schedules | 排班表 |
| shift_rotations | 轮班周期配置 |
| punch_records | 原始打卡记录（上班/下班/学习），含照片和GPS |
| attendance_records | 考勤日报，study_punched_at 学习打卡 |
| inventory | 库存，purchase_price 仅老板可见 |
| appointments | 预约，booking_code：手机后4位（冲突则+1位变5位） |
| transactions | 消费记录；is_fee=true 为手工费条目；type: checkout/purchase/refund |
| operation_logs | 操作日志，嵌入商品/库存/会员库管理页展示 |
| points_records | 积分明细，type: earn/redeem |
| notifications | 消息通知（预约/库存），最多50条 |
| balance_records | 储值变动明细，type: topup/deduct |
| gift_materials | 赠品物料库存 |
| gift_records | 赠品发放记录（关联 gift_materials + members） |
| consumables | 耗材消耗品，used_up_at 标记已用完 |

> CloudBase 存储数组会序列化为 `{"0":"id","1":"id"}` 对象格式，**读取时必须用 `toArray()`**。

---

## settings key 速查

| 面板 | key | 默认值 |
|------|-----|--------|
| ① 排班与预约 | morning_shift_start/end | 09:00 / 13:00 |
| ① 排班与预约 | evening_shift_start/end | 14:00 / 20:00 |
| ① 排班与预约 | slot_duration | 30 |
| ① 排班与预约 | max_clients_per_slot | 2 |
| ① 排班与预约 | max_booking_days_ahead | 30 |
| ② 薪酬计算 | formula_coefficient | 0.2 |
| ② 薪酬计算 | salary_formula | JSON（按等级分组公式） |
| ③ 会员字段配置 | member_fields | {birthday,gender,skin_type,allergy,notes} |
| ④ 商品配置 | enable_product_category | false |
| ⑤ 本月目标 | monthly_store_target / monthly_staff_target | 0 |
| ⑥ 积分设置 | points_enabled / points_earn_rate / points_redeem_rate | false / 1 / 100 |
| ⑦ 打卡与定位 | amap_web_key / store_lat / store_lng / checkin_radius | "" / "" / "" / 200 |
| ⑧ 账号模式 | account_mode | "individual" |
| ⑨ 会员标签阈值 | tag_high_freq_min / tag_big_spender_min / tag_dormant_days / tag_new_days | 4 / 3000 / 30 / 30 |
| ⑩ 储值卡 | balance_enabled / balance_topup_tiers | false / [] |
| ⑪ 悬浮键盘 | floating_keyboard_enabled | false |
| ⑫ 核销设置 | checkout_max_per_item / checkout_max_projects / allow_over_checkout | 2 / 0(不限) / true |

> 核销次数口径：手工费、薪酬（项目计手工费、次数计手工费）、手工次数展示均按 `fee_count`（单次消耗次数）计；`allow_over_checkout=false` 时核销页隐藏「超核销」、项目管理隐藏「最多手工次数」并自动 = 规定次数。

---

## 权限设计关键差异

- **老板（owner）**：所有功能；进货价可见；Settings 10个折叠面板；老板看板
- **高级员工**：看商品/库存/会员库/排班（编辑受限）；不可见 Settings 折叠面板；不可见老板看板；员工看板-日程看全员
- **普通员工**：员工看板-日程仅看自己；不可进 /settings（菜单入口不显示）
- **退款**：所有员工均可操作
- **Settings 入口**：老板 + 高级员工可见（首页顶部栏），但折叠面板仅老板可访问
- **物料管理**：老板/高级员工可访问；编辑/删除操作仅老板

---

## 手工费公式

```
分母 = max(核销后 used_sessions, primarySnap.total_sessions)
fee  = paid_amount ÷ 分母 × formula_coefficient
```

核销时写入 transactions 的额外字段（供薪酬公式用）：
- `is_fee: true`、`fee_base`（paid_amount ÷ 分母）
- `fee_paid_amount`（快照实付）、`fee_total_sessions`（快照规定次数）、`fee_product_id`

---

## 薪酬公式模块（salary_formula）

salary_formula 结构：`{ 高级: Group[], 中级: Group[], 初级: Group[] }`

```
Group: { group_id, group_name, multiplier, group_op(+/-/×/÷), modules: Module[] }
Module: { id, module, op, mode(fixed/linked), value, linkType, linkedProductIds[],
          linkedLabel, linkedRate, denominatorType('max'|'total_sessions') }
```

16 种模块（type）：底薪(fixed_monthly) / 次数计手工费(auto_fee) / 项目计手工费(auto_project_fee_base) / 员工本月销售总额(auto_sales_amount) / 商品销售数量(auto_sales_count) / 货物管理费 / 账目管理费 / 员工管理费 / 手机费 / 满勤 / 目标激励 / 餐补 / 拓客人数(count_rate) / 回店留存客人数(count_rate) / 人数(count_rate) / 学习打卡次数(count_rate)

旧扁平格式（Module[]）由 `normalizeGroups()` 自动升级为单组结构，不需手动处理。

---

## 会员标签规则（src/utils/memberTags.js）

| 标签 | 颜色 | 判定 |
|------|------|------|
| 新客 | 绿 | created_at 距今 ≤ tag_new_days 天 |
| 高频客 | 蓝 | 近3个月 checkout 月均次数 ≥ tag_high_freq_min |
| 大客户 | 紫 | 累计 purchase 消费 ≥ tag_big_spender_min 元 |
| 沉睡客 | 橙 | 非新客 且 last_visit_at 为空或距今 ≥ tag_dormant_days 天 |

标签不互斥（除新客与沉睡客互斥）。调用：`getMemberTags(member, txnAggregates, getSetting)`。

---

## 储值卡规则

- `balance_enabled=false` 时，所有余额相关 UI 全部隐藏
- 充值赠送：取满足 min_amount 的最高档，bonus = amount × bonus_rate / 100；到账 = amount + bonus
- 抵扣顺序：积分优先 → 余额次之
- 每次充值/抵扣写 balance_records + 更新 members.balance

---

## 开发注意事项

1. **CloudBase 分页**：单次最多返回 100 条，大集合用 `fetchAll()` 循环分页（cacheStore.js 中已封装）。

2. **套盒商品**：`products.kit_components` 非空则为套盒。销售时不为套盒整体创建 member_projects，而是按子商品逐件创建，`paid_amount = 套盒实付 ÷ 总件数`。

3. **共享账号模式（shared）**：操作人用 `useOperator()` 返回的 `operatorId/operatorName/operatorLevel`，不要直接用 `authStore.user`。权限（role/level）始终基于登录账号，不受 activeStaff 影响。

4. **积分不分摊到 paid_amount**：积分抵扣是营销成本，不影响手工费基数；余额抵扣同理。

5. **remaining_sessions 可为负数**：无下界保护，不要加 `Math.max(0, ...)`。

6. **满减递进公式**：`floor(参与满减商品合计 ÷ 门槛) × 减免金额`，折扣商品（非10折）排除出满减合计。

7. **整单流水号**：同一笔销售所有商品共用一个 `serial_number`（用 `serialNumber.js` 生成），不再每件单独生成。

8. **退款**：写 `type=refund` transaction（product_price 为负），`refund_ref_id` 指向原始记录；同步恢复库存（追加到最新批次）；将对应 member_projects.status 改为 `refunded`。

9. **操作日志**：用 `writeLog(module, action)` 写入，嵌入商品/库存/会员库管理页展示；不是独立页面。

10. **分层约定（重构进行中）**：
    - 分页拉全量用 `fetchAll(collection, where, shape?)`（`lib/db`），不要手写 while 循环。
    - 业务计算（手工费、FIFO 扣次等）放 `domain/`，写成纯函数，组件只调用；新增同类规则（套盒拆分、满减、积分/余额抵扣）后续陆续迁入 `domain/`，已迁移的不要再在组件内复制。

---

## 快速启动

```bash
cd "/Users/wyd/Beauty Retail Management System"
npm install
npm run dev
# → http://localhost:5174
```

首次使用访问 `/setup` 创建 owner 账号并初始化 settings 表。
