# 美妆门店管理系统
## 产品需求文档（PRD）
### Beauty Salon Management System

**版本 v1.3 · 2026年7月（新增三项 AI 智能功能，2026-07-03）**  
**文档状态：在研 | 面向：Claude Code 开发**

> 📌 **v1.3 更新摘要**：新增三项基于 DeepSeek 的 AI 智能功能——① AI 流失预警与主动召回；② 经营异常周报/月报；③ 员工经营异常检测。均为增量开发，DeepSeek 缺省时走规则模板兜底。详见 §7A「AI 智能功能」。

---

## 1. 产品概述

### 1.1 产品背景

线下美妆门店当前依赖电话/微信进行预约，员工接待客户时频繁被打断，导致销售与服务效率双双下降。门店老板无法掌握员工实际服务次数，手工费结算缺乏数据支撑。客户购买的含产品套餐（如10次清洁项目）缺乏数字化追踪，耗材使用完全依赖人工记录。

### 1.2 产品定位

面向中小型美妆门店（1-10名员工）的一体化管理 SaaS 工具，覆盖预约调度、核销记录、销售收款、耗材追踪、员工手工费结算五大核心场景。

### 1.3 目标用户

| 角色 | 使用端 | 核心诉求 |
|------|--------|----------|
| 门店老板 | 员工Web端（完整权限） | 掌控员工手工费、耗材消耗、会员数据、经营看板 |
| 美容师/员工 | 员工Web端（只读权限） | 查看排班、预约、快速核销 |
| 会员/客户 | 微信小程序 | 自助预约、查看项目余次、接收通知 |

---

## 2. 技术架构

### 2.1 技术选型

| 层级 | 选型 | 说明 |
|------|------|------|
| 前端（员工端） | React + Vite | Web 页面，PC 端操作为主 |
| 前端（客户端） | 微信小程序 | 微信生态，客户自助预约 |
| 后端 / 数据库 | 腾讯云 CloudBase | 云函数 + 实时数据库，微信生态打通 |
| 身份验证 | CloudBase 自定义登录 | 账号密码，每日验证（loginDate 存 localStorage，次日自动失效） |
| 消息推送 | 微信订阅消息 | 核销后推送会员通知（待实现） |
| 全局状态管理 | Zustand | 缓存项目/商品/员工/settings 数据 |

### 2.2 数据同步架构与分层策略

所有端（员工Web、客户小程序）读写同一 CloudBase 云数据库，无本地主数据。

**数据分层策略：**

- **本地缓存（启动时加载，修改后按需刷新）**：projects、products、staff、settings
- **实时读写云端**：appointments、members、member_projects、transactions、inventory
- **缓存刷新触发时机**：系统启动时全量拉取；老板在设置页保存后触发对应表刷新；无需定时器

### 2.3 数据库表结构

#### ① settings（全局配置表）

key-value 结构，UI 按十个折叠面板展示，仅老板可编辑。

| 分类 | 字段 key | 默认值 | 说明 |
|------|----------|--------|------|
| ① 排班与预约 | morning_shift_start / end | 09:00 / 13:00 | 早班上下班时间 |
| ① 排班与预约 | evening_shift_start / end | 14:00 / 20:00 | 晚班上下班时间 |
| ① 排班与预约 | slot_duration | 30 | 预约时间粒度（分钟） |
| ① 排班与预约 | max_clients_per_slot | 2 | 每位美容师同时最大接待人数 |
| ① 排班与预约 | max_booking_days_ahead | 30 | 最远可预约天数 |
| ② 薪酬计算 | formula_coefficient | 0.2 | 手工费系数 |
| ② 薪酬计算 | salary_formula | JSON结构 | 按员工等级配置的工资公式；结构见下方说明 |
| ③ 会员字段配置 | member_fields | JSON对象 | 可配置字段开关：生日/性别/肤质/过敏史/备注 |
| ④ 商品配置 | enable_product_category | false | 商品分类开关 |
| ④ 商品配置 | enable_points_product | false | 积分商品开关（MVP不启用） |
| ⑤ 本月目标 | monthly_store_target | 0 | 店铺本月销售目标（金额） |
| ⑤ 本月目标 | monthly_staff_target | 0 | 员工本月销售目标（金额，薪酬目标激励判断基准） |
| ⑥ 积分设置 | points_enabled | false | 积分功能总开关 |
| ⑥ 积分设置 | points_earn_rate | 1 | 每消费 ¥1 获得 N 分 |
| ⑥ 积分设置 | points_redeem_rate | 100 | X 分 = ¥1 抵扣 |
| ⑦ 打卡与定位 | amap_web_key | "" | 高德 Web API Key，用于逆地理编码（地址解析） |
| ⑦ 打卡与定位 | store_lat | "" | 门店纬度（高德坐标系） |
| ⑦ 打卡与定位 | store_lng | "" | 门店经度（高德坐标系） |
| ⑦ 打卡与定位 | checkin_radius | 200 | 打卡允许范围（米），超出则拒绝打卡 |
| ⑧ 账号模式 | account_mode | "individual" | `individual`（每人各自账号）/ `shared`（共享设备，操作前选人） |
| ⑨ 会员标签阈值 | tag_high_freq_min | 4 | 高频客：近3个月月均核销次数 ≥ N 次 |
| ⑨ 会员标签阈值 | tag_big_spender_min | 3000 | 大客户：历史累计消费 ≥ N 元 |
| ⑨ 会员标签阈值 | tag_dormant_days | 30 | 沉睡客：距最近到店 ≥ N 天（且非新客） |
| ⑨ 会员标签阈值 | tag_new_days | 30 | 新客：会员注册后 ≤ N 天 |
| ⑩ 储值卡 | balance_enabled | false | 储值卡（余额）功能总开关 |
| ⑩ 储值卡 | balance_topup_tiers | [] | 充值档位：`[{min_amount, bonus_rate%}]`，充值≥min_amount 则按 bonus_rate% 赠送 |
| ⑪ AI 召回 | recall_daily_limit | 9 | 每日召回任务生成上限（< 10） |
| ⑪ AI 召回 | recall_contact_cooldown_days | 7 | 「已联系」后冷却天数，冷却期内不再重复生成 |
| ⑪ AI 召回 | deepseek_api_key | "" | DeepSeek API Key（三项 AI 功能共用；也可用 .env 的 VITE_DEEPSEEK_API_KEY） |
| ⑪ AI 召回 | last_recall_scan_date | "" | 上次召回扫描日期（YYYY-MM-DD），当日仅扫描一次 |
| ⑫ 经营报告 | business_report_enabled | true | 经营异常周报/月报总开关（缺省视为开启） |
| ⑫ 经营报告 | anomaly_sales_pct_threshold | 20 | 销售额偏离基线均值阈值（%） |
| ⑫ 经营报告 | anomaly_aov_pct_threshold | 20 | 客单价偏离基线均值阈值（%） |
| ⑫ 经营报告 | anomaly_refund_pct_threshold | 50 | 退款率较基线增幅阈值（%） |
| ⑫ 经营报告 | last_weekly_report_date | "" | 上次周报目标周期 key（周一 YYYY-MM-DD） |
| ⑫ 经营报告 | last_monthly_report_date | "" | 上次月报目标周期 key（YYYY-MM） |
| ⑫ 经营报告 | weekly_report_snapshot | null | 周报快照（含 AI Markdown） |
| ⑫ 经营报告 | monthly_report_snapshot | null | 月报快照（含 AI Markdown） |
| ⑬ 员工异常 | staff_anomaly_enabled | true | 员工经营异常检测总开关 |
| ⑬ 员工异常 | staff_discount_personal_threshold | 10 | 个人折扣低于自身近30天均值的阈值（%） |
| ⑬ 员工异常 | staff_discount_store_threshold | 15 | 个人折扣低于全店均值的阈值（%） |
| ⑬ 员工异常 | staff_refund_multiplier_threshold | 2 | 退款率高于个人历史均值的倍数阈值 |
| ⑬ 员工异常 | staff_low_discount_zhe | 7 | 低折扣抽查线（折），统计低于该折的订单笔数 |
| ⑬ 员工异常 | staff_min_purchase_orders | 5 | 最少成交笔数，不足则跳过折扣/退款检测 |
| ⑬ 员工异常 | last_staff_anomaly_date | "" | 上次员工异常目标周期 key（YYYY-MM） |
| ⑬ 员工异常 | staff_anomaly_snapshot | null | 员工异常快照 |

#### ② staff（员工表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| name | string | 员工姓名 |
| account | string | 登录账号 |
| password_hash | string | 密码（明文存储，字段名保留 password_hash） |
| role | enum | staff / owner |
| level | string | 员工等级（高级 / 中级 / 初级） |
| status | enum | 在职 / 离职 |
| created_at | timestamp | 创建时间 |

#### ③ products（商品目录）

> 📌 MVP 暂缓：积分商品（is_points_product 字段保留但不启用相关逻辑）；会员价字段已删除。

| 字段 | 类型 | 权限 | 说明 |
|------|------|------|------|
| id | string | 全部 | 主键 |
| name | string | 全部 | 商品名称 |
| category | string | 全部 | 商品分类（settings开关控制是否显示） |
| type | string | 全部 | 商品类型（可选） |
| spec | string | 全部 | 规格（如 50ml） |
| barcode | string | 全部 | 条形码（扫码销售用） |
| purchase_price | number | 仅老板 | 进货价 |
| sale_price | number | 全部 | 销售价 |
| is_points_product | boolean | 仅老板 | 是否为积分商品（MVP不启用，默认false） |
| exclude_from_sales | boolean | 老板 | 不计入业绩（true 时该商品销售额从员工销售总额统计中排除） |
| kit_components | array | 全部 | 套盒子商品列表，格式 `[{product_id, qty}]`；数组非空则视为套盒 |
| created_at | timestamp | 全部 | 创建时间 |

> 📌 **套盒（kit）规则**：`kit_components` 非空时，该商品为套盒。销售确认时，系统不为套盒整体创建 member_projects 快照，而是按 `kit_components` 逐件拆解，为每个子商品各自创建快照，`paid_amount = 套盒实付金额 ÷ 子商品总件数`。核销时直接消耗子商品快照，逻辑无需改动。

