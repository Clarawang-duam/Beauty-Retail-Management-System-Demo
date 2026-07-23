import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import { usePermission } from '../../hooks/usePermission'
import useAuthStore from '../../store/authStore'
import useCacheStore from '../../store/cacheStore'
import { toArray } from '../../utils/array'
import { isDemoMode } from '../../lib/cloudbase'
import { resetDemoData } from '../../demo/reset'
import ProductManagement from './ProductManagement/index'
import ProjectManagement from './ProjectManagement/index'
import InventoryManagement from './InventoryManagement/index'
import MemberManagement from './MemberManagement/index'
import StaffManagement from './StaffManagement/index'
import PromoManagement from './PromoManagement/index'
import TransactionManagement from './TransactionManagement/index'
import MiniprogramContent from './MiniprogramContent/index'
import MaterialManagement from './MaterialManagement/index'
import { PanelSection, SettingRow, SaveButton } from './SettingsUI'
import SalaryFormulaPanel from './SalaryFormulaPanel'
import ProjectMapPanel from './ProjectMapPanel'
import { getCategoryTemplates } from '../../utils/categories'


export default function SettingsPage() {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const { canManageSettings, isOwner } = usePermission()
  const { settings, refreshCache, products, projects } = useCacheStore()
  const [openPanel, setOpenPanel] = useState(null)
  const [subPage, setSubPage] = useState(null)
  const [editValues, setEditValues] = useState({})
  const [saving, setSaving] = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const handlePanelToggle = (panel) => {
    if (!canManageSettings) return
    if (openPanel === panel) {
      setOpenPanel(null)
      setEditValues({})
    } else {
      setOpenPanel(panel)
      setEditValues({})
    }
  }

  const updateSetting = (key, value) => {
    setEditValues((prev) => ({ ...prev, [key]: value }))
  }

  const savePanelSettings = async (keys) => {
    setSaving(true)
    try {
      for (const key of keys) {
        if (editValues[key] === undefined) continue
        const res = await db.collection(COLLECTIONS.SETTINGS).where({ key }).get()
        const newValue = editValues[key]
        if (res.data.length > 0) {
          await db.collection(COLLECTIONS.SETTINGS).doc(res.data[0]._id).update({ value: newValue })
        } else {
          await db.collection(COLLECTIONS.SETTINGS).add({ key, value: newValue })
        }
      }
      await refreshCache('settings')
      setEditValues({})
      setOpenPanel(null)
      alert('保存成功')
    } catch (err) {
      alert('保存失败：' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const getVal = (key) => editValues[key] !== undefined ? editValues[key] : (settings[key] ?? '')

  // 数字设置输入：编辑时允许空/中间态（存原始字符串），失焦归位（空/非法→min，按 min/max 钳制）。
  // 仅写本地草稿 editValues，落库在各面板「保存」，所以存空串安全。
  const onNumChange = (key) => (e) => updateSetting(key, e.target.value)
  const onNumBlur = (key, min = 0, max, emptyTo) => (e) => {
    let v = e.target.value
    if (v === '' || isNaN(Number(v))) {
      v = emptyTo != null ? emptyTo : min
    } else {
      v = Number(v)
      if (max != null) v = Math.min(max, v)
      v = Math.max(min, v)
    }
    updateSetting(key, v)
  }

  const backToSettings = () => setSubPage(null)

  if (subPage === 'products') return <ProductManagement onBack={backToSettings} />
  if (subPage === 'projects') return <ProjectManagement onBack={backToSettings} />
  if (subPage === 'inventory') return <InventoryManagement onBack={backToSettings} />
  if (subPage === 'members') return <MemberManagement onBack={backToSettings} />
  if (subPage === 'staff') return <StaffManagement onBack={backToSettings} />
  if (subPage === 'promos') return <PromoManagement onBack={backToSettings} />
  if (subPage === 'transactions') return <TransactionManagement onBack={backToSettings} />
  if (subPage === 'miniprogram') return <MiniprogramContent onBack={backToSettings} />
  if (subPage === 'materials') return <MaterialManagement onBack={backToSettings} />

  return (
    <div className="p-4 max-w-5xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">← 返回</button>
        <h2 className="text-xl font-bold text-gray-800">设置</h2>
      </div>

      <div className="space-y-6">
        {/* 数据管理入口 */}
        <div>
          <div className="flex items-center gap-3 mb-6">
            <h3 className="text-2xl font-bold text-gray-900 shrink-0">数据管理</h3>
            <span className="w-px h-6 bg-[#40C8B8] shrink-0" aria-hidden />
            <p className="text-sm text-gray-400">实时数据汇总，掌握门店脉搏</p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: '项目管理', key: 'projects', color: 'bg-blue-50 text-blue-700' },
              { label: '商品管理', key: 'products', color: 'bg-pink-50 text-pink-700' },
              { label: '库存管理', key: 'inventory', color: 'bg-orange-50 text-orange-700' },
              { label: '会员库',   key: 'members',  color: 'bg-green-50 text-green-700' },
              { label: '员工管理', key: 'staff',    color: 'bg-purple-50 text-purple-700', ownerOnly: true },
              { label: '排班管理', key: 'shift',    color: 'bg-teal-50 text-teal-700',    nav: '/shift' },
              { label: '促销活动', key: 'promos',   color: 'bg-rose-50 text-rose-700',    ownerOnly: true },
              { label: '交易记录', key: 'transactions', color: 'bg-indigo-50 text-indigo-700' },
              { label: '小程序内容', key: 'miniprogram', color: 'bg-violet-50 text-violet-700', ownerOnly: true },
              { label: '物料管理',   key: 'materials',   color: 'bg-yellow-50 text-yellow-700' },
            ].filter(({ ownerOnly }) => !ownerOnly || isOwner).map(({ label, key, color, nav }) => (
              <button
                key={key}
                onClick={() => nav ? navigate(nav) : setSubPage(key)}
                className={`${color} rounded-xl py-8 font-semibold text-center text-lg hover:opacity-80 transition-opacity`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 系统配置折叠面板 */}
        {isOwner && (
          <div className="space-y-2">
            <div className="flex items-center gap-3 mb-5">
              <h3 className="text-2xl font-bold text-gray-900 shrink-0">系统配置</h3>
              <span className="w-px h-6 bg-[#40C8B8] shrink-0" aria-hidden />
              <p className="text-sm text-gray-400">按需自定义配置，打造专属门店</p>
            </div>

          {/* ① 排班与预约 */}
          <PanelSection
            title="排班与预约"
            open={openPanel === '排班与预约'}
            onToggle={() => handlePanelToggle('排班与预约')}
          >
            <div className="space-y-3">
              {[
                { key: 'morning_shift_start', label: '早班开始' },
                { key: 'morning_shift_end', label: '早班结束' },
                { key: 'evening_shift_start', label: '晚班开始' },
                { key: 'evening_shift_end', label: '晚班结束' },
              ].map(({ key, label }) => (
                <SettingRow key={key} label={label}>
                  <input type="time" value={getVal(key)} onChange={(e) => updateSetting(key, e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm w-32 focus:outline-none" />
                </SettingRow>
              ))}
              <SettingRow label="时间粒度（分钟）">
                <input type="number" min="1" value={getVal('slot_duration')}
                  onChange={onNumChange('slot_duration')} onBlur={onNumBlur('slot_duration', 1)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-20 focus:outline-none" />
              </SettingRow>
              <SettingRow label="最大并发接待人数">
                <input type="number" min="1" value={getVal('max_clients_per_slot')}
                  onChange={onNumChange('max_clients_per_slot')} onBlur={onNumBlur('max_clients_per_slot', 1)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-20 focus:outline-none" />
              </SettingRow>
              <SettingRow label="最远可预约天数">
                <input type="number" min="1" value={getVal('max_booking_days_ahead')}
                  onChange={onNumChange('max_booking_days_ahead')} onBlur={onNumBlur('max_booking_days_ahead', 1)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-20 focus:outline-none" />
              </SettingRow>
              <SaveButton onClick={() => savePanelSettings([
                'morning_shift_start', 'morning_shift_end', 'evening_shift_start', 'evening_shift_end',
                'slot_duration', 'max_clients_per_slot', 'max_booking_days_ahead',
              ])} saving={saving} />
            </div>
          </PanelSection>

          {/* ② 薪酬计算 */}
          <SalaryFormulaPanel
            getVal={getVal}
            updateSetting={updateSetting}
            savePanelSettings={savePanelSettings}
            saving={saving}
            products={products}
            open={openPanel === '薪酬计算'}
            onToggle={() => handlePanelToggle('薪酬计算')}
          />
          {/* ③ 会员字段配置 */}
          <PanelSection
            title="会员字段配置"
            open={openPanel === '会员字段配置'}
            onToggle={() => handlePanelToggle('会员字段配置')}
          >
            <div className="space-y-2">
              {[
                { key: 'birthday', label: '生日' },
                { key: 'gender', label: '性别' },
                { key: 'skin_type', label: '肤质' },
                { key: 'allergy', label: '过敏史' },
                { key: 'notes', label: '备注' },
              ].map(({ key, label }) => {
                const current = getVal('member_fields') || settings['member_fields'] || {}
                const checked = editValues['member_fields']
                  ? editValues['member_fields'][key]
                  : (current[key] !== false)
                return (
                  <SettingRow key={key} label={label}>
                    <input
                      type="checkbox"
                      checked={!!checked}
                      onChange={(e) => {
                        const cur = editValues['member_fields'] || { ...settings['member_fields'] }
                        updateSetting('member_fields', { ...cur, [key]: e.target.checked })
                      }}
                      className="w-4 h-4"
                    />
                  </SettingRow>
                )
              })}
              <SaveButton onClick={() => savePanelSettings(['member_fields'])} saving={saving} />
            </div>
          </PanelSection>

          {/* ④ 商品配置 */}
          <PanelSection
            title="商品配置"
            open={openPanel === '商品配置'}
            onToggle={() => handlePanelToggle('商品配置')}
          >
            <div className="space-y-2">
              <SettingRow label="启用商品分类">
                <input type="checkbox" checked={!!getVal('enable_product_category')}
                  onChange={(e) => updateSetting('enable_product_category', e.target.checked)}
                  className="w-4 h-4" />
              </SettingRow>
              <SaveButton onClick={() => savePanelSettings(['enable_product_category'])} saving={saving} />
            </div>
          </PanelSection>

          {/* ⑤ 本月目标 */}
          <PanelSection
            title="本月目标"
            open={openPanel === '本月目标'}
            onToggle={() => handlePanelToggle('本月目标')}
          >
            <div className="space-y-2">
              <p className="text-xs text-gray-400 pt-2">本月销售目标</p>
              <SettingRow label="店铺目标">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">¥</span>
                  <input type="number" min="0" value={getVal('monthly_store_target')}
                    onChange={onNumChange('monthly_store_target')} onBlur={onNumBlur('monthly_store_target', 0)}
                    className="w-28 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none" />
                </div>
              </SettingRow>
              <SettingRow label="员工目标">
                <div className="flex items-center gap-1">
                  <span className="text-xs text-gray-400">¥</span>
                  <input type="number" min="0" value={getVal('monthly_staff_target')}
                    onChange={onNumChange('monthly_staff_target')} onBlur={onNumBlur('monthly_staff_target', 0)}
                    className="w-28 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none" />
                </div>
              </SettingRow>
              <SaveButton onClick={() => savePanelSettings(['monthly_store_target', 'monthly_staff_target'])} saving={saving} />
            </div>
          </PanelSection>

          {/* ⑥ 积分设置 */}
          <PanelSection
            title="积分设置"
            open={openPanel === '积分设置'}
            onToggle={() => handlePanelToggle('积分设置')}
          >
            <div className="space-y-3 pt-2">
              <SettingRow label="启用积分体系">
                <input type="checkbox" checked={!!getVal('points_enabled')}
                  onChange={(e) => updateSetting('points_enabled', e.target.checked)}
                  className="w-4 h-4" />
              </SettingRow>
              <SettingRow label="积分获取比例">
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <span>每消费</span>
                  <span className="text-gray-400">¥1</span>
                  <span>得</span>
                  <input type="number" min="0" step="0.1"
                    value={getVal('points_earn_rate')}
                    onChange={onNumChange('points_earn_rate')} onBlur={onNumBlur('points_earn_rate', 0, undefined, 1)}
                    className="w-20 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none" />
                  <span>积分</span>
                </div>
              </SettingRow>
              <SettingRow label="积分抵扣比例">
                <div className="flex items-center gap-1 text-sm text-gray-500">
                  <input type="number" min="1"
                    value={getVal('points_redeem_rate')}
                    onChange={onNumChange('points_redeem_rate')} onBlur={onNumBlur('points_redeem_rate', 1, undefined, 100)}
                    className="w-20 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none" />
                  <span>积分抵</span>
                  <span className="text-gray-400">¥1</span>
                </div>
              </SettingRow>
              <p className="text-xs text-gray-400">
                示例：比例 1/100 → 消费¥100得100分，100分可抵¥1
              </p>
              <SaveButton onClick={() => savePanelSettings(['points_enabled', 'points_earn_rate', 'points_redeem_rate'])} saving={saving} />
            </div>
          </PanelSection>

          {/* ⑦ 打卡与定位 */}
          <PanelSection
            title="打卡与定位"
            open={openPanel === '打卡与定位'}
            onToggle={() => handlePanelToggle('打卡与定位')}
          >
            <div className="space-y-3 pt-2">
              <p className="text-xs text-gray-400">员工上下班打卡时自动校验位置，超出范围或定位失败则拒绝打卡。</p>
              <SettingRow label="高德 Web 服务 Key">
                <input
                  type="text"
                  value={getVal('amap_web_key')}
                  onChange={(e) => updateSetting('amap_web_key', e.target.value)}
                  placeholder="高德开放平台 Web 服务 Key"
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-48 focus:outline-none"
                />
              </SettingRow>
              <SettingRow label="门店纬度">
                <input
                  type="number" step="0.000001"
                  value={getVal('store_lat')}
                  onChange={(e) => updateSetting('store_lat', e.target.value)}
                  placeholder="如 31.234560"
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-36 focus:outline-none"
                />
              </SettingRow>
              <SettingRow label="门店经度">
                <input
                  type="number" step="0.000001"
                  value={getVal('store_lng')}
                  onChange={(e) => updateSetting('store_lng', e.target.value)}
                  placeholder="如 121.567890"
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-36 focus:outline-none"
                />
              </SettingRow>
              <SettingRow label="打卡半径 (m)">
                <input
                  type="number" min="50" max="2000"
                  value={getVal('checkin_radius')}
                  onChange={onNumChange('checkin_radius')} onBlur={onNumBlur('checkin_radius', 50, 2000, 200)}
                  className="border border-gray-300 rounded px-2 py-1 text-sm w-24 focus:outline-none"
                />
              </SettingRow>
              <p className="text-xs text-gray-400">经纬度可在高德地图网页版右键点击地点获取。Key 需在高德开放平台申请"Web 服务"类型。</p>
              <SaveButton onClick={() => savePanelSettings(['amap_web_key', 'store_lat', 'store_lng', 'checkin_radius'])} saving={saving} />
            </div>
          </PanelSection>

          {/* ⑧ 账号模式 */}
          <PanelSection
            title="账号模式"
            open={openPanel === '账号模式'}
            onToggle={() => handlePanelToggle('账号模式')}
          >
            <div className="space-y-3">
              <div className="text-xs text-gray-400">选择员工使用账号的方式，影响业绩归属和操作人选择</div>
              {[
                { value: 'individual', label: '每人一账号', desc: '各员工独立账号登录，系统自动按登录人归属业绩' },
                { value: 'shared', label: '店铺共用账号', desc: '多人共用一个员工账号，每次操作手动选择当前员工' },
              ].map(({ value, label, desc }) => {
                const current = getVal('account_mode') || 'individual'
                return (
                  <button
                    key={value}
                    onClick={() => updateSetting('account_mode', value)}
                    className={`w-full text-left px-4 py-3 rounded-xl border transition-colors ${
                      current === value ? 'border-pink-400 bg-pink-50' : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium text-sm text-gray-800">{label}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{desc}</div>
                  </button>
                )
              })}
              <SaveButton onClick={() => savePanelSettings(['account_mode'])} saving={saving} />
            </div>
          </PanelSection>

          <PanelSection
            title="会员标签阈值"
            open={openPanel === '会员标签阈值'}
            onToggle={() => handlePanelToggle('会员标签阈值')}
          >
            <div className="px-4 pb-4 space-y-3">
              <SettingRow label="高频客月均次数 ≥">
                <input type="number" min="1"
                  value={getVal('tag_high_freq_min')}
                  onChange={onNumChange('tag_high_freq_min')} onBlur={onNumBlur('tag_high_freq_min', 1, undefined, 4)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">次</span>
              </SettingRow>
              <SettingRow label="大客户累计消费 ≥">
                <input type="number" min="0"
                  value={getVal('tag_big_spender_min')}
                  onChange={onNumChange('tag_big_spender_min')} onBlur={onNumBlur('tag_big_spender_min', 0, undefined, 3000)}
                  className="w-24 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">元</span>
              </SettingRow>
              <p className="text-xs text-gray-400 -mt-1">统计近 1 年内的消费（含退款抵减）</p>
              <SettingRow label="沉睡客未到店 ≥">
                <input type="number" min="1"
                  value={getVal('tag_dormant_days')}
                  onChange={onNumChange('tag_dormant_days')} onBlur={onNumBlur('tag_dormant_days', 1, undefined, 30)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">天</span>
              </SettingRow>
              <SettingRow label="新客首次到店 ≤">
                <input type="number" min="1"
                  value={getVal('tag_new_days')}
                  onChange={onNumChange('tag_new_days')} onBlur={onNumBlur('tag_new_days', 1, undefined, 30)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">天</span>
              </SettingRow>
              <SaveButton onClick={() => savePanelSettings(['tag_high_freq_min', 'tag_big_spender_min', 'tag_dormant_days', 'tag_new_days'])} saving={saving} />
            </div>
          </PanelSection>

          <PanelSection
            title="AI 召回"
            open={openPanel === 'AI 召回'}
            onToggle={() => handlePanelToggle('AI 召回')}
          >
            <div className="space-y-3 pt-2">
              <p className="text-xs text-gray-400">每日开店打开系统时自动扫描沉睡且有剩余次数的会员，推送至首页铃铛</p>
              <SettingRow label="每日推送上限">
                <input type="number" min="1" max="9"
                  value={getVal('recall_daily_limit')}
                  onChange={onNumChange('recall_daily_limit')} onBlur={onNumBlur('recall_daily_limit', 1, 9, 9)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">条（最多 9 条）</span>
              </SettingRow>
              <SettingRow label="联系后冷却期">
                <input type="number" min="1"
                  value={getVal('recall_contact_cooldown_days')}
                  onChange={onNumChange('recall_contact_cooldown_days')} onBlur={onNumBlur('recall_contact_cooldown_days', 1, undefined, 7)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">天内不再推送</span>
              </SettingRow>
              <SettingRow label="DeepSeek API Key">
                <input type="password"
                  value={getVal('deepseek_api_key')}
                  onChange={(e) => updateSetting('deepseek_api_key', e.target.value)}
                  placeholder="sk-..."
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" />
              </SettingRow>
              <p className="text-xs text-gray-400">用于生成召回话术；也可在 .env 配置 VITE_DEEPSEEK_API_KEY</p>
              <SaveButton onClick={() => savePanelSettings(['recall_daily_limit', 'recall_contact_cooldown_days', 'deepseek_api_key'])} saving={saving} />
            </div>
          </PanelSection>

          <PanelSection
            title="经营报告"
            open={openPanel === '经营报告'}
            onToggle={() => handlePanelToggle('经营报告')}
          >
            <div className="space-y-3 pt-2">
              <p className="text-xs text-gray-400">每周/每月首次进入老板看板时自动生成异常检测，仅在看板展示</p>
              <SettingRow label="启用经营报告">
                <input type="checkbox" checked={getVal('business_report_enabled') !== false && getVal('business_report_enabled') !== 'false'}
                  onChange={(e) => updateSetting('business_report_enabled', e.target.checked)}
                  className="w-4 h-4" />
              </SettingRow>
              <SettingRow label="销售额偏离阈值">
                <input type="number" min="5" max="100"
                  value={getVal('anomaly_sales_pct_threshold')}
                  onChange={onNumChange('anomaly_sales_pct_threshold')} onBlur={onNumBlur('anomaly_sales_pct_threshold', 5, 100, 20)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">%（较基线均值）</span>
              </SettingRow>
              <SettingRow label="客单价偏离阈值">
                <input type="number" min="5" max="100"
                  value={getVal('anomaly_aov_pct_threshold')}
                  onChange={onNumChange('anomaly_aov_pct_threshold')} onBlur={onNumBlur('anomaly_aov_pct_threshold', 5, 100, 20)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">%</span>
              </SettingRow>
              <SettingRow label="退款率偏离阈值">
                <input type="number" min="10" max="200"
                  value={getVal('anomaly_refund_pct_threshold')}
                  onChange={onNumChange('anomaly_refund_pct_threshold')} onBlur={onNumBlur('anomaly_refund_pct_threshold', 10, 200, 50)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">%（较基线增幅）</span>
              </SettingRow>
              <SaveButton onClick={() => savePanelSettings([
                'business_report_enabled',
                'anomaly_sales_pct_threshold',
                'anomaly_aov_pct_threshold',
                'anomaly_refund_pct_threshold',
              ])} saving={saving} />
            </div>
          </PanelSection>

          <PanelSection
            title="员工异常"
            open={openPanel === '员工异常'}
            onToggle={() => handlePanelToggle('员工异常')}
          >
            <div className="space-y-3 pt-2">
              <p className="text-xs text-gray-400">每月按经营月报节奏检测员工折扣/退款/非营业时间异常，仅老板看板展示</p>
              <SettingRow label="启用员工异常检测">
                <input type="checkbox" checked={getVal('staff_anomaly_enabled') !== false && getVal('staff_anomaly_enabled') !== 'false'}
                  onChange={(e) => updateSetting('staff_anomaly_enabled', e.target.checked)}
                  className="w-4 h-4" />
              </SettingRow>
              <SettingRow label="个人低折扣阈值">
                <input type="number" min="5" max="50"
                  value={getVal('staff_discount_personal_threshold')}
                  onChange={onNumChange('staff_discount_personal_threshold')} onBlur={onNumBlur('staff_discount_personal_threshold', 5, 50, 10)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">%（低于个人历史均值）</span>
              </SettingRow>
              <SettingRow label="较全店低折扣阈值">
                <input type="number" min="5" max="50"
                  value={getVal('staff_discount_store_threshold')}
                  onChange={onNumChange('staff_discount_store_threshold')} onBlur={onNumBlur('staff_discount_store_threshold', 5, 50, 15)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">%（低于全店均值）</span>
              </SettingRow>
              <SettingRow label="退款率倍数阈值">
                <input type="number" min="1.5" max="10" step="0.5"
                  value={getVal('staff_refund_multiplier_threshold')}
                  onChange={onNumChange('staff_refund_multiplier_threshold')} onBlur={onNumBlur('staff_refund_multiplier_threshold', 1.5, 10, 2)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">倍（较个人历史）</span>
              </SettingRow>
              <SettingRow label="低折扣抽查线">
                <input type="number" min="1" max="10" step="0.5"
                  value={getVal('staff_low_discount_zhe')}
                  onChange={onNumChange('staff_low_discount_zhe')} onBlur={onNumBlur('staff_low_discount_zhe', 1, 10, 7)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">折（统计低于该折的订单笔数）</span>
              </SettingRow>
              <SettingRow label="最少成交笔数">
                <input type="number" min="1" max="30"
                  value={getVal('staff_min_purchase_orders')}
                  onChange={onNumChange('staff_min_purchase_orders')} onBlur={onNumBlur('staff_min_purchase_orders', 1, 30, 5)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                <span className="text-sm text-gray-400">笔（不足则跳过折扣/退款检测）</span>
              </SettingRow>
              <SaveButton onClick={() => savePanelSettings([
                'staff_anomaly_enabled',
                'staff_discount_personal_threshold',
                'staff_discount_store_threshold',
                'staff_refund_multiplier_threshold',
                'staff_low_discount_zhe',
                'staff_min_purchase_orders',
              ])} saving={saving} />
            </div>
          </PanelSection>

          <PanelSection
            title="储值卡"
            open={openPanel === '储值卡'}
            onToggle={() => handlePanelToggle('储值卡')}
          >
            <div className="space-y-3 pt-2">
              <SettingRow label="启用储值卡">
                <input type="checkbox" checked={!!getVal('balance_enabled')}
                  onChange={(e) => updateSetting('balance_enabled', e.target.checked)}
                  className="w-4 h-4" />
              </SettingRow>
              <div>
                <div className="text-sm text-gray-600 mb-2">充值档位</div>
                {toArray(getVal('balance_topup_tiers') || settings['balance_topup_tiers'] || []).map((tier, idx) => {
                  const tiers = toArray(getVal('balance_topup_tiers') || settings['balance_topup_tiers'] || [])
                  return (
                    <div key={idx} className="flex items-center gap-2 mb-2">
                      <span className="text-sm text-gray-500 shrink-0">充值 ≥</span>
                      <input type="number" min="0"
                        value={tier.min_amount ?? ''}
                        onChange={(e) => {
                          const next = tiers.map((t, i) => i === idx ? { ...t, min_amount: e.target.value } : t)
                          updateSetting('balance_topup_tiers', next)
                        }}
                        onBlur={(e) => {
                          const n = Number(e.target.value)
                          const next = tiers.map((t, i) => i === idx ? { ...t, min_amount: isNaN(n) ? 0 : Math.max(0, n) } : t)
                          updateSetting('balance_topup_tiers', next)
                        }}
                        className="w-24 border border-gray-300 rounded px-2 py-1 text-sm" />
                      <span className="text-sm text-gray-500 shrink-0">元，赠</span>
                      <input type="number" min="0" max="100" step="0.1"
                        value={tier.bonus_rate ?? ''}
                        onChange={(e) => {
                          const next = tiers.map((t, i) => i === idx ? { ...t, bonus_rate: e.target.value } : t)
                          updateSetting('balance_topup_tiers', next)
                        }}
                        onBlur={(e) => {
                          const n = Number(e.target.value)
                          const next = tiers.map((t, i) => i === idx ? { ...t, bonus_rate: isNaN(n) ? 0 : Math.min(100, Math.max(0, n)) } : t)
                          updateSetting('balance_topup_tiers', next)
                        }}
                        className="w-20 border border-gray-300 rounded px-2 py-1 text-sm" />
                      <span className="text-sm text-gray-500 shrink-0">%</span>
                      <button onClick={() => {
                        const next = tiers.filter((_, i) => i !== idx)
                        updateSetting('balance_topup_tiers', next)
                      }} className="text-gray-300 hover:text-red-400 text-base">✕</button>
                    </div>
                  )
                })}
                <button
                  onClick={() => {
                    const tiers = toArray(getVal('balance_topup_tiers') || settings['balance_topup_tiers'] || [])
                    updateSetting('balance_topup_tiers', [...tiers, { min_amount: 0, bonus_rate: 0 }])
                  }}
                  className="text-sm text-pink-500 hover:text-pink-600"
                >+ 添加档位</button>
              </div>
              <p className="text-xs text-gray-400">示例：充值 ≥ 1000 元赠 10%，则充1000到账1100元</p>
              <SaveButton onClick={() => savePanelSettings(['balance_enabled', 'balance_topup_tiers'])} saving={saving} />
            </div>
          </PanelSection>

          {/* ⑪ 悬浮键盘 */}
          <PanelSection
            title="悬浮键盘"
            open={openPanel === '悬浮键盘'}
            onToggle={() => handlePanelToggle('悬浮键盘')}
          >
            <div className="space-y-3 pt-2">
              <SettingRow label="悬浮数字键盘">
                <input
                  type="checkbox"
                  checked={!!getVal('floating_keyboard_enabled')}
                  onChange={(e) => updateSetting('floating_keyboard_enabled', e.target.checked)}
                  className="w-4 h-4"
                />
              </SettingRow>
              <p className="text-xs text-gray-400">
                开启后屏幕边缘显示 1️⃣ 按钮，点击数字输入框自动唤出悬浮键盘；再次点击同一输入框改用系统键盘
              </p>
              <SaveButton onClick={() => savePanelSettings(['floating_keyboard_enabled'])} saving={saving} />
            </div>
          </PanelSection>

          {/* ⑫ 核销设置 */}
          <PanelSection
            title="核销设置"
            open={openPanel === '核销设置'}
            onToggle={() => handlePanelToggle('核销设置')}
          >
            <div className="space-y-3 pt-2">
              <SettingRow label="单次核销每商品最多消耗次数">
                <input type="number" min="1" value={getVal('checkout_max_per_item')}
                  onChange={onNumChange('checkout_max_per_item')} onBlur={onNumBlur('checkout_max_per_item', 1, undefined, 2)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-center" />
              </SettingRow>
              <SettingRow label="单次核销最多项目数（0=不限）">
                <input type="number" min="0" value={getVal('checkout_max_projects')}
                  onChange={onNumChange('checkout_max_projects')} onBlur={onNumBlur('checkout_max_projects', 0)}
                  className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-center" />
              </SettingRow>
              <p className="text-xs text-gray-400">同时限制单次预约可选的项目数量</p>
              <SettingRow label="允许超规定次数核销">
                <input type="checkbox" checked={!!getVal('allow_over_checkout')}
                  onChange={(e) => updateSetting('allow_over_checkout', e.target.checked)}
                  className="w-4 h-4" />
              </SettingRow>
              <p className="text-xs text-gray-400">
                关闭后核销页不再显示「超核销」，且项目管理中「最多手工次数」隐藏并自动等于规定次数
              </p>
              <SettingRow label="销售收款自动抹零">
                <input type="checkbox" checked={!!getVal('auto_round_enabled')}
                  onChange={(e) => updateSetting('auto_round_enabled', e.target.checked)}
                  className="w-4 h-4" />
              </SettingRow>
              <p className="text-xs text-gray-400">
                开启后销售应收金额向下抹到「角」（舍去分），如 ¥99.87 收 ¥99.80；抹掉的零头记为「抹零」让利
              </p>
              <SaveButton onClick={() => savePanelSettings(['checkout_max_per_item', 'checkout_max_projects', 'allow_over_checkout', 'auto_round_enabled'])} saving={saving} />
            </div>
          </PanelSection>

          {/* ⑬ 会员项目地图 */}
          <ProjectMapPanel
            getVal={getVal}
            updateSetting={updateSetting}
            savePanelSettings={savePanelSettings}
            saving={saving}
            categoryTemplates={getCategoryTemplates(getVal('project_categories'), projects)}
            open={openPanel === '会员项目地图'}
            onToggle={() => handlePanelToggle('会员项目地图')}
          />

          </div>
        )}

        <div className="pt-4 pb-2 space-y-2">
          {isDemoMode && (
            <button
              type="button"
              onClick={() => {
                if (confirm('将清空本机演示改动并恢复种子数据，是否继续？')) resetDemoData()
              }}
              className="w-full py-3 rounded-xl text-sm font-medium bg-sky-50 text-sky-700 border border-sky-100 hover:bg-sky-100 transition-colors"
            >
              重置演示数据
            </button>
          )}
          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-3 rounded-xl text-sm font-medium bg-red-50 text-red-500 border border-red-100 hover:bg-red-100 hover:text-red-600 transition-colors"
          >
            退出
          </button>
        </div>
      </div>
    </div>
  )
}

