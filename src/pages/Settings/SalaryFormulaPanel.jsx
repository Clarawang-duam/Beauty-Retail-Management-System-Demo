// 薪酬计算面板：工资公式（按等级分组，组内多模块）编辑器。
// 自包含其编辑状态；公式值通过 getVal/updateSetting 读写父级 editValues。
import { useState } from 'react'
import { PanelSection, SaveButton } from './SettingsUI'
import { formatSalesCountProductLabel } from '../../domain/salary'

const FIXED_ONLY_MODULES = new Set(['底薪', '账目管理费', '货物管理费', '员工管理费', '手机费', '餐补', '满勤', '目标激励', '回店留存客人数'])
const LINKED_ONLY_MODULES = new Set(['员工本月销售总额', '商品销售数量', '拓客人数', '人数'])
const AUTO_LINKED_MODULES = new Set(['员工本月销售总额'])

const MODULE_NOTES = {
  '底薪':       '每月固定底薪，日/周维度按天数比例折算',
  '货物管理费': '每月固定，按统计周期比例计入',
  '账目管理费': '每月固定，按统计周期比例计入',
  '员工管理费': '每月固定，按统计周期比例计入',
  '手机费':     '每月固定，按统计周期比例计入',
  '餐补':       '按实际出勤计算：工时满6h计1餐，加班计2餐；此处填写每餐单价',
  '满勤':       '本月有缺勤、漏卡、迟到或早退即清零；带薪休假超过2天也清零',
  '次数计手工费': '每次核销计一次，固定单价，与项目金额无关（区别于项目计手工费）',
  '回店留存客人数': '本月有核销预约的会员去重人数 × 每人单价；新老客均计入',
  '拓客人数':   '需手动选择关联方式和系数',
  '人数':       '需手动选择关联方式和系数',
}