#### ④ projects（项目模板）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| name | string | 项目名称 |
| category | string | 大类（清洁类/补水类等） |
| duration_min | number | 单次时长（分钟） |
| total_sessions | number | 规定次数 |
| max_sessions | number | 最多手工次数（>= total_sessions） |
| price | number | 正常售价（模板参考价） |
| promo_price | number | 促销价（可空） |
| efficacy | string | 项目功效描述 |
| related_products | array | 关联商品 ID 列表 |
| created_at | timestamp | 创建时间 |

> 📌 CloudBase 存储数组时会序列化为 `{"0":"id","1":"id"}` 对象格式，前端读取时需通过 `toArray()` 工具函数转换。

> 📌 **salary_formula 数据结构（v0.6 更新）**：
> ```
> { 高级: Group[], 中级: Group[], 初级: Group[] }
> Group: { group_id, group_name, multiplier, group_op(+/-/×/÷), modules: Module[] }
> Module: {
>   id, module(模块名), op(+/-/×/÷),
>   mode(fixed/linked),
>   value(固定金额), linkType, linkedProductIds[], linkedLabel, linkedRate,
>   // 仅「项目计手工费」模块：
>   denominatorType('max'|'total_sessions')
> }
> ```
> - `group_op`：组与组之间的运算符（+/-/×/÷），缺省为 +
> - `op`：组内模块间的运算符（+/-/×/÷），第一个模块值作为初始值
> - 旧扁平格式（Module[]）由 normalizeGroups() 自动升级为单组结构

> 📌 max_sessions 规则：客户端超过 total_sessions 不可预约；员工端超过 max_sessions 不可预约；used_sessions 超过 total_sessions 后标红，remaining_sessions 不再递减（保持 >= 0）。

#### ⑤ members（会员）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| name | string | 姓名（不可删） |
| phone | string | 手机号（不可删） |
| openid | string | 微信 openid（小程序关联） |
| birthday | string | 生日（settings开关控制） |
| gender | string | 性别（settings开关控制） |
| skin_type | string | 肤质（settings开关控制） |
| allergy | string | 过敏史（settings开关控制） |
| notes | string | 备注（settings开关控制） |
| points | number | 积分余额（积分体系启用时使用，默认0） |
| balance | number | 储值余额（储值卡启用时使用，默认0） |
| last_visit_at | timestamp | 最近到店时间（核销时同步更新，用于沉睡客标签计算） |
| created_at | timestamp | 创建时间 |

#### ⑥ member_projects（会员项目快照）

**创建时机：**
1. **销售收款时自动生成**（主路径）：员工关联项目后确认收款，系统自动写入。
2. **会员库手动录入**（补录路径）：在「设置 → 会员库 → 会员详情 → 项目记录」Tab，可手动选项目、填购买金额、商品已用次数、购买日期，适用于历史订单迁移场景。

购买时生成，部分字段永久锁定，部分动态更新：

| 字段 | 类型 | 锁定/动态 | 说明 |
|------|------|----------|------|
| id | string | – | 主键 |
| member_id | string | 锁定 | 关联会员 |
| project_name | string | 锁定 | 购买时项目名称 |
| product_id | string | 锁定 | 关联商品 ID |
| product_paid_price | number | 锁定 | 该商品实付单价（核销时留存商品金额基准） |
| paid_amount | number | 锁定 | 实付金额（手工费计算基准）；有个人折扣时 = 原价 × 折扣；BOGO 赠品 = 0 |
| total_sessions | number | 锁定 | 购买时规定次数 |
| max_sessions | number | 锁定 | 购买时最多手工次数 |
| product_spec | string | 锁定 | 购买时商品规格 |
| used_sessions | number | 动态 | 核销次数（每次核销 +1） |
| remaining_sessions | number | 动态 | 剩余次数（可为负数，无下界保护） |
| serial_number | string | 锁定 | 关联销售流水号（用于退款时匹配快照） |
| status | enum | 动态 | active（正常）/ refunded（已退款），默认 active |
| purchased_at | timestamp | 锁定 | 购买时间 |

> 📌 fee_per_session 不预存，每次核销时动态计算：`paid_amount ÷ used_sessions × formula_coefficient`。

#### ⑦ shift_schedules（排班表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| staff_id | string | 员工 ID |
| date | string | 日期（YYYY-MM-DD） |
| shift | enum | morning（早班）/ evening（晚班） |
| rotation_id | string | 所属轮班周期 ID（可空，手动排班时为空） |
| created_by | string | 设置人员工 ID |
| created_at | timestamp | 创建时间 |

#### ⑧ shift_rotations（轮班周期配置）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| staff_id | string | 员工 ID |
| start_date | string | 周期开始日期 |
| cycle_days | number | 周期天数（如14=每两周一轮） |
| pattern | array | 周期内每天的班次，如 ["morning","morning","evening","evening"...] |
| created_by | string | 设置人员工 ID |
| created_at | timestamp | 创建时间 |

#### ⑨ punch_records（原始打卡记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| staff_id | string | 员工 ID |
| type | enum | 上班 / 下班 / 学习 |
| date | string | 日期（YYYY-MM-DD） |
| punched_at | timestamp | 打卡时间 |
| photo_file_id | string | 打卡照片 CloudBase Storage fileID（上班/下班必须拍照） |
| location | object | `{ lat, lng, address, distance }`：GPS 坐标 + 高德逆地理编码地址 + 距门店距离（米）；学习打卡不写此字段 |
| location_status | string | 定位结果：`ok`（在范围内）/ `out_of_range`（超出范围）/ `no_store`（门店坐标未配置，跳过校验）；学习打卡不写此字段 |
| created_at | timestamp | 记录时间 |

> 📌 打卡照片存储路径：`punch_photos/{staff_uid}/{timestamp}.jpg`，每名员工上限 30 张，超出时自动删除最旧的。  
> 📌 学习打卡每日限1次，重复点击时提示「今日已打卡」并禁用按钮。  
> 📌 每次打卡后同步更新 attendance_records（取当日最早打卡为 clock_in、最晚为 clock_out，触发考勤推算）。  
> 📌 上班/下班打卡调用高德逆地理编码获取地址；与 settings.store_lat/store_lng 计算 Haversine 距离；超出 checkin_radius 或定位失败则拒绝打卡（无强制绕过入口）；门店坐标未配置时跳过距离校验（仅展示地址，status=no_store）。

#### ⑩ attendance_records（考勤记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| staff_id | string | 员工 ID |
| date | string | 日期（YYYY-MM-DD） |
| clock_in | timestamp | 上班打卡时间（可空） |
| clock_out | timestamp | 下班打卡时间（可空） |
| planned_shift | enum | 计划班次：morning / evening（来自排班表） |
| actual_shift | enum | 实际班次：morning / evening / overtime / absent（系统推算） |
| status | enum | 正常 / 漏卡 / 缺勤 / 加班 |
| study_punched_at | timestamp | 学习打卡时间（员工在打卡页点击「学习打卡」后写入，可空） |
| location | object | 最近一次上班/下班打卡的定位数据 `{ lat, lng, address, distance }`（随每次打卡同步更新，可空） |
| location_status | string | 最近一次打卡的定位结果（`ok` / `out_of_range` / `no_store`，可空） |
| created_at | timestamp | 记录时间 |

#### ⑪ inventory（库存表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| product_id | string | 关联商品目录 ID |
| product_name | string | 商品名称（入库时从商品目录自动带入） |
| category | string | 商品分类（自动带入） |
| spec | string | 规格（自动带入） |
| barcode | string | 条形码（自动带入） |
| sale_price | number | 销售价格（自动带入） |
| purchase_price | number | 进货价（仅老板可见） |
| quantity | number | 库存数量 |
| created_at | timestamp | 入库时间（系统自动写入，不可编辑） |
| expiry_date | string | 保质期 |

#### ⑫ appointments（预约）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| booking_code | string | 预约号（手机后4位；当日冲突则+1位随机数变5位） |
| member_id | string | 会员 ID |
| therapist_id | string | 美容师员工 ID |
| member_project_id | string | 对应会员项目快照 ID |
| scheduled_time | timestamp | 预约开始时间 |
| duration_min | number | 项目时长（分钟） |
| status | enum | pending / checked_in / cancelled |
| created_at | timestamp | 创建时间 |

#### ⑬ transactions（消费记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| serial_number | string | 流水号（系统自动生成，唯一） |
| member_id | string | 会员 ID（匿名销售时为 null） |
| member_project_id | string | 关联会员项目快照（核销时） |
| therapist_id | string | 操作员工 ID |
| product_name | string | 商品名称 |
| product_spec | string | 商品规格 |
| barcode | string | 商品条码 |
| product_price | number | 商品**实付金额**（= 原价 × 折扣；BOGO 赠品 = 0；满减优惠另写一条负数条目） |
| discount | number | 折扣（员工填写，默认 1.0 即 10折） |
| payment_platform_no | string | 支付平台单号（暂为空，接入微信支付后自动写入） |
| product_id | string | 关联商品 ID（销售时写入，供退款匹配库存用） |
| type | enum | checkout（核销）/ purchase（销售）/ refund（退款） |
| operated_at | timestamp | 操作时间 |
| refund_ref_id | string | 退款时指向原始 transaction _id（仅 type=refund 时有值） |
| is_fee | boolean | 手工费条目标记（true 表示此条为手工费记录） |
| fee_base | number | 手工费基数（= paid_amount ÷ 分母，手工费 = fee_base × formula_coefficient） |
| fee_paid_amount | number | 对应快照实付金额（供项目计手工费用规定次数分母时使用） |
| fee_total_sessions | number | 对应快照规定次数 |
| fee_product_id | string | 关联商品 ID |

> 📌 同一笔销售的所有商品共用同一个 `serial_number`（整单唯一，不再每件单独生成）。退款条目 `product_price` 为负数。

#### ⑭ operation_logs（操作日志）

由 `src/utils/operationLog.js` 写入，内嵌于商品管理、库存管理、会员库三个管理页面展示。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| module | string | 所属模块（商品管理 / 库存管理 / 会员库） |
| action | string | 操作描述 |
| operated_by | string | 操作员工姓名 |
| operated_at | timestamp | 操作时间 |

#### ⑮ points_records（积分记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| member_id | string | 关联会员 |
| type | enum | earn（获得）/ redeem（抵扣） |
| points | number | 积分变动量（正数获得，负数抵扣） |
| amount | number | 对应金额 |
| note | string | 备注 |
| serial_number | string | 关联销售流水号（用于退款时关联原单积分记录） |
| created_at | timestamp | 记录时间 |

