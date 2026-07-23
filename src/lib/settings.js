// settings 表默认值，仅在初始化时写入一次
export const DEFAULT_SETTINGS = [
  // ① 排班与预约
  { key: 'morning_shift_start', value: '09:00', category: 'schedule' },
  { key: 'morning_shift_end', value: '13:00', category: 'schedule' },
  { key: 'evening_shift_start', value: '14:00', category: 'schedule' },
  { key: 'evening_shift_end', value: '20:00', category: 'schedule' },
  { key: 'slot_duration', value: 30, category: 'schedule' },
  { key: 'max_clients_per_slot', value: 2, category: 'schedule' },
  { key: 'max_booking_days_ahead', value: 30, category: 'schedule' },

  // ② 薪酬计算
  { key: 'formula_coefficient', value: 0.2, category: 'salary' },
  { key: 'salary_formula', value: {}, category: 'salary' },

  // ③ 会员字段配置
  {
    key: 'member_fields',
    value: {
      birthday: true,
      gender: true,
      skin_type: true,
      allergy: true,
      notes: true,
    },
    category: 'member_fields',
  },

  // ④ 商品配置
  { key: 'enable_product_category', value: false, category: 'products' },
  { key: 'enable_points_product', value: false, category: 'products' },

  // ⑤ 销售活动（预留，v2.0启用）
  { key: 'promotions', value: [], category: 'promotions' },

  // ⑥ 打卡与定位
  { key: 'amap_web_key',   value: '',  category: 'checkin' },
  { key: 'store_lat',      value: '',  category: 'checkin' },
  { key: 'store_lng',      value: '',  category: 'checkin' },
  { key: 'checkin_radius', value: 200, category: 'checkin' },

  // 系统配置
  { key: 'floating_keyboard_enabled', value: false, category: 'system' },

  // 核销设置
  { key: 'checkout_max_per_item', value: 2, category: 'checkout' },   // 单次核销每商品最多消耗次数
  { key: 'checkout_max_projects', value: 0, category: 'checkout' },   // 单次核销最多项目数，0=不限
  { key: 'allow_over_checkout', value: true, category: 'checkout' },  // 是否允许超规定次数核销
  { key: 'auto_round_enabled', value: true, category: 'checkout' },   // 销售收款自动抹零（向下抹到角，舍去分）

  // 项目大类模版
  { key: 'project_categories', value: [], category: 'projects' },    // 大类模版列表（运行时与现有项目大类取并集）

  // AI 召回
  { key: 'recall_daily_limit', value: 9, category: 'recall' },
  { key: 'recall_contact_cooldown_days', value: 7, category: 'recall' },
  { key: 'deepseek_api_key', value: '', category: 'recall' },
  { key: 'last_recall_scan_date', value: '', category: 'recall' },

  // 经营异常周报/月报
  { key: 'business_report_enabled', value: true, category: 'anomaly' },
  { key: 'anomaly_sales_pct_threshold', value: 20, category: 'anomaly' },
  { key: 'anomaly_aov_pct_threshold', value: 20, category: 'anomaly' },
  { key: 'anomaly_refund_pct_threshold', value: 50, category: 'anomaly' },
  { key: 'last_weekly_report_date', value: '', category: 'anomaly' },
  { key: 'last_monthly_report_date', value: '', category: 'anomaly' },
  { key: 'weekly_report_snapshot', value: null, category: 'anomaly' },
  { key: 'monthly_report_snapshot', value: null, category: 'anomaly' },

  // 员工经营异常（月报节奏）
  { key: 'staff_anomaly_enabled', value: true, category: 'staff_anomaly' },
  { key: 'staff_discount_personal_threshold', value: 10, category: 'staff_anomaly' },
  { key: 'staff_discount_store_threshold', value: 15, category: 'staff_anomaly' },
  { key: 'staff_refund_multiplier_threshold', value: 2, category: 'staff_anomaly' },
  { key: 'staff_low_discount_zhe', value: 7, category: 'staff_anomaly' },
  { key: 'staff_min_purchase_orders', value: 5, category: 'staff_anomaly' },
  { key: 'last_staff_anomaly_date', value: '', category: 'staff_anomaly' },
  { key: 'staff_anomaly_snapshot', value: null, category: 'staff_anomaly' },

  // 会员项目地图
  { key: 'project_map_enabled', value: true, category: 'member_map' },
  { key: 'project_map_levels', category: 'member_map', value: [
    { id: 'basic', name: '基础项目',   formula: [{ type: 'cat', cat: '清洁类' }] },
    { id: 'combo', name: '组合项目',   formula: [{ type: 'cat', cat: '清洁类' }, { op: 'and', type: 'cat', cat: '补水类' }] },
    { id: 'multi', name: '多项目组合', formula: [{ type: 'cat', cat: '清洁类' }, { op: 'and', type: 'cat', cat: '补水类' }, { op: 'and', type: 'anyOf', exclude: ['面膜'] }] },
    { id: 'full',  name: '全家桶',     formula: [{ type: 'all' }] },
  ] },
]