const GROUP_COLORS = [
  { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-700',    pill: 'bg-blue-100 text-blue-700'    },
  { bg: 'bg-violet-50',  border: 'border-violet-200',  text: 'text-violet-700',  pill: 'bg-violet-100 text-violet-700'  },
  { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   pill: 'bg-amber-100 text-amber-700'   },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', pill: 'bg-emerald-100 text-emerald-700' },
  { bg: 'bg-rose-50',    border: 'border-rose-200',    text: 'text-rose-700',    pill: 'bg-rose-100 text-rose-700'    },
]

const AVAILABLE_MODULES = [
  { name: '底薪',       type: 'fixed_monthly' },
  { name: '次数计手工费', type: 'auto_fee'      },
  { name: '项目计手工费', type: 'auto_project_fee_base' },
  { name: '员工本月销售总额', type: 'auto_sales_amount' },
  { name: '商品销售数量',     type: 'auto_sales_count'  },
  { name: '货物管理费', type: 'fixed_monthly' },
  { name: '账目管理费', type: 'fixed_monthly' },
  { name: '员工管理费', type: 'fixed_monthly' },
  { name: '手机费',     type: 'fixed_monthly' },
  { name: '满勤',       type: 'fixed_monthly' },
  { name: '目标激励',   type: 'fixed_monthly' },
  { name: '餐补',       type: 'fixed_monthly' },
  { name: '拓客人数',       type: 'count_rate' },
  { name: '回店留存客人数', type: 'count_rate' },
  { name: '人数',           type: 'count_rate' },
  { name: '学习打卡次数',   type: 'count_rate' },
]

export default function SalaryFormulaPanel({ getVal, updateSetting, savePanelSettings, saving, products, open, onToggle }) {
  const [formulaLevel, setFormulaLevel] = useState('高级')
  const [activePickerGroup, setActivePickerGroup] = useState(null)
  const [editingGroupName, setEditingGroupName] = useState(null)
  const [productSearch, setProductSearch] = useState({})

  const getSalaryFormula = () => {
    const raw = getVal('salary_formula')
    if (!raw || raw === '') return { 高级: [], 中级: [], 初级: [] }
    return raw
  }

  // 兼容旧扁平格式：自动升级为 group 结构
  const normalizeGroups = (levelData) => {
    if (!levelData || levelData.length === 0) return []
    if ('modules' in levelData[0]) return levelData
    return [{ group_id: 'default', group_name: '默认组', multiplier: 1, modules: levelData }]
  }

  const getGroups = () => normalizeGroups(getSalaryFormula()[formulaLevel] || [])

  const saveGroups = (groups) => {
    updateSetting('salary_formula', { ...getSalaryFormula(), [formulaLevel]: groups })
  }

  const addGroup = () => {
    saveGroups([...getGroups(), {
      group_id: Date.now().toString(),
      group_name: '新组',
      group_op: '+',
      multiplier: 1,
      modules: [],
    }])
  }

  const removeGroup = (gIdx) => {
    saveGroups(getGroups().filter((_, i) => i !== gIdx))
  }

  const updateGroup = (gIdx, field, value) => {
    const groups = getGroups()
    const updated = [...groups]
    updated[gIdx] = { ...updated[gIdx], [field]: value }
    saveGroups(updated)
  }

  const addFormulaModule = (mod, gIdx) => {
    const groups = getGroups()
    const updated = [...groups]
    updated[gIdx] = {
      ...updated[gIdx],
      modules: [...(updated[gIdx].modules || []), {
        id: Date.now().toString(),
        module: mod.name,
        op: '+',
        mode: 'fixed',
        value: 0,
        linkType: null,
        linkedProductIds: [],
        linkedLabel: '',
        linkedRate: mod.name === '项目计手工费'
          ? (Number(getVal('formula_coefficient', 0.2)) || 0.2)
          : 1,
        ...(mod.name === '项目计手工费' ? { denominatorType: 'max' } : {}),
        ...(mod.name === '拓客人数' ? { mode: 'linked', linkType: 'product_count' } : {}),
      }],
    }
    saveGroups(updated)
  }

  const removeFormulaModule = (gIdx, mIdx) => {
    const groups = getGroups()
    const updated = [...groups]
    const modules = [...(updated[gIdx].modules || [])]
    modules.splice(mIdx, 1)
    updated[gIdx] = { ...updated[gIdx], modules }
    saveGroups(updated)
  }

  const updateFormulaModule = (gIdx, mIdx, fieldOrObj, value) => {
    const groups = getGroups()
    const updated = [...groups]
    const modules = [...(updated[gIdx].modules || [])]
    modules[mIdx] = typeof fieldOrObj === 'object'
      ? { ...modules[mIdx], ...fieldOrObj }
      : { ...modules[mIdx], [fieldOrObj]: value }
    updated[gIdx] = { ...updated[gIdx], modules }
    saveGroups(updated)
  }

  return (
    <PanelSection title="薪酬计算" open={open} onToggle={onToggle}>
      <div className="space-y-3 pt-2">
        {/* 工资公式 */}
        <div className="pt-3 border-t border-gray-100">
          <div className="text-sm font-medium text-gray-700 mb-2">工资公式（按等级）</div>
          <div className="flex gap-1 mb-3">
            {['高级', '中级', '初级'].map((lv) => (
              <button key={lv} onClick={() => { setFormulaLevel(lv); setActivePickerGroup(null) }}
                className={`px-3 py-1 rounded-full text-xs transition-colors ${
                  formulaLevel === lv ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-600'
                }`}>
                {lv}
              </button>
            ))}
          </div>

          {(() => {
            const groups = getGroups()
            return (
              <div className="space-y-3">
                {groups.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-2">暂无模块组，点击下方添加</p>
                )}

                {groups.map((group, gIdx) => {
                  const color = GROUP_COLORS[gIdx % GROUP_COLORS.length]
                  const OPS = ['+', '-', '×', '÷']
                  return (
                  <div key={group.group_id}>
                    {gIdx > 0 && (
                      <div className="flex justify-center py-1">
                        <button
                          type="button"
                          onClick={() => {
                            const cur = group.group_op || '+'
                            updateGroup(gIdx, 'group_op', OPS[(OPS.indexOf(cur) + 1) % OPS.length])
                          }}
                          className="w-8 h-8 rounded-full bg-gray-100 hover:bg-pink-100 text-gray-600 hover:text-pink-600 font-bold text-sm flex items-center justify-center transition-colors"
                        >
                          {group.group_op || '+'}
                        </button>
                      </div>
                    )}
                    <div className={`border rounded-xl overflow-hidden ${color.border}`}>
                    {/* 组头 */}
                    <div className={`flex items-center px-3 py-2 border-b ${color.bg} ${color.border}`}>
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {editingGroupName === gIdx ? (
                          <input
                            type="text"
                            autoFocus
                            value={group.group_name}
                            onChange={(e) => updateGroup(gIdx, 'group_name', e.target.value)}
                            onBlur={() => setEditingGroupName(null)}
                            onKeyDown={(e) => e.key === 'Enter' && setEditingGroupName(null)}
                            className="flex-1 border border-pink-300 rounded px-2 py-0.5 text-sm font-medium text-gray-700 focus:outline-none min-w-0"
                          />
                        ) : (
                          <span
                            className="flex-1 text-sm font-medium text-gray-700 min-w-0 cursor-pointer select-none"
                            onClick={() => setEditingGroupName(gIdx)}
                          >
                            {group.group_name || '新组'}
                          </span>
                        )}
                        <span className="text-xs text-gray-400 shrink-0">×</span>
                        <input
                          type="number"
                          step="0.01"
                          value={group.multiplier ?? 1}
                          onChange={(e) => updateGroup(gIdx, 'multiplier', Number(e.target.value))}
                          className="w-16 border border-gray-200 rounded px-2 py-0.5 text-sm text-center focus:outline-none bg-white"
                        />
                      </div>
                      <button type="button" onClick={() => removeGroup(gIdx)}
                        className="ml-4 text-red-400 hover:text-red-600 text-xs shrink-0">删除组</button>
                    </div>

                    {/* 组内模块 */}
                    <div className="p-2 space-y-2">
                      {(group.modules || []).length === 0 && (
                        <p className="text-xs text-gray-400 text-center py-1">暂无模块</p>
                      )}
                      {(group.modules || []).map((mod, mIdx) => {
                        const isFixedOnly = FIXED_ONLY_MODULES.has(mod.module)
                        const isLinkedOnly = LINKED_ONLY_MODULES.has(mod.module)
                        const isAutoLinked = AUTO_LINKED_MODULES.has(mod.module)
                        const isFeeBase = mod.module === '项目计手工费'
                        const isPunchCount = mod.module === '学习打卡次数'
                        const isTargetBonus = mod.module === '目标激励'
                        const mode = isFixedOnly ? 'fixed' : isLinkedOnly ? 'linked' : (mod.mode || 'fixed')
                        return (
                          <div key={mod.id || mIdx} className="bg-gray-50 rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const MOD_OPS = ['+', '-', '×', '÷']
                                  const cur = mod.op || '+'
                                  updateFormulaModule(gIdx, mIdx, 'op', MOD_OPS[(MOD_OPS.indexOf(cur) + 1) % MOD_OPS.length])
                                }}
                                className={`w-7 h-7 rounded-full text-sm font-bold flex items-center justify-center shrink-0 transition-colors ${
                                  mod.op === '-' ? 'bg-red-100 text-red-700' : (mod.op === '×' || mod.op === '÷') ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
                                }`}
                              >
                                {mod.op || '+'}
                              </button>
                              <span className="text-sm flex-1 text-gray-700 font-medium truncate">
                                {mode === 'linked' && mod.linkedLabel ? mod.linkedLabel : mod.module}
                              </span>
                              {isPunchCount ? null
                              : isFeeBase ? (
                                <div className="flex rounded-full border border-gray-200 text-xs overflow-hidden shrink-0">
                                  <button type="button"
                                    onClick={() => updateFormulaModule(gIdx, mIdx, 'denominatorType', 'total')}
                                    className={`px-2.5 py-1 transition-colors ${(mod.denominatorType || 'max') === 'total' ? 'bg-pink-500 text-white' : 'text-gray-500'}`}>
                                    规定次数
                                  </button>
                                  <button type="button"
                                    onClick={() => updateFormulaModule(gIdx, mIdx, 'denominatorType', 'max')}
                                    className={`px-2.5 py-1 transition-colors ${(mod.denominatorType || 'max') === 'max' ? 'bg-pink-500 text-white' : 'text-gray-500'}`}>
                                    max次数
                                  </button>
                                </div>
                              ) : !isFixedOnly && !isLinkedOnly ? (
                                <div className="flex rounded-full border border-gray-200 text-xs overflow-hidden shrink-0">
                                  <button type="button"
                                    onClick={() => updateFormulaModule(gIdx, mIdx, 'mode', 'fixed')}
                                    className={`px-2.5 py-1 transition-colors ${mode !== 'linked' ? 'bg-pink-500 text-white' : 'text-gray-500'}`}>
                                    固定金额
                                  </button>
                                  <button type="button"
                                    onClick={() => updateFormulaModule(gIdx, mIdx, 'mode', 'linked')}
                                    className={`px-2.5 py-1 transition-colors ${mode === 'linked' ? 'bg-pink-500 text-white' : 'text-gray-500'}`}>
                                    关联
                                  </button>
                                </div>
                              ) : null}
                              <button type="button" onClick={() => removeFormulaModule(gIdx, mIdx)}
                                className="text-red-400 hover:text-red-600 text-sm shrink-0">✕</button>
                            </div>

                            {isPunchCount ? (
                              <div className="pl-9 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 text-xs">¥</span>
                                  <input type="number" step="0.01" value={mod.linkedRate ?? ''}
                                    onChange={(e) => updateFormulaModule(gIdx, mIdx, 'linkedRate', Number(e.target.value))}
                                    className="w-20 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none" />
                                  <span className="text-xs text-gray-400">/次（学习打卡）</span>
                                </div>
                                <p className="text-xs text-gray-400">次数自动统计本月学习打卡记录</p>
                              </div>
                            ) : isTargetBonus ? (
                              <div className="pl-9 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 text-xs">¥</span>
                                  <input type="number" value={mod.value ?? ''}
                                    onChange={(e) => updateFormulaModule(gIdx, mIdx, 'value', Number(e.target.value))}
                                    className="w-24 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none" />
                                  <span className="text-xs text-gray-400">/月</span>
                                </div>
                                <p className="text-xs text-gray-400">员工本月销售额 ≥ 员工目标时计入</p>
                              </div>
                            ) : isFeeBase ? (
                              <div className="pl-9 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 text-xs">×</span>
                                  <input
                                    type="number"
                                    step="0.01"
                                    min="0"
                                    value={mod.linkedRate ?? ''}
                                    onChange={(e) => updateFormulaModule(gIdx, mIdx, 'linkedRate', Number(e.target.value))}
                                    className="w-20 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none"
                                  />
                                  <span className="text-xs text-gray-400">系数（核销手工费与薪酬共用）</span>
                                </div>
                                <p className="text-xs text-gray-400">
                                  = Σ(项目实付金额 ÷ {(mod.denominatorType || 'max') === 'total' ? '规定次数' : 'max(规定次数, 实际次数)'}）× 系数
                                </p>
                                <p className="text-xs text-gray-400">与次数计手工费不同：金额与项目实付金额挂钩，超规定次数后单次金额递减</p>
                              </div>
                            ) : isAutoLinked ? (
                              <div className="pl-9 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 text-xs">×</span>
                                  <input type="number" step="0.01" value={mod.linkedRate ?? ''}
                                    onChange={(e) => updateFormulaModule(gIdx, mIdx, 'linkedRate', Number(e.target.value))}
                                    className="w-20 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none" />
                                  <span className="text-xs text-gray-400">提成率</span>
                                </div>
                                <p className="text-xs text-gray-400">自动统计本员工本月销售总金额</p>
                              </div>
                            ) : mode !== 'linked' ? (
                              <div className="pl-9 space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-gray-400 text-xs">¥</span>
                                  <input type="number" value={mod.value ?? ''}
                                    onChange={(e) => updateFormulaModule(gIdx, mIdx, 'value', Number(e.target.value))}
                                    className="w-24 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none" />
                                  <span className="text-xs text-gray-400">{mod.module === '餐补' ? '/餐' : mod.module === '回店留存客人数' ? '/人' : '/月'}</span>
                                </div>
                                {MODULE_NOTES[mod.module] && (
                                  <p className="text-xs text-gray-400">{MODULE_NOTES[mod.module]}</p>
                                )}
                              </div>
                            ) : (
                              <div className="pl-9 space-y-2">
                                {mod.module !== '商品销售数量' && (
                                  <div className="space-y-1">
                                    {[
                                      { value: 'product_count',        label: '商品消费数量' },
                                      { value: 'sales_amount',         label: '员工销售总金额' },
                                      { value: 'checkout_count',       label: '核销手工次数' },
                                    ].filter((opt) => {
                                      if (opt.value === 'checkout_count') return mod.module === '次数计手工费'
                                      if (opt.value === 'product_count' || opt.value === 'sales_amount') return mod.module !== '次数计手工费'
                                      return true
                                    }).map((opt) => (
                                      <label key={opt.value} className={`flex items-center gap-2 ${opt.todo ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
                                        <input type="radio" name={`linkType-${mod.id}`}
                                          checked={mod.linkType === opt.value}
                                          onChange={() => !opt.todo && updateFormulaModule(gIdx, mIdx, 'linkType', opt.value)}
                                          disabled={opt.todo}
                                          className="accent-pink-500" />
                                        <span className="text-xs text-gray-600">
                                          {opt.label}
                                          {opt.todo && <span className="ml-1 text-gray-400">（待开发）</span>}
                                        </span>
                                      </label>
                                    ))}
                                  </div>
                                )}

                                {(mod.module === '商品销售数量' || mod.linkType === 'product_count') && (
                                  <div>
                                    <div className="text-xs text-gray-500 mb-1">关联商品（可多选{mod.module === '商品销售数量' ? '，不选则统计所有' : ''}）</div>
                                    {mod.module === '商品销售数量' && (
                                      <input
                                        type="text"
                                        placeholder="搜索商品名称"
                                        value={productSearch[mod.id] || ''}
                                        onChange={(e) => setProductSearch(prev => ({ ...prev, [mod.id]: e.target.value }))}
                                        className="w-full border border-gray-200 rounded px-2 py-1 text-xs mb-1.5 focus:outline-none focus:border-pink-300"
                                      />
                                    )}
                                    <div className="max-h-24 overflow-y-auto border border-gray-200 rounded-lg p-2 flex flex-wrap gap-1.5 bg-white">
                                      {products
                                        .filter(p => !productSearch[mod.id] || p.name.includes(productSearch[mod.id]))
                                        .map((p) => {
                                        const sel = (mod.linkedProductIds || []).includes(p._id)
                                        return (
                                          <button key={p._id} type="button"
                                            onClick={() => {
                                              const newIds = sel
                                                ? (mod.linkedProductIds || []).filter((id) => id !== p._id)
                                                : [...(mod.linkedProductIds || []), p._id]
                                              const label = newIds.length > 0
                                                ? '【' + products.filter((pr) => newIds.includes(pr._id)).map((pr) => pr.name).join('、') + '的数量】'
                                                : ''
                                              updateFormulaModule(gIdx, mIdx, { linkedProductIds: newIds, linkedLabel: label })
                                            }}
                                            className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                                              sel ? 'bg-pink-500 text-white border-pink-500' : 'bg-white text-gray-600 border-gray-200'
                                            }`}>
                                            {p.name}
                                          </button>
                                        )
                                      })}
                                    </div>
                                  </div>
                                )}

                                {(mod.module === '商品销售数量' || mod.linkType) && (
                                  <div className="flex items-center gap-2">
                                    <span className="text-gray-400 text-xs">×</span>
                                    <input type="number" step="0.01" value={mod.linkedRate ?? ''}
                                      onChange={(e) => updateFormulaModule(gIdx, mIdx, 'linkedRate', Number(e.target.value))}
                                      className="w-20 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none" />
                                    <span className="text-xs text-gray-400">
                                      {mod.module === '商品销售数量' || mod.linkType === 'product_count' ? '¥/件'
                                        : mod.linkType === 'checkout_count' ? '¥/次'
                                        : '（提成率）'}
                                    </span>
                                  </div>
                                )}
                                {MODULE_NOTES[mod.module] && (
                                  <p className="text-xs text-gray-400">{MODULE_NOTES[mod.module]}</p>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {activePickerGroup === gIdx ? (
                        <div className="bg-white border border-gray-200 rounded-lg p-2 space-y-1">
                          <div className="grid grid-cols-2 gap-1">
                            {AVAILABLE_MODULES.map((m) => (
                              <button key={m.name} onClick={() => addFormulaModule(m, gIdx)}
                                className="text-left px-2 py-1.5 text-sm text-gray-700 hover:bg-pink-50 hover:text-pink-600 rounded transition-colors">
                                {m.name}
                              </button>
                            ))}
                          </div>
                          <button onClick={() => setActivePickerGroup(null)}
                            className="w-full text-center py-1.5 text-xs text-gray-500 border-t border-gray-100 hover:text-pink-500 transition-colors mt-1">
                            完成
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setActivePickerGroup(gIdx)}
                          className="w-full py-1.5 border-2 border-dashed border-gray-200 rounded-lg text-xs text-gray-400 hover:border-pink-300 hover:text-pink-400 transition-colors">
                          + 添加模块
                        </button>
                      )}
                    </div>
                    </div>
                  </div>
                  )
                })}

                <button onClick={addGroup}
                  className="w-full py-2 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-400 hover:border-pink-300 hover:text-pink-400 transition-colors">
                  + 新增组
                </button>

                {/* 公式预览 */}
                {groups.some(g => (g.modules || []).length > 0) && (() => {
                  const getModDesc = (m) => {
                    const v = m.value || 0
                    const r = m.linkedRate ?? 0
                    if (m.module === '餐补') return `¥${v} / 餐`
                    if (m.module === '满勤') return `¥${v}（出勤达标）`
                    if (m.module === '目标激励') return `¥${v}（达成员工目标）`
                    if (m.module === '回店留存客人数') return `留存人数 × ¥${v} / 人`
                    if (m.module === '次数计手工费') return `核销次数 × ¥${r} / 次`
                    if (m.module === '学习打卡次数') return `打卡次数 × ¥${r} / 次`
                    if (m.module === '项目计手工费') return `Σ费基 × ${r}`
                    if (m.module === '员工本月销售总额') return `销售额 × ${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 2)}%`
                    if (m.module === '商品销售数量') {
                      const label = formatSalesCountProductLabel(m.linkedProductIds, products)
                      return `${label} × ¥${r} / 件`
                    }
                    if (m.module === '拓客人数' || m.module === '人数') return `人数 × ¥${r} / 人`
                    if (m.mode === 'linked') {
                      if (m.linkType === 'sales_amount') return `销售额 × ${(r * 100).toFixed(r * 100 % 1 === 0 ? 0 : 2)}%`
                      if (m.linkType === 'product_count') return `商品件数 × ¥${r}`
                      if (m.linkType === 'checkout_count') return `核销次数 × ¥${r}`
                      return `× ${r}`
                    }
                    return `¥${v} / 月`
                  }
                  return (
                    <div className="border border-gray-200 rounded-xl p-3 bg-white">
                      <p className="text-xs text-gray-400 mb-2">公式预览</p>
                      <p className="text-xs text-gray-500 font-medium mb-2">薪酬 =</p>
                      <div className="space-y-2">
                        {groups.map((group, gIdx) => {
                          const mods = group.modules || []
                          if (mods.length === 0) return null
                          const color = GROUP_COLORS[gIdx % GROUP_COLORS.length]
                          const prevHasMods = groups.slice(0, gIdx).some(g => (g.modules || []).length > 0)
                          const multiplier = group.multiplier ?? 1
                          return (
                            <div key={group.group_id}>
                              {prevHasMods && (
                                <div className="text-xs text-gray-400 font-bold pl-1 my-1">{group.group_op || '+'}</div>
                              )}
                              <div className={`rounded-lg border ${color.border} ${color.bg} overflow-hidden`}>
                                <div className={`flex items-center justify-between px-3 py-1.5 border-b ${color.border}`}>
                                  <span className={`text-xs font-semibold ${color.text}`}>
                                    {group.group_name || `组${gIdx + 1}`}
                                  </span>
                                  {multiplier !== 1 && (
                                    <span className={`text-xs font-bold ${color.text}`}>× {multiplier}</span>
                                  )}
                                </div>
                                <div className="px-3 py-1.5 space-y-1">
                                  {mods.map((m, i) => (
                                    <div key={m.id || i} className="flex items-baseline gap-2 text-xs">
                                      <span className="text-gray-400 w-3 shrink-0 text-center">{i === 0 ? '' : (m.op || '+')}</span>
                                      <span className="text-gray-700 font-medium shrink-0">{m.module}</span>
                                      <span className="text-gray-400">{getModDesc(m)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )
          })()}
        </div>

        <SaveButton onClick={() => savePanelSettings(['salary_formula'])} saving={saving} />
      </div>
    </PanelSection>
  )
}