#### ⑯ notifications（消息通知）

由库存入库操作和小程序预约写入，员工端首页铃铛消息面板读取。最多保留 50 条，超出时自动删除最旧记录。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| type | enum | appointment（预约）/ inventory（库存）/ verification（核销）/ punch_request（补卡）/ recall_task（召回任务）/ recall_success（召回成功） |
| content | string | 展示文本（预先拼好） |
| created_at | timestamp | 写入时间 |

> 📌 写入时机：库存管理入库（含追加/新批次）→ type=inventory；小程序预约成功 → type=appointment，格式为「会员名」预约了「员工名」在 X月X日 HH:mm 的服务；AI 召回扫描生成任务 → type=recall_task；召回会员回店转化 → type=recall_success。

#### ⑰ balance_records（储值记录）

储值卡余额变动明细，MemberDetail「余额历史」Tab 读取。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| member_id | string | 关联会员 |
| type | enum | `topup`（充值）/ `deduct`（消费抵扣） |
| amount | number | 变动金额（充值为正，抵扣为负） |
| bonus_amount | number | 充值赠送金额（仅 topup 有值，否则 0） |
| note | string | 备注（如「充值 ¥500，赠送 ¥50」） |
| staff_id | string | 操作员工 ID |
| created_at | timestamp | 写入时间 |

> 📌 充值：在销售收款页「储值充值」弹窗操作，按档位自动计算赠送；抵扣：收款时余额抵扣部分同步写入负数记录。

#### ⑱ gift_materials（赠品物料库）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| name | string | 物料名称 |
| spec | string | 规格描述 |
| stock | number | 当前库存数量 |
| notes | string | 备注 |
| created_at | timestamp | 创建时间 |

> 📌 库存 ≤ 5 时展示橙色「库存不足」警示标签。

#### ⑲ gift_records（赠品发放记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| material_id | string | 关联 gift_materials._id |
| member_id | string | 接收会员 ID |
| quantity | number | 发放数量 |
| reason | string | 发放备注 |
| staff_id | string | 操作员工 ID |
| given_at | timestamp | 发放时间 |

#### ⑳ consumables（耗材消耗品记录）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| name | string | 消耗品名称 |
| spec | string | 规格描述 |
| quantity | number | 数量/件数 |
| purchased_at | date | 购入日期（YYYY-MM-DD） |
| used_up_at | timestamp | 标记用完时间（null = 仍在使用中） |
| notes | string | 备注 |
| created_at | timestamp | 创建时间 |

#### ㉑ recall_tasks（AI 召回任务）

由 AI 流失召回每日扫描写入；首页铃铛「召回任务」卡片读取。集合首次写入时自动创建，无需预设字段结构。

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 主键 |
| member_id | string | 关联会员 ID |
| member_name | string | 会员姓名 |
| phone | string | 联系电话 |
| skin_type | string | 肤质（如有） |
| dormant_days | number | 沉睡天数（距 last_visit_at） |
| total_remaining | number | 剩余项目总次数 |
| top_projects | array | 主要剩余项目 |
| preference_text | string | 历史消费偏好摘要 |
| tags | array | 会员标签快照 |
| priority_score | number | 召回优先级评分 |
| ai_script | string | AI 生成的召回话术（DeepSeek，缺省走规则模板） |
| status | enum | pending（待联系）/ contacted（已联系）/ converted（已转化）/ dismissed（已忽略） |
| scan_date | string | 生成日期（YYYY-MM-DD） |
| contacted_at | timestamp | 标记「已联系」时间（用于 7 天冷却） |
| created_at | timestamp | 写入时间 |

> 📌 经营周报/月报与员工异常均以快照形式存入 settings（见 ⑫/⑬），不单独建表；如需历史归档可后续新增 business_reports。

---

## 3. 权限设计

| 功能模块 | 老板 | 员工 |
|---------|------|------|
| 预约（新增/查看） | ✅ | ✅ |
| 手工核销 | ✅ | ✅ |
| 销售收款 | ✅ | ✅ |
| 退款（/refund） | ✅ | ✅ 所有员工 |
| 员工看板-日程（只读） | ✅ 全员（不含老板本人） | ✅ 高级员工看全员；初级/中级看自己 |
| 员工看板-收益 | ✅ | ✅ 仅自己 |
| 会员信息（查看） | ✅ | ✅ |
| 会员消费记录（查看） | ✅ 全部 | ✅ 对应会员 |
| 库存（查看） | ✅ | ✅ |
| 库存（编辑） | ✅ | ❌ |
| 进货价（查看） | ✅ | ❌ |
| 项目管理（查看） | ✅ | ✅ |
| 项目管理（新增/编辑/删除） | ✅ | ❌ |
| 商品信息（编辑） | ✅ | ❌ |
| 促销活动设置 | ✅ | ❌（员工不可见） |
| 老板看板 | ✅ | ❌ |
| 薪酬公式配置 | ✅ | ❌ |
| 排班设置（给员工分配班次/轮班周期） | ✅ | ✅ 仅高级员工 |
| 考勤记录（查看全员） | ✅ | ❌ |
| 考勤记录（查看本人） | ✅ | ✅ |
| Settings 全部（折叠面板配置） | ✅ | ❌ |
| 设置入口（进入 /settings 页面） | ✅ | ✅ 仅高级员工（可访问商品/库存/会员库/排班等有权限的入口） |

---

## 4. 员工 Web 端 — 页面功能规格

### 4.1 登录页 ✅

- 账号密码登录
- 登录成功后记录 `loginDate`（当天日期，存 localStorage）
- 次日自动失效，ProtectedRoute 检测 loginDate !== today 时执行 logout 并跳转登录页
- 登录成功后立即执行 `refreshCache()` 确保本地缓存数据完整

### 4.2 首页 ✅

**顶部栏：**
- 左：打卡按钮 → `/punch`；用户姓名 + 角色标签
- 中央（绝对居中）：🔔 铃铛按钮；有未读消息时右上角显示红点；点击打开右侧消息面板（drawer）
- 右：设置入口（老板 + 高级员工可见）；退出登录

**消息面板（右侧 drawer）：**
- 展示最新 50 条 notifications，时间倒序
- 📅 预约类 / 📦 库存类 图标区分
- 每条：内容文本 + 相对时间（如「3分钟前」）
- 打开时更新 localStorage 时间戳，红点消失

**未读检测：**首页挂载时对比 notifications 最新 `created_at` 与 localStorage 存储的上次查看时间（key：`notif_last_read_{uid}`），有新记录则显示红点。

**中央三块功能入口：**
- 预约（蓝）/ 手工（粉）/ 销售（橙）

**本周生日会员（中央区域底部）：**
- 当 `member_fields.birthday` 开关启用时展示
- 计算当前周（周一至周日）内生日的会员，以卡片列表展示（姓名 + 生日日期）
- 若本周无生日会员则不渲染此区块

**底部：**
- 员工看板按钮（绿，flex-1）与退款按钮（灰，固定宽）同一行
- 老板看板按钮（紫，owner 专属）

### 4.3 预约页 ✅

**左侧表单**

- 日期：默认系统日期，点击展开日历弹窗
  - 可选范围：今日 ~ 今日 + max_booking_days_ahead 天，今日之前不可选
  - 今日用红色圆圈标记，选中日期同样红色圆圈，重合时只显示一个圆圈
- 会员名称：从会员库下拉选择
- 美容师：从员工库下拉（仅显示状态=在职的员工），选中后刷新栅格
- 开始时间：5 分钟倍数，限早/晚班时间内；可手动输入，栅格双向联动
- 预约项目：**支持多选**，从项目库多选，时长自动累加
- 确认按钮：校验完整后提交，跳转预约成功页

**右侧栅格**

- **一次拉取当天所有员工预约**，按员工分组，每位在职员工各显示一个 TimeGrid，垂直堆叠
- 选中的美容师 TimeGrid 动态置顶，蓝色边框 + 「当前选择」标签
- 点击任意员工栅格内的时间格：自动切换表单「美容师」字段为该员工，并更新开始时间
- 每个 TimeGrid 独立横向滚动，不超出右侧渲染区边界
- 横轴：上下班时间范围（早晚班），每列 = 30 分钟
- 纵轴：读取 settings.max_clients_per_slot，动态行数（默认2行）
- 颜色：空白=可预约，绿色=已占用，红色=当前选中员工正在填写的预约（实时预览）
- 不足30分钟按比例纵向高亮（如15分钟=50%高亮）
- 超出下班时间：允许，栅格灰色背景，但红色高亮覆盖
- 并发行分配（max>1）：系统自动分配

### 4.4 预约成功页 ✅

- 展示预约号（大字号居中）：默认手机后4位，当日冲突则加1位随机数变5位
- 左上角「回到首页」按钮

### 4.5 手工登记页 ✅

- 输入预约号（4位或5位），满位数后自动查询
- 查询成功：自动填入会员名称 / 美容师 / 开始时间 / 预约项目
- 查询失败：输入框下方显示红色提示「预约号不存在」
- 确认按钮：查询成功后可点击，跳转核销详情页

### 4.6 核销详情页 ✅（已重构为 slot 内联选择）

**四个区块：**

**① 会员基础信息卡片（红色）**：只读，展示姓名 / 手机 / 肤质 / 过敏史。

**② 项目信息区（slot 内联选择）**

- 每个 slot 占两行：
  - 行1：「项目N」 + 大类下拉（用于过滤） + ✕ 删除按钮
  - 行2：项目名称下拉（绿色高亮已选中） + 若无匹配快照则显示「⚠ 产品不足」
- 行2下方：已用/规定次数摘要，超规定次数标红
- 右上角 + 按钮新增 slot
- 从预约跳转时自动填入预约项目到第一个 slot

**③ 留存商品明细**

- 同商品跨多 slot 时做耗次去重（只计 1 次消耗）
- 每种商品有多条快照时，分行展示，员工点击行切换本次消耗的**主快照**
- 排序：余次升序（余次少的在前，优先消耗）
- 默认选中：余次最少的快照（✓ 标记，即主快照）
- 字段：品名 / 规格 / 余次 / 耗次 / 单价（product_paid_price） / 本次（✓/○）
- 品名下方展示**来源项目 chip**（该商品来自哪些 slot 项目）
- **套盒展示**：来自套盒的子商品缩进展示在「套盒：XXX」灰色 header 下，套盒同类子商品聚合为一组
- 底部提示：「点击行切换主来源；主=优先消耗，副=余次不足时自动补充」
- **主/副快照规则**：每种商品同时维护主快照和副快照；主快照余次不足时，系统自动从同产品其他快照中选余次最多的作为副快照补充消耗；核销时先扣主快照，再扣副快照
- 点击已选主行 → 取消（primaryId=null，本次跳过该商品）；点击未选行 → 设为主快照

**④ 备注**：自由文本输入

**确认核销触发动作（同时执行）：**

- 动作1：更新 member_projects：`used_sessions + primaryConsumeCount`，`remaining_sessions - primaryConsumeCount`（remaining_sessions 可为负数，无下界）；副快照同步更新
- 动作2：手工费写入 ✅：
  - 分母 = `max(核销后 used_sessions, primarySnap.total_sessions)`
  - `fee = primarySnap.paid_amount ÷ 分母 × formula_coefficient`
  - 手工费 transaction 附加字段：`is_fee: true`、`fee_base: paid_amount ÷ 分母`、`fee_paid_amount`（快照实付金额）、`fee_total_sessions`（快照规定次数）、`fee_product_id`（关联商品 ID）
- 动作3：消费记录写入（商品金额使用 product_paid_price）
- 动作4：预约状态更新为 checked_in，记录 operated_at
- 动作5：微信订阅消息推送「您的XX项目已完成本次服务，已使用X次，剩余X次」（**待实现**）

### 4.7 销售收款页 ✅

**布局**：`max-w-5xl`，`md:` 断点切为 `grid-cols-[3fr_2fr]` 双列。左列：会员搜索 / 商品添加 / 购物车；右列：促销汇总 / 收款按钮（`md:sticky top-4`）。移动端保持单列。

**会员搜索（顶部）**：手机号/姓名模糊搜索，允许匿名销售留空。搜索行末尾有「新增」（粉色）按钮，点击弹出与会员库相同的新增 modal（受 member_fields 开关控制），保存后自动选中该会员。已选会员且 balance_enabled=true 时，搜索行末尾显示「余额 ¥XX.XX」与「充值」按钮。

**商品添加**：文本框输入商品名称或条形码 + 右侧「搜索」按钮（Enter 也触发）+ 右侧「📷 扫码」按钮；精确匹配条形码直接加入购物车，模糊匹配以 chip 列表展示供点选；条形码不存在时显示红色错误提示。

**促销活动区（右列顶部）**：
- 展示所有已启用的促销模板，单选
- 选中后高亮，再次点击取消
- 选中全局促销：全部商品折扣重置为 10 折
- 选中指定商品促销：对应商品折扣重置为 10 折
- 满减未达门槛时显示「还差 ¥X 满足优惠条件」

**购物车列表字段**：品名 / 关联项目 / 原价 / 折扣 / 金额 / 赠品 / 删除

- 关联项目列：下拉选择（已选会员时显示该商品关联的项目模板；未选会员时显示「散客」选项）
- 已选会员但该商品无关联项目：显示「无关联项目」灰色文本
- BOGO 赠品：折扣列显示「赠品」，金额列显示 ¥0（系统自动，不显示赠品切换按钮）
- **手动赠品**：每行末尾「赠」切换按钮（BOGO 赠品行不显示），点击后 `is_gift: true`，金额=0，绿色「赠品」标签，折扣重置为 10 折；赠品商品排除满减合计、排除满减分摊
- 折扣输入框：默认10折，可手动修改（修改后排除该商品的满减计算）
- 购物车下方有未关联项目的商品时，显示橙色全局提示，收款按钮禁用

**余额抵扣（右列，balance_enabled=true 且已选会员且余额>0 时显示）：**
- 输入框：可填写本次使用余额金额（不超过当前余额）
- 实际抵扣 = min(输入值, 积分抵扣后应付金额)
- 合计区显示「余额抵扣 ¥XX.XX」绿色行

**储值充值弹窗（点击「充值」按钮触发）：**
- 展示当前会员余额
- 输入充值金额，系统按 balance_topup_tiers 实时计算赠送金额并展示
- 确认后：写入 balance_records（type=topup），更新 members.balance

**合计区（右列底部）**：满减优惠单独一行展示（绿色），余额抵扣单独一行展示（青绿色），最终合计加粗橙色。

**收款按钮**：弹出确认弹窗，展示应收金额，点击「已收款」触发写入。

**确认收款触发：**
- 每件商品写入 transaction（手动赠品 / BOGO 赠品金额 ¥0 写 `is_gift: true`，满减写一条负数记录）
- 若有余额抵扣（balanceDiscount > 0）：写入 balance_records（type=deduct, amount=-balanceDiscount），更新 members.balance
- 已关联项目的商品写入 member_projects 快照（锁定 product_id、product_paid_price 等字段）
  - **套盒商品**：检测到 `kit_components` 非空，为每个子商品逐件创建快照，`paid_amount = 套盒实付金额 ÷ 子商品总件数`；不为套盒整体创建快照
- 自动扣减库存（FIFO，按入库时间从旧到新扣）；库存不足时写入 operation_log 预警「员工名，在『时间』预售『商品名称』N件，库存出现欠量」，不阻断收款流程

### 4.8 支付成功页 ✅

- 显示「支付成功」文字
- 触发消费记录写入
- 左上角「回到首页」

### 4.9 员工看板 ✅（原「日程」，v0.6 扩展）

**三个 Tab：日程 / 考勤 / 收益**

**「日程」Tab：**
- 布局：顶部日期选择器 + 垂直堆叠的多员工 TimeGrid（无员工筛选下拉）
- **一次拉取当天所有预约**，按员工分组，每位员工各显示一个 TimeGrid
- **可见范围按角色区分**：
  - 老板 / 高级员工：显示所有在职员工的 TimeGrid（**不含老板本人**）
  - 初级 / 中级员工：仅显示本人的 TimeGrid
- 预约数量统计仅计当前显示员工的预约数
- 每个 TimeGrid 独立横向滚动，不超出渲染区边界
- 绿色时间块：点击后左侧弹出详情面板（会员名/美容师/开始时间/项目/状态）
- 再次点击同一绿色块：详情收起
- 只读，不可在此页发起新预约

**「考勤」Tab：**
- 显示 AttendanceCalendar 组件
- 可见范围同日程 Tab

**「收益」Tab：**
- **本月手工费收益**：汇总当月 transactions 中 is_fee=true 的 product_price
- **本月销售目标完成情况**：当月 type=purchase 销售额 vs monthly_staff_target，进度条展示
- **薪酬公式预览**：读取 settings.salary_formula 中对应等级公式，以彩色 pill 分组展示运算式
- **统计小卡片行（全宽网格）**：
  - 本期手工费收益（粉）
  - 本期手工次数
  - 若薪酬公式包含「拓客人数」模块：额外显示「拓客人数」卡（靛蓝）和「拓客收益」卡（靛蓝深），展示关联商品销售人数及金额
- **左右两栏布局（md 断点）**：
  - 左栏：若有「商品销售激励」模块则显示「商品销售激励」卡（绿，按商品明细展示件数×单价）+ 手工费明细
  - 右栏：薪酬公式结构 + 计算说明
- **手工费明细**（按周/日展开）：
  - 按周分组，当前周默认展开，过去周折叠，点击切换
  - 每周显示日期范围 + 周合计
  - 展开后按日倒序，每日显示日合计
  - 每笔记录：会员名（左）+ 手工费金额（右）+ 次行显示计算式 `实付¥X ÷ Y × Z`
  - 分母由 `fee_paid_amount / fee_base` 反推，四舍五入两位小数

### 4.10 设置页 ✅

老板 + 高级员工可见设置入口（首页顶部栏「设置」按钮）。设置页内部的折叠配置面板及 ownerOnly 标记入口仅老板可见。

**十个折叠面板（仅老板可见）：**

1. **排班与预约**：时间段 / 时间粒度 / 并发数 / 最远预约天数
2. **薪酬计算**：formula_coefficient；工资公式配置（组/模块结构，组内/组间 +/-/×/÷，16种模块，公式预览）
3. **会员字段配置**：生日 / 性别 / 肤质 / 过敏史 / 备注 开关
4. **商品配置**：商品分类开关
5. **本月目标**：店铺目标（monthly_store_target）/ 员工目标（monthly_staff_target）
6. **积分设置**：
   - points_enabled（积分功能总开关）
   - points_earn_rate（消费 ¥1 获得 N 分）
   - points_redeem_rate（X 分 = ¥1）
7. **打卡与定位**：
   - amap_web_key（高德 Web API Key）
   - store_lat / store_lng（门店坐标）
   - checkin_radius（打卡允许半径，默认 200m）
8. **账号模式**：
   - `individual`（默认）：每名员工各自登录账号，操作即为本人
   - `shared`（共享设备）：所有员工共用同一台设备；销售/核销/打卡前弹出「选择操作人」底部弹窗，强制选择在职非老板员工；选中员工作为本次操作的 therapist_id/staff_id；权限（role/level）始终基于登录账号，不受 activeStaff 影响
9. **会员标签阈值**：
   - tag_high_freq_min（高频客月均次数阈值，默认4次）
   - tag_big_spender_min（大客户累计消费阈值，默认¥3000）
   - tag_dormant_days（沉睡客未到店天数，默认30天）
   - tag_new_days（新客首次到店天数窗口，默认30天）
10. **储值卡**：
    - balance_enabled（储值卡总开关）
    - balance_topup_tiers（充值档位数组，可动态增删；格式：充值 ≥ N 元，赠 X%）

（促销活动已移至独立管理页，见入口网格）

**设置入口网格（权限见括号）：**

| 入口 | 权限 | 说明 |
|------|------|------|
| 项目管理 | 老板 | 项目模板 CRUD |
| 商品管理 | 老板/高级员工（编辑仅老板） | 商品目录 |
| 库存管理 | 老板/高级员工（编辑仅老板） | 库存入库/查看 |
| 会员库 | 老板/高级员工 | 会员 CRUD + 标签筛选 + 余额历史 |
| 员工管理 | 老板 | 员工账号管理 |
| 排班管理 | 老板/高级员工 | 跳转 `/shift` 排班月历 |
| 促销活动 | 老板 | 满减/BOGO 活动配置 |
| 交易记录 | 老板 | 历史销售流水查询 |
| 小程序内容 | 老板 | promotion_banners + sale_items 管理 |
| 物料管理 | 老板/高级员工 | 赠品物料库存 + 耗材消耗品记录 |

**会员库（MemberManagement）新增功能：**
- 顶部标签筛选栏：全部 / 新客 / 高频客 / 大客户 / 沉睡客（圆角胶囊按钮，选中高亮）
- 会员列表每行末尾展示该会员的标签 chip（按 getMemberTags 计算，颜色见下方规则）
- 「筛选沉睡会员」按钮：一键筛出无剩余次数且 last_visit_at 超设定天数的会员

**会员详情（MemberDetail）新增功能：**
- 基础信息卡片新增展示：余额 ¥XX.XX（balance_enabled=true 时）
- 项目记录 Tab：remaining_sessions ≤ 0 标红，≤ 2 标橙；超规定次数显示「已超规定次数」红色提示
- Tab 栏：购买的项目 / 积分历史 / 余额历史（balance_enabled=true 时额外显示「余额历史」tab）
- 余额历史列表：来自 balance_records，展示时间 / 变动金额（正绿负红）/ 备注

**扫码功能：**

- **库存管理 → 入库**：商品选择支持两种方式（新增模式）：
  - 文本搜索：输入商品名称或条形码，点「搜索」或 Enter；精确匹配条形码直接选中，模糊匹配以 chip 列表展示
  - 扫码：点「📷」调用摄像头，匹配成功自动填入，匹配失败 toast 提示
  - 编辑模式：直接显示商品名称，不可更改
  - 同商品已有库存记录时弹出「追加到已有库存 / 按新批次入库」选择弹窗
- **库存列表**：搜索框（商品名称或分类），点「搜索」或 Enter 过滤
- **商品管理 → 新增**：条形码输入框右侧新增「商品扫码」按钮：
  - 已存在该条码：toast「商品已存在」0.5s，关闭摄像头
  - 不存在：将识别到的条码填入条形码文本框，关闭摄像头
  - 使用 `@zxing/browser` BrowserMultiFormatReader，1500ms 防抖

### 4.11 退款页 ✅（/refund，所有员工，首页底部「↩ 退款」按钮入口）

与交易记录页共用同一组件（TransactionManagement），查询范围为过去 30 天，支持关键词 + 日期范围筛选。

**退款流程：**
1. 找到要退款的流水行，点击「退款」按钮
2. 弹出退款弹窗，展示该流水号下所有可退商品（正价、未退款的 purchase 条目）
3. 勾选要退的商品（默认全选）→ 确认退款

**确认退款触发：**
- 写 `type=refund` transaction（金额为负，`refund_ref_id` 指向原始记录）
- 恢复库存（+1 追加到最新批次）
- 若原快照有 `serial_number` + `product_id`，将对应 member_projects `status` 改为 `refunded`、`remaining_sessions` 清零
- 积分回滚：按退款金额占原单比例，扣回已赚积分、还回已抵扣积分，写 points_records

**交易记录展示：**
- purchase 行：正常显示
- refund 行：红色背景 + 「退款」标签 + 负数金额
- 已退款的 purchase 行：灰色背景 + 「已退款」文字
- 底部显示净收入（包含退款抵扣）

### 4.12 交易记录页 ✅（老板专属，/settings 入口网格）

- 关键词搜索（商品名 / 条形码）
- 日期范围筛选（默认过去30天）
- 查询结果上限 500 条，超出时显示提示
- 仅查询 type = purchase 的销售记录（不含核销手工费条目）

**表格列：**

| 列 | 说明 |
|----|------|
| 日期时间 | operated_at |
| 流水号 | serial_number |
| 商品名称 | product_name |
| 条形码 | barcode |
| 原价 | 自动计算（product_price ÷ discount，若折扣=1则与实付相同） |
| 折扣 | discount |
| 实付 | product_price（存储的即是实付金额） |
| 经手员工 | therapist_id → staff.name |
| 关联会员 | member_id → members.name |

- 满减折扣条目：绿色背景行（product_price < 0）
- 赠品条目：折扣列显示「赠品」标签（discount=0）
- 积分抵扣不写入 transactions，仅写入 points_records，不在此页展示

### 4.13 小程序内容管理页 ✅（/settings → 小程序内容，老板专属）

管理在微信小程序发现页展示的内容，数据写入两个 CloudBase 集合：

- **promotion_banners**：图片纵向轮播，字段：name / image_file_id / sort_order / enabled
- **sale_items**：双列卡片商品，字段：product_id / product_name / category / sale_price / description / image_file_id / sort_order / enabled
  - `sale_price` 存快照，`original_price` 实时从 products 缓存读取（不存快照）

图片上传至 CloudBase Storage：banners → `miniprogram/banners/`，商品图 → `miniprogram/sale-items/`。

### 4.15 物料管理页 ✅（/settings → 物料管理，老板/高级员工）

两个 Tab：**赠品物料** / **消耗品**。

**「赠品物料」Tab：**
- 列表：名称 / 规格 / 库存数量 / 操作（入库 / 发放 / 编辑 / 删除）
- 库存 ≤ 5 时显示橙色「库存不足」标签
- **入库**（增加库存）：填写数量，写入 gift_materials.stock += 数量
- **发放**（给会员）：选择会员、填写数量和备注，写入 gift_records，stock -= 数量
- 编辑/删除：仅老板可操作（isOwner check）

**「消耗品」Tab：**
- 列表：名称 / 规格 / 数量 / 购入日期 / 状态（在用 / 已用完+日期）/ 操作
- 已用完的行灰色展示，右侧显示「已用完 · M月D日」
- **入库**：填写名称/规格/数量/购入日期/备注，新增一条 consumables 记录
- **标记已用完**：更新 used_up_at = now()
- 编辑/删除：仅老板可操作

### 4.14 系统初始化页 ✅（/setup）

- 仅首次访问时可用（staff 集合为空时开放）
- 创建 owner 账号：姓名 / 登录账号 / 密码
- 初始化 DEFAULT_SETTINGS 到 settings 表
- 完成后跳转登录页

---

## 5. 老板看板 ✅

### 5.1 数据面板

**维度切换**：日 / 周 / 月 / 年（全局生效，所有卡片同步）

**三张指标卡：**

| 卡片 | 当前状态 |
|------|---------|
| 销售额（粉） | ✅ 从 transactions 汇总 |
| 利润（紫） | ✅ 销售额 − 进货成本（通过 products 缓存匹配 purchase_price，不含进货价商品计 ¥0） |
| 成本（绿） | ✅ 进货成本 + 员工薪酬合计 |

**员工业绩区**：员工名 / 当期销售额 / 当期手工次数 / 手工费合计 / 本期薪酬（按公式完整计算）/ `›`

- 离职员工保留展示，名称后标注「[已离职]」
- 点击整行 → 跳转 `/staff-earnings`（员工个人业绩页），展示与员工看板-收益 Tab 相同的内容（本月手工费收益 / 目标进度 / 薪酬公式 / 手工费明细），顶部显示员工姓名

> 📌 v1.3：老板看板「员工考勤区」月历已移除（考勤数据仍用于薪酬计算，不再在看板展示）。

**图表区：**
- 环形图：销售额按商品名分组 ✅
- 柱状图：按维度分组的销售额趋势 ✅（日→小时，周→日，月→日，年→月）

**AI 展示区 ✅（v1.3）：**
- 「员工异常」卡片（位于经营月报上方）：折扣/退款/非营业时间异常，见 §7A.3
- 「经营报告」卡片（月报/周报）：五段式 AI Markdown，见 §7A.2
- 两者均为进看板懒触发、按周期缓存，仅老板可见

---

## 6. 微信小程序端 ✅（v1.1，2026-05-25 已实现）

目录：`/Users/wyd/beauty-miniprogram/`（独立原生微信小程序项目）

- CloudBase 环境 ID：`ENV_ID`（占位，需在 app.js 替换）
- AppID：`YOUR_APPID`（占位，需在 project.config.json 替换）
- 云函数 `login`（cloudfunctions/login/）：返回 openid 用于绑定会员

### 6.1 Tab 结构（3 Tab）

**发现 / 预约 / 我的**

「我的」包含三子Tab：我的项目 / 消费记录 / 积分记录

### 6.2 发现页
- promotion_banners：图片纵向堆叠展示
- sale_items：双列卡片 + 底部弹窗详情
- 内容由员工 Web 端「设置 → 小程序内容」管理

### 6.3 预约（自助）
- 仅可选择 remaining_sessions > 0 的项目
- 选择时间（5分钟倍数，限上下班时间）
- 选择美容师（仅在职员工）

### 6.4 我的
- 我的项目：购买项目列表（项目名/规格/购买金额/总次数/已用/剩余），超规定次数标红
- 消费记录：按时间倒序（消费时间/商品名称/规格/金额/类型）
- 积分记录：points_records 列表

### 6.5 消息通知（待实现）
- 核销后推送：「您的XX项目已完成本次服务，已使用X次，剩余X次」

---

## 6.6 积分体系 ✅（v0.9 已实现）

**数据库集合**：`points_records`（见 2.3 ⑮ 节）

**settings key**：`points_enabled` / `points_earn_rate` / `points_redeem_rate`（见 2.3 ① 表 ⑥ 积分设置）

**业务规则：**
- 积分启用且已选会员时，销售收款页显示当前积分余额和抵扣输入框
- 积分抵扣上限 = min(可用积分换算金额, 订单实付金额)；积分优先于余额抵扣
- 收款后写 points_records：先写 redeem（抵扣），再写 earn（按实际支付金额 × earn_rate 获得）
- 同时更新 member.points 字段
- MemberDetail「积分历史」Tab，列出 points_records 记录

---

## 7. 核心业务规则

### 7.1 预约号生成规则
- 默认：会员手机号后4位
- 当日冲突（同日两人后4位相同）：后4位 + 1位随机数 = 5位

### 7.2 手工费计算全景

#### 7.2.1 核心公式

```
分母 = max(核销后 used_sessions, total_sessions)
fee  = paid_amount ÷ 分母 × formula_coefficient
```

- **paid_amount**：快照中实付金额（锁定），非项目模板 price
- **分母规则**：未超规定次数时用规定次数（保证每次手工费稳定）；超次后用实际次数（手工费随次数增加递减）
- **formula_coefficient**：settings 配置，默认 0.2，代码不写死

**举例**（项目实付 1000元，规定10次，最多12次）：

| 核销次数 | 分母 | 手工费计算 | 金额 |
|---------|------|----------|------|
| 第1次 | max(1,10)=10 | 1000 ÷ 10 × 0.2 | ¥20.00 |
| 第5次 | max(5,10)=10 | 1000 ÷ 10 × 0.2 | ¥20.00 |
| 第10次 | max(10,10)=10 | 1000 ÷ 10 × 0.2 | ¥20.00 |
| 第11次 | max(11,10)=11 | 1000 ÷ 11 × 0.2 | ¥18.18 |
| 第12次 | max(12,10)=12 | 1000 ÷ 12 × 0.2 | ¥16.67 |

#### 7.2.2 paid_amount 的确定规则

同一件商品，因购买方式不同，写入快照的 paid_amount 不同，直接决定手工费基数：

| 购买场景 | paid_amount | 手工费基准 | 说明 |
|---------|-------------|-----------|------|
| 正常购买 | 实付金额 | 全额 | 基准情况 |
| 个人折扣（如8折） | 原价 × 折扣 | 折后价 | 客人付多少，手工费就基于多少 |
| BOGO 赠品（免费件） | 0 | 0，无手工费 | 商品白给，无收益来源 |
| 参与满减 | 原价 − 分摊满减 | 满减后价 | 门店让利，手工费随之降低 |
| 积分抵扣 | **不变**（不分摊） | 同折后/原价 | 积分是营销成本由门店承担，不影响美容师 |

**举例**（一单3件）：
- 精华液 ¥300，8折 → paid_amount = ¥240
- 面膜 ¥100，BOGO 赠品 → paid_amount = ¥0
- 水乳 ¥200，参与满减（满300减50）→ paid_amount = ¥150
- 客人额外用100积分抵¥1 → 三件 paid_amount 均不变

#### 7.2.3 手工费为零的情况

| 情况 | 原因 |
|------|------|
| BOGO 赠品件 | paid_amount = 0，fee = 0 |
| 散客销售（无会员） | 无 member_projects 快照，不产生手工费记录 |
| 未关联项目的商品 | 无快照，不进入核销流程 |
| formula_coefficient = 0 | settings 配置为 0（关闭手工费） |

#### 7.2.4 fee_base 存储字段（供月底薪酬汇总用）

每次核销写入 transactions 的额外字段，支持薪酬公式用不同分母重算：

| 字段 | 内容 | 用途 |
|------|------|------|
| `is_fee: true` | 标记这条为手工费记录 | 薪酬模块筛选 |
| `fee_base` | paid_amount ÷ 分母 | 用 max 分母时直接汇总 |
| `fee_paid_amount` | 快照 paid_amount | 薪酬公式改用 total_sessions 分母时重算 |
| `fee_total_sessions` | 快照规定次数 | 同上 |
| `fee_product_id` | 关联商品 ID | 薪酬公式按商品范围筛选 |

#### 7.2.5 薪酬公式中的两种手工费模块

详见第 8 节，概要如下：

| 模块 | 公式 | 适用场景 |
|------|------|---------|
| 次数计手工费 | 核销次数 × 固定单价 | 老板按次给钱，不管项目金额 |
| 项目计手工费 | Σ fee_base × 系数 | 与项目实付金额挂钩，支持两种分母（max / 规定次数） |

`total_sessions` 分母场景：老板希望超次服务手工费不递减，每次固定按规定次数平摊。

### 7.3 次数边界规则

| 状态 | 客户端小程序 | 员工端 |
|------|------------|--------|
| used < total_sessions | 可预约 | 可预约 |
| used >= total_sessions | ❌ 不可预约 | 可预约（used 标红） |
| used >= max_sessions | ❌ 不可预约 | ❌ 不可预约 |

> used_sessions 超过 total_sessions 后：remaining_sessions 继续递减，可为负数，无下界保护

### 7.4 会员项目快照规则
- 购买时在销售页生成，锁定：项目名称 / 实付金额 / 规定次数 / 最多手工次数 / 商品规格 / 商品ID / 商品实付单价
- 项目模板修改后：仅影响未来新购买，存量快照不受影响
- 商品信息修改：不影响任何已有快照记录

### 7.5 排期规则
- 按美容师维度锁定时段
- 最大并发接待人数读取 `settings.max_clients_per_slot`（默认2，可调，代码不写死）
- 系统自动分配并发行，不需员工手动选行
- 跨下班时间预约：允许，超出部分栅格灰色背景，不报错

### 7.6 价格与折扣规则
- **折扣与满减不可叠加**：员工对某商品填写折扣（非10折）→ 该商品自动排除出满减合计计算
- **满减递进公式**：`floor(参与满减商品合计 ÷ 门槛) × 减免金额`（每满X减Y）
- **BOGO**：同名商品 N 件中，价格最低的 `floor(N/2)` 件免费；赠品记录金额 ¥0
- 最终应付 = 有折扣商品折后价 + 参与满减商品满减后价（两类不叠加）

**member_projects.paid_amount 写入规则：**
- 有个人折扣（非10折）的商品：`paid_amount = 原价 × 折扣`，该商品不参与满减分摊
- BOGO 赠品（免费件）：`paid_amount = 0`
- 参与满减但无个人折扣的商品：`paid_amount = 原价 - 分摊满减金额`

**transactions.product_price 记录规则：**
- 所有条目均记**实付金额**（= 原价 × discount，折扣=1时即原价）
- 满减优惠单独写一条负数记录（product_name 标注促销名称，discount=1.0）
- 赠品条目：product_price=0，discount=0
- 交易记录页"原价"列由前端反推：`product_price ÷ discount`

### 7.7 利润/成本计算规则（待完善）
- 利润 = 当期销售额 - 当期销售商品进货成本（inventory.purchase_price）
- 成本 = 员工薪酬合计 + 进货成本
- 随统计维度（日/周/月/年）变化
- 仅老板可见

### 7.8 排班与考勤规则

**排班设置权限**：高级员工和老板可设置；普通员工只能查看自己的排班。

**轮班周期**：高级员工/老板可为每名员工配置轮班周期，系统按周期自动生成排班表。也可手动逐日调整，手动记录优先于周期推算。

**考勤状态推算逻辑（每日）：**

| 打卡情况 | 推算规则 | 状态 |
|---------|---------|------|
| 上下班均未打卡 | planned_shift ≠ off | 缺勤 |
| 上下班均未打卡 | planned_shift = off | 休息（不计入薪酬考勤） |
| 仅打一次卡（上班或下班） | — | 漏卡 |
| 上下班均已打卡 | 打卡时段覆盖早班时段，不覆盖晚班 → 早班 | 正常 |
| 上下班均已打卡 | 打卡时段覆盖晚班时段，不覆盖早班 → 晚班 | 正常 |
| 上下班均已打卡 | 打卡时段同时覆盖早班和晚班 | 加班 |
| 上下班均已打卡 | 打卡时段既不覆盖早班也不覆盖晚班 | 缺勤 |

**计划班次与实际打卡的关系：**
- 计划班次（排班表）为预设值，实际打卡时间为事实，事实优先
- 例：计划晚班，员工实际在早班时段打卡 → 系统将班次修正为早班
- 例：计划早班，早班下班时间后员工未下班打卡 → 记为漏卡；若员工后续在晚班时段打卡 → 系统修正为加班
- 漏卡与缺勤状态随后续打卡行为动态更新，直至次日零点锁定

**考勤日历展示：**
- 绿色格：正常打卡（含加班）
- 红色格：漏卡或缺勤
- 仅展示当月，未来日期不显示状态
- 老板面板：每名员工各自一个日历，并排展示
- 员工面板：仅展示本人当月考勤日历

### 7.9 储值卡业务规则

- balance_enabled=false 时，销售页无余额入口，MemberDetail 无余额历史 Tab，全部余额功能隐藏
- 充值按 balance_topup_tiers 档位赠送：取满足 min_amount 的最高档，bonus = amount × bonus_rate / 100；实际到账 = amount + bonus
- 余额抵扣上限 = min(当前余额, 积分抵扣后应付金额)；积分优先抵扣，再扣余额
- 每次充值和消费抵扣均写 balance_records，同时更新 members.balance

### 7.10 会员标签规则

标签实时计算（前端 `getMemberTags` 函数，不持久化存储），阈值来自 settings。

| 标签 | 颜色 | 判定条件 |
|------|------|---------|
| 新客 | 绿色 | `dayjs().diff(member.created_at, 'day') <= tag_new_days` |
| 高频客 | 蓝色 | 近3个月 checkout 月均次数 `>= tag_high_freq_min`（3个月核销数 ÷ 3） |
| 大客户 | 紫色 | 历史 purchase transactions 累计 paid_amount `>= tag_big_spender_min` |
| 沉睡客 | 橙色 | 非新客 且（last_visit_at 为空 或 距今 `>= tag_dormant_days` 天） |

- 标签不互斥，一位会员可同时持有多个标签（如既是高频客又是大客户）
- 新客与沉睡客互斥（新客期内不显示沉睡客）
- 标签展示：MemberManagement 列表行末 chip；MemberDetail 基础信息卡

### 7.11 离职员工处理规则
- status = 离职：不出现在预约美容师下拉选项中
- 历史核销记录、手工费记录：保留，老板看板中展示，名称后标注「[已离职]」

---

## 7A. AI 智能功能 ✅（v1.3，2026-07-03）

三项 AI 功能均为增量开发，共用一个 DeepSeek API Key（settings.deepseek_api_key 或 .env 的 VITE_DEEPSEEK_API_KEY）。**无 Key 或调用失败时，全部走本地规则模板兜底，功能不阻断。** 全部采用「进页面时懒触发」，不依赖云端定时任务。

代码结构：
- 领域纯函数：`src/domain/recall.js`、`src/domain/anomaly/`、`src/domain/staffAnomaly/`
- 服务编排：`src/services/recallService.js`、`businessReportService.js`、`staffAnomalyService.js`
- AI 调用：`src/services/deepseekService.js`（统一 `callDeepSeek`）
- 展示：`RecallTaskCard.jsx`、`BusinessReportPanel.jsx`、`StaffAnomalyPanel.jsx`、`MarkdownReport.jsx`

### 7A.1 AI 流失预警与主动召回

- **目标人群**：沉睡且**仍有剩余次数**的会员（区别于原「无剩余次数」清理流程）。
- **触发**：员工端首页加载时懒扫描，每日仅一次（settings.last_recall_scan_date 守卫）。
- **限流**：每日生成 < 10 条（默认 9，recall_daily_limit）；「已联系」后 7 天冷却（recall_contact_cooldown_days）。
- **评分**：按沉睡天数、剩余次数、消费额等加权 priority_score 排序，取前 N。
- **话术**：DeepSeek 生成亲切召回话术（≤80字，不含「沉睡/流失」等负面词），缺省走规则模板。
- **推送**：写入 recall_tasks + notifications(type=recall_task)，首页铃铛卡片「【召回任务】张姐·沉睡35天·剩余2次·点击查看话术」。
- **闭环**：标记「已联系」(status=contacted, contacted_at)；该会员下次到店结算时自动关联为 converted 并推送 recall_success。
- **防重复**：模块单例锁（防 React StrictMode 双跑）+ 扫描起始即写守卫 + 按会员去重。

### 7A.2 经营异常周报/月报

- **展示**：仅老板看板（不推铃铛），位于经营月报卡片。
- **触发/节奏**：进老板看板懒触发。
  - **周报**：周一为一周起点。周日进入生成「本周」（周一~今天）；周一~周六展示「上一整周」。
  - **月报**：每月最后 5 天（含月末）生成「当月」（该窗口内 periodKey 恒定，只生成一次，不逐日刷新）；其余日期展示「上一整月」。
  - 以 periodKey（周=周一日期，月=YYYY-MM）与 last_*_report_date 比对，不同才重算。
- **四维检测**（仅这四项）：
  1. 销售额：偏离基线均值（周报前12周 / 月报前3月）≥ anomaly_sales_pct_threshold（默认20%）
  2. 客单价：同基线，偏离 ≥ anomaly_aov_pct_threshold（默认20%）
  3. 退款率：较基线增幅 ≥ anomaly_refund_pct_threshold（默认50%）
  4. 负数库存：按商品汇总 inventory.quantity < 0（仅提醒补货，不改扣库存逻辑）
- **报告**：DeepSeek 生成五段式 Markdown（核心结论/经营概况/本期亮点/需要关注的问题/下一步建议），严禁编造数据；缺省走规则模板。全部正常时显示「✅ 本期各项经营指标在正常范围内，无异常。」

### 7A.3 员工经营异常检测

- **展示**：仅老板看板（不推铃铛），位于经营月报**上方**。
- **节奏**：按月，与经营月报同一 getMonthTarget 逻辑（月末最后 5 天生成当月，其余展示上月）。
- **口径**：折扣仅统计 type=purchase 的正价商品行（排除促销负行、赠品、退款）；折数 = discount × 10；退款率 = |refund| / purchase。
- **四维检测**：
  1. 个人低折扣：本月平均折扣低于个人近30天均值 ≥ staff_discount_personal_threshold（默认10%）
  2. 较全店低折扣：低于全店本月均值 ≥ staff_discount_store_threshold（默认15%）
  3. 退款率异常：高于个人历史均值 ≥ staff_refund_multiplier_threshold 倍（默认2倍，且本月≥1%）
  4. 非营业时间：交易时间不在早班/晚班任一时段内（按 serial_number 去重，单笔即告警）
- **防误报**：本月成交笔数 < staff_min_purchase_orders（默认5）跳过折扣/退款检测；无历史数据跳过「对比个人历史」类。
- **文案**：规则模板生成；有 Key 时 polishStaffAnomalyMessages 可选润色（严禁改动数字/姓名/时间）。
- **无权限字段**：系统不设折扣最低权限，「5折」类仅统计笔数，不做权限校验。

---

## 8. 薪酬计算 ✅（v0.6 完整实现）

工资公式按员工等级配置，存于 settings.salary_formula。

**模块列表（v0.6 更新）：**

| 模块名 | type | 模式限制 | 数据来源 |
|--------|------|---------|---------|
| 底薪 | fixed_monthly | 仅固定金额 | 手动输入 |
| 次数计手工费 | auto_fee | 仅关联（核销手工次数 × 单价） | transactions(is_fee=true) 计数 |
| 项目计手工费 | auto_project_fee_base | 仅关联（Σ fee_base × 系数） | transactions(is_fee=true).fee_base，分母可选：max(used,total) / 规定次数 |
| 员工本月销售总额 | auto_sales_amount | 仅关联（Σ 销售额 × 提成率） | transactions(type=purchase) 按员工汇总 |
| 商品销售数量 | auto_sales_count | 仅关联（件数 × 单价） | transactions(type=purchase, product_price>0) 计条数 |
| 货物管理费 | fixed_monthly | 仅固定金额 | 手动输入 |
| 账目管理费 | fixed_monthly | 仅固定金额 | 手动输入 |
| 员工管理费 | fixed_monthly | 仅固定金额 | 手动输入 |
| 手机费 | fixed_monthly | 仅固定金额 | 手动输入 |
| 满勤 | fixed_monthly | 仅固定金额 + 条件判断 | 固定金额，缺勤/漏卡/打卡不足时清零 |
| 目标激励 | fixed_monthly | 仅固定金额 + 条件判断 | 固定金额，当月销售额 >= monthly_staff_target 时计入 |
| 餐补 | fixed_monthly | 仅固定金额 | 手动输入 |
| 拓客人数 | count_rate | 关联（次数 × 单价） | 手动（UI 仅显示单价输入，不选商品） |
| 回店留存客人数 | count_rate | 自动（去重会员数 × 单价） | 本月 status=checked_in 预约中去重 member_id 数（自动计算，UI 仅显示单价输入） |
| 人数 | count_rate | 关联（次数 × 单价） | 手动（UI 仅显示单价输入，不选商品） |
| 学习打卡次数 | count_rate | 自动（次数 × 单价） | attendance_records.study_punched_at 计数 |

**「项目计手工费」模块说明：**
- 分母类型（denominatorType）：`max`（默认，max(used_sessions, total_sessions)）或 `total_sessions`（规定次数）
- 计算：`Σ(fee_base) × linkedRate`（fee_base 已在核销时按分母计算存储）
- 若选 total_sessions 分母：`Σ(fee_paid_amount / fee_total_sessions) × linkedRate`

**「满勤」条件逻辑：**
- 若 attendance_records 中存在 status=缺勤 或 status=漏卡 → 清零
- 若 `floor(打卡次数 / 2) + 2 ≠ 本月天数` → 清零（每月2天带薪休假，休息日>2则失去满勤）
- 条件通过时按比例计入（固定金额 / 本月天数 × 统计天数）

**「目标激励」条件逻辑：**
- 若员工当月 type=purchase 销售额 >= monthly_staff_target → 计入固定金额
- monthly_staff_target = 0 时不触发

**「学习打卡次数」计算：**
- `attendance_records.study_punched_at` 有值的记录数 × mod.linkedRate

**公式构建逻辑（v0.6）：**
- 按等级分三套公式（高级/中级/初级）
- 组内：模块间运算符支持 +/-/×/÷；第一个模块值作为初始值，后续按 op 运算
- 组间：group_op 运算符支持 +/-/×/÷；第一组值作为初始值，后续按 group_op 运算
- 每组可命名、设乘数系数（× N）
- 公式预览实时展示运算式（各组同色高亮）
- Dashboard 薪酬列按公式实时计算，兼容旧扁平格式

**✅ 已全部完成**

---

## 9. 数据批量导入导出 ✅

| 数据表 | 批量导入 | 批量导出 | 批量删除 | 单条编辑 |
|--------|---------|---------|---------|---------|
| 项目管理 | ✅ | ✅ | ✅ | ✅ |
| 商品管理 | ✅ | ✅ | ✅ | ✅ |
| 库存管理 | ✅ | ✅ | ✅ | ✅ |
| 会员库 | ✅ | ✅ | ✅ | ✅ |
| 员工表 | ❌ 逐条录入 | ✅ | ❌ 不可批量删除 | ✅ |

**导入逻辑**：上传 Excel → 系统解析 → 校验必填字段 → 校验通过则批量写入；失败则标红报错行并提示原因，不中断其他行。

**字段校验规则（导入时）：**
- 项目管理必填：项目名称 / 大类 / 次数 / 最多手工次数 / 时长；特殊：max_sessions >= total_sessions
- 商品管理必填：商品名称 / 销售价 / 条形码；特殊：条形码唯一性
- 库存管理必填：商品名称（需匹配商品目录）/ 数量；商品不在目录中则报错
- 会员库必填：姓名 / 手机号；特殊：手机号唯一性

---

## 10. MVP 开发状态

| 模块 | 功能 | 优先级 | 状态 |
|------|------|--------|------|
| 登录 | 账号密码 + 每日验证（loginDate） | P0 | ✅ 完成 |
| 首页 | 上钟/下钟 + 三块入口 + 员工看板 | P0 | ✅ 完成 |
| 预约 | 完整预约流程 + 全员栅格（选中置顶） | P0 | ✅ 完成 |
| 手工核销 | slot选择 + 五个触发动作 | P0 | ✅ 完成（动作5待实现） |
| 销售收款 | 扫码 + 折扣 + 促销 + 项目关联 | P0 | ✅ 完成 |
| 员工看板 | 日程/考勤/收益 三 Tab，按等级可见范围 | P0 | ✅ 完成 |
| 老板看板 | 数据面板 + 员工业绩 + 图表 | P0 | ✅ 完成 |
| 设置-项目管理 | CRUD + 权限 | P1 | ✅ 完成 |
| 设置-商品管理 | CRUD + 进货价权限 | P1 | ✅ 完成 |
| 设置-库存管理 | CRUD | P1 | ✅ 完成 |
| 设置-会员库 | 查看 + 字段配置 | P1 | ✅ 完成 |
| 设置-员工管理 | 新增/编辑/状态切换 | P1 | ✅ 完成 |
| 促销活动 | 满减（每满减）+ 买一送一 | P1 | ✅ 完成（原v2.0，提前实现） |
| 折扣与满减不可叠加 | 业务规则 7.6 | P1 | ✅ 完成 |
| 薪酬计算-公式配置 | Settings UI + 模块/组运算符 + 本月目标 | P1 | ✅ 完成 |
| 薪酬计算-看板结算 | Dashboard 本期薪酬列（含满勤/目标激励/学习打卡） | P1 | ✅ 完成 |
| 薪酬计算-手工费写入 | CheckoutDetail fee_base/is_fee 等完整字段 | P1 | ✅ 完成 |
| 薪酬计算-考勤联动 | 满勤/学习打卡次数 关联 attendance_records | P1 | ✅ 完成 |
| 扫码-库存入库 | 摄像头扫码匹配本地商品 | P1 | ✅ 完成 |
| 扫码-商品新增 | 摄像头扫码填入条形码 | P1 | ✅ 完成 |
| 扫码-销售收款 | 摄像头扫码搜索商品加入购物车 | P1 | ✅ 完成 |
| 库存管理-手动搜索选品 | 入库表单支持名称/条形码文本搜索 | P1 | ✅ 完成 |
| 库存管理-追加/新批次 | 同商品入库时选择追加或新批次 | P1 | ✅ 完成 |
| 库存管理-列表搜索 | 按名称/分类过滤列表 | P1 | ✅ 完成 |
| 销售收款-库存自动扣减 | 收款后 FIFO 扣减，负数写 operation_log | P1 | ✅ 完成 |
| 老板看板-利润/成本 | 关联真实进货价 | P2 | ✅ 完成 |
| 老板看板-员工考勤区 | 看板内每员工月历，打卡状态可视化 | P2 | ✅ 完成 |
| 批量导入导出 | Excel 模板 | P2 | ✅ 完成 |
| 交易记录页 | 历史流水搜索/筛选（老板专属） | P1 | ✅ 完成 |
| 系统初始化页 | /setup 首次创建 owner 账号 | P0 | ✅ 完成 |
| 打卡功能（含照片/GPS） | 上班/下班拍照打卡，学习打卡每日限1次 | P2 | ✅ 完成 |
| 退款流程 | 按件退款 + 积分回滚 + 库存恢复 + 快照标记 | P1 | ✅ 完成（2026-05-30） |
| 消息通知系统 | 首页铃铛 + 右侧 drawer + 库存/预约消息 | P2 | ✅ 完成（2026-05-30） |
| 员工看板-收益手工费明细 | 按周/日分组展开，含计算式 | P2 | ✅ 完成（2026-05-30） |
| 老板看板-员工个人业绩页 | 点击员工行进入 /staff-earnings | P2 | ✅ 完成（2026-05-30） |
| 微信订阅消息 | 核销后推送（动作5） | P2 | ❌ 待实现 |
| 排班管理 | 高级员工/老板设置班次+轮班周期 | P2 | ✅ 完成 |
| 打卡功能 | 上下班打卡 + 学习打卡 | P2 | ✅ 完成 |
| 考勤记录推算 | 打卡→状态自动推算逻辑 | P2 | ✅ 完成 |
| 考勤日历-员工看板 | 员工看板考勤 Tab | P2 | ✅ 完成 |
| 小程序内容管理 | MiniprogramContent：banners + sale_items | P2 | ✅ 完成 |
| 微信小程序 | 3Tab：发现/预约/我的（含积分记录） | P3 | ✅ v1.1 完成（2026-05-25） |
| 微信支付API | 自动监测到账 | P3 | ❌ v1.1 |
| AI 流失召回 | 沉睡且有剩余次数会员每日扫描 + 铃铛推送 + DeepSeek 话术 + 回店转化闭环 | P2 | ✅ v1.3 完成（2026-07-03） |
| 经营异常周报/月报 | 销售额/客单价/退款率/负数库存四维检测 + AI Markdown（周日/月末节奏） | P2 | ✅ v1.3 完成（2026-07-03） |
| 员工经营异常检测 | 折扣/退款/非营业时间四维月检 + 规则模板/可选 AI 润色 | P2 | ✅ v1.3 完成（2026-07-03） |
| AI功能（其他） | 耗材预警/复购预测等 | P3 | ❌ v2.0 |
| 积分体系（基础） | 积分赚取/抵扣/历史记录 | P2 | ✅ v0.9 完成 |
| 积分商品 | 积分兑换商品 | P3 | ❌ v2.0 |
| 横屏两栏布局 | Sales + CheckoutDetail 双列 md 布局 + 字号提升 | P2 | ✅ 完成（2026-06-02） |
| 销售页会员快速新增 | 搜索行「新增」按钮 → modal → 自动选中 | P2 | ✅ 完成（2026-06-02） |
| 账号模式（共享设备） | shared/individual 模式，操作前选人弹窗 | P2 | ✅ 完成（2026-06-02） |
| 手动赠品 | 购物车逐行切换赠品，排除促销计算 | P2 | ✅ 完成（2026-06-04） |
| 套盒商品支持 | products.kit_components；销售拆解；核销分组展示 | P2 | ✅ 完成（2026-06-04） |
| 商品不计入业绩 | products.exclude_from_sales；排除员工销售总额统计 | P2 | ✅ 完成 |
| 核销留存商品重构 | 套盒分组 header、fromProjects chip、耗次去重 | P2 | ✅ 完成（2026-06-01） |
| 核销「产品不足」按类型判断 | related_product_groups 分组检测 | P2 | ❌ 待实现 |
| 会员标签系统 | 新客/高频客/大客户/沉睡客标签，阈值可配 | P2 | ✅ 完成（2026-06-08） |
| 储值卡（余额充值/抵扣） | balance_records + sales 余额抵扣 + balance_topup_tiers 档位 | P2 | ✅ 完成（2026-06-08） |
| 物料管理页 | 赠品物料库存 + 耗材消耗品 + 发放记录 | P2 | ✅ 完成（2026-06-08） |
| 首页本周生日提醒 | member_fields.birthday 开关联动，本周生日会员展示 | P2 | ✅ 完成（2026-06-08） |
| 员工收益拓客/商品激励卡片 | EarningsPanel 新增拓客人数/收益卡+商品销售激励卡 | P2 | ✅ 完成（2026-06-08） |

---

## 11. 页面跳转关系

| 来源页面 | 触发操作 | 跳转目标 |
|---------|---------|---------|
| 登录页 | 登录成功 | 首页 |
| 首页 | 点击「预约」 | 预约页 |
| 首页 | 点击「手工」 | 手工登记页 |
| 首页 | 点击「销售」 | 销售收款页 |
| 首页 | 点击「员工看板」 | 员工看板页（/schedule） |
| 首页 | 点击「设置」 | 设置页 |
| 预约页（填完） | 点击「确认」 | 预约成功页 |
| 预约成功页 | 点击「回到首页」 | 首页 |
| 手工登记页（查到预约） | 点击「确认」 | 核销详情页 |
| 核销详情页 | 点击「确认核销」 | 首页（触发5个动作） |
| 销售收款页 | 点击「收款」 | 收款确认弹窗 |
| 销售收款页 | 点击「已收款」 | 支付成功页 |
| 支付成功页 | 点击「回到首页」 | 首页 |
| 设置页 | 点击「项目管理」 | 设置-项目管理 |
| 设置页 | 点击「员工管理」 | 设置-员工管理 |
| 设置-项目管理 | 点击任意项目卡片 | 项目编辑页 |
| 首页 | 点击「退款」 | 退款页（/refund） |
| 首页 | 点击🔔铃铛 | 右侧消息 drawer（不跳页） |
| 老板看板 | 点击员工业绩行 | 员工个人业绩页（/staff-earnings） |
| 员工个人业绩页 | 点击「← 返回」 | 老板看板 |

---

## 12. 待定事项 & 后续优化

### 12.1 当前缺口（按优先级）

1. **微信订阅消息推送**（P2）：核销动作5，需接入微信生态，CloudBase 端配置订阅消息模板，核销后推送「您的XX项目已完成本次服务，已使用X次，剩余X次」。

2. **核销「产品不足」按类型判断**（P2）：项目关联商品按「类型」分组（如水/乳/霜），同类型下任意一款有余次即视为正常，整组耗尽才提示「产品不足」。实现方案：将项目模板的 `related_products`（平铺数组）改为 `related_product_groups`（分组数组）：
   ```js
   related_product_groups: [
     { type_name: "水", product_ids: ["品牌A水id", "品牌B水id"] },
     { type_name: "乳", product_ids: ["品牌A乳id", "品牌B乳id"] },
   ]
   ```
   需同步改：项目管理 UI（分组编辑）、CheckoutDetail productConsumptionMap 按组构建、留存商品按组展示。现有 `related_products` 数据在读取时做兼容降级。

### 12.2 系统局限性说明

#### 私下收款不入账（技术层面无解）

核销本身不是主要漏洞——客人自己有动力核查剩余次数，次数被私扣会被发现。

真正的灰色地带是**私下收款不入账**：客人付了钱，但交易没进系统，老板看不到这笔收入。由于客人的项目次数正常增加、自身没有损失，她不会主动举报。买卖双方联合绕过系统，从技术层面几乎无解。

**定性**：这是管理问题，不是产品问题。产品能做的是让异常更容易被发现（如看板的销售额走势、员工客单比异常），但无法杜绝人与人之间的私下交易。终极解法是老板自己管人，不能完全依赖系统。

### 12.3 长期规划（v2.0+）

- **AI：复购预测提醒**（P1）：分析每个会员的预约间隔规律，超过平均间隔 1.5 倍仍未预约时，自动提醒老板或美容师跟进，降低流失率。
- **AI：耗材预警**（P2）：根据历史核销记录预测各耗材消耗速度，在库存不足前 N 天自动提醒补货，避免断货或积压。
- **AI：美容师服务质量分析**（P3）：多维度分析美容师数据——客户回头率（是否持续预约同一美容师）、核销完成率、客单价贡献，生成能力画像，辅助排班与薪酬决策。


- 积分商品：积分体系完整设计
- 硬件方向：ESP32 + RFID + OLED 物理取号机（长期规划）
- 微信支付 API：自动监测到账

---

*美妆门店管理系统 PRD v1.2 · 内部文档 · 请勿外传*
