// 会员项目地图设置：开关 + 等级编辑（名称 + 解锁公式拼接器）。
// 公式 = 若干条件项用『和/或』左到右连接；条件项：项目大类 / 所有大类有任一项目(可除了) / 所有大类下都有项目。
import { useState } from 'react'
import { PanelSection, SettingRow, SaveButton } from './SettingsUI'
import { PROJECT_MAP_LEVELS, levelFormula } from '../../utils/projectMap'

export default function ProjectMapPanel({ getVal, updateSetting, savePanelSettings, saving, categoryTemplates, open, onToggle }) {
  const [showRules, setShowRules] = useState(false)
  const levels = (() => {
    const v = getVal('project_map_levels')
    return Array.isArray(v) ? v : PROJECT_MAP_LEVELS
  })()
  const enabled = !!getVal('project_map_enabled')

  const saveLevels = (next) => updateSetting('project_map_levels', next)
  const updateLevel = (idx, patch) => saveLevels(levels.map((lv, i) => (i === idx ? { ...lv, ...patch } : lv)))
  const getFormula = (lv) => levelFormula(lv)
  const setFormula = (idx, formula) => updateLevel(idx, { formula }) // 写 formula；旧 rule 由 levelFormula 兼容读取

  const addLevel = () => saveLevels([...levels, { id: Date.now().toString(), name: '新等级', formula: [] }])
  const removeLevel = (idx) => saveLevels(levels.filter((_, i) => i !== idx))

  const addTerm = (idx, term) => {
    const f = getFormula(levels[idx])
    const next = f.length === 0 ? [term] : [...f, { op: 'and', ...term }]
    setFormula(idx, next)
  }
  const removeTerm = (idx, ti) => {
    let f = getFormula(levels[idx]).filter((_, i) => i !== ti)
    if (f.length > 0) { const { op, ...rest } = f[0]; f = [rest, ...f.slice(1)] } // 首项去掉 op
    setFormula(idx, f)
  }
  const updateTerm = (idx, ti, patch) => {
    const f = getFormula(levels[idx]).map((t, i) => (i === ti ? { ...t, ...patch } : t))
    setFormula(idx, f)
  }
  const toggleExclude = (idx, ti, cat) => {
    const t = getFormula(levels[idx])[ti]
    const ex = t.exclude || []
    updateTerm(idx, ti, { exclude: ex.includes(cat) ? ex.filter((c) => c !== cat) : [...ex, cat] })
  }

  const Term = ({ idx, ti, term }) => (
    <div className="flex items-center gap-1 flex-wrap bg-gray-50 rounded-lg px-2 py-1">
      {ti > 0 && (
        <button type="button"
          onClick={() => updateTerm(idx, ti, { op: term.op === 'or' ? 'and' : 'or' })}
          className={`px-1.5 py-0.5 rounded text-xs font-bold ${term.op === 'or' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
          {term.op === 'or' ? '或' : '和'}
        </button>
      )}
      {term.type === 'cat' && (
        <select value={term.cat || ''} onChange={(e) => updateTerm(idx, ti, { cat: e.target.value })}
          className="border border-gray-200 rounded px-1.5 py-0.5 text-xs bg-white">
          <option value="">选大类</option>
          {categoryTemplates.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      )}
      {term.type === 'all' && <span className="text-xs text-gray-600">所有大类下都有项目</span>}
      {term.type === 'anyOf' && (
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-gray-600">所有大类有任一项目</span>
          <span className="text-[10px] text-gray-400">除了</span>
          {categoryTemplates.map((c) => {
            const on = (term.exclude || []).includes(c)
            return (
              <button key={c} type="button" onClick={() => toggleExclude(idx, ti, c)}
                className={`px-1.5 py-0.5 rounded-full text-[10px] border ${on ? 'bg-pink-500 text-white border-pink-500' : 'bg-white text-gray-500 border-gray-200'}`}>{c}</button>
            )
          })}
        </div>
      )}
      <button type="button" onClick={() => removeTerm(idx, ti)} className="text-red-400 hover:text-red-600 text-xs ml-0.5">✕</button>
    </div>
  )

  return (
    <PanelSection title="会员项目地图" open={open} onToggle={onToggle}>
      <div className="space-y-3 pt-2">
        <SettingRow label="启用会员项目地图">
          <button type="button" onClick={() => setShowRules(true)}
            className="text-xs text-pink-500 hover:text-pink-600 underline-offset-2 hover:underline">规则说明</button>
          <input type="checkbox" checked={enabled}
            onChange={(e) => updateSetting('project_map_enabled', e.target.checked)} className="w-4 h-4" />
        </SettingRow>

        {showRules && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-5">
              <h3 className="font-bold text-gray-800 text-lg mb-3">会员项目地图 · 规则说明</h3>
              <div className="space-y-3 text-sm text-gray-600 leading-relaxed">
                <div>
                  <div className="font-semibold text-gray-700">作用</div>
                  <p>在会员详情页展示该会员的"项目成就地图"，按其已拥有的项目大类点亮不同等级（已解锁=红色发光心形，未解锁=灰色心形并标「待解锁」）。</p>
                  <p>会员消费的项目<b>多不多、全不全</b>，往往映射出其<b>肌肤诉求、护肤认知、对门店的信任度、消费心态</b>等多方面情况。这张地图把这些信号一目了然地呈现，帮助美容师<b>更准确地解读会员、推荐更适合的项目与商品</b>。</p>
                </div>
                <div>
                  <div className="font-semibold text-gray-700">生效范围</div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    <li>展示位置：会员库 → 会员详情 → 右上区。</li>
                    <li>"拥有某大类" = 该会员名下有该大类、<b>未退款且剩余次数 &gt; 0</b> 的项目。</li>
                    <li>大类来自「项目管理 → ⋮ → 大类管理」的模版。</li>
                    <li>关闭此开关后，会员详情不再显示项目地图（"上次到店"仍保留）。</li>
                  </ul>
                </div>
                <div>
                  <div className="font-semibold text-gray-700">公式操作方法</div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    <li>每个等级一条"解锁公式"，由若干<b>条件项</b>用『和 / 或』连接，<b>从左到右顺序判断</b>（无括号优先级：A 和 B 或 C = (A 和 B) 或 C）。</li>
                    <li><b>项目大类</b>：拥有所选大类的任意项目。</li>
                    <li><b>所有大类有任一项目</b>：拥有任意一个大类的项目；可加『除了』排除指定大类，并会自动排除本公式里已写明的具体大类。</li>
                    <li><b>所有大类下都有项目</b>：拥有系统现有的全部大类。</li>
                    <li><b>『和』</b>=需同时满足，<b>『或』</b>=满足其一即可；点连接符可在两者间切换。</li>
                    <li>「✕」删除条件项，「+ 新增等级」添加等级。</li>
                  </ul>
                </div>
              </div>
              <button onClick={() => setShowRules(false)}
                className="mt-4 w-full py-2 bg-pink-500 text-white rounded-lg text-sm">确认</button>
            </div>
          </div>
        )}

        <div className="space-y-3 pt-2 border-t border-gray-100">
          {levels.map((lv, idx) => {
            const formula = getFormula(lv)
            return (
              <div key={lv.id || idx} className="border border-gray-200 rounded-xl p-3 space-y-2">
                <div>
                  <div className="text-xs text-gray-500 mb-1">等级名称</div>
                  <div className="flex items-center gap-2">
                    <input type="text" value={lv.name}
                      onChange={(e) => updateLevel(idx, { name: e.target.value })}
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm font-medium focus:outline-none" placeholder="等级名称" />
                    <button type="button" onClick={() => removeLevel(idx)} className="text-red-400 hover:text-red-600 text-xs shrink-0">删除</button>
                  </div>
                </div>

                <div className="text-xs text-gray-500">解锁公式</div>
                <div className="flex flex-wrap gap-1.5">
                  {formula.length === 0 && <span className="text-xs text-gray-400">未设置条件（不会解锁）</span>}
                  {formula.map((term, ti) => <Term key={ti} idx={idx} ti={ti} term={term} />)}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => addTerm(idx, { type: 'cat', cat: '' })}
                    className="px-2 py-0.5 rounded text-xs border border-dashed border-gray-300 text-gray-500 hover:border-pink-300 hover:text-pink-500">+ 项目大类</button>
                  <button type="button" onClick={() => addTerm(idx, { type: 'anyOf', exclude: [] })}
                    className="px-2 py-0.5 rounded text-xs border border-dashed border-gray-300 text-gray-500 hover:border-pink-300 hover:text-pink-500">+ 所有大类有任一项目</button>
                  <button type="button" onClick={() => addTerm(idx, { type: 'all' })}
                    className="px-2 py-0.5 rounded text-xs border border-dashed border-gray-300 text-gray-500 hover:border-pink-300 hover:text-pink-500">+ 所有大类下都有项目</button>
                </div>
              </div>
            )
          })}

          <button type="button" onClick={addLevel}
            className="w-full py-2 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-400 hover:border-pink-300 hover:text-pink-400 transition-colors">
            + 新增等级
          </button>
        </div>

        <SaveButton onClick={() => savePanelSettings(['project_map_enabled', 'project_map_levels'])} saving={saving} />
      </div>
    </PanelSection>
  )
}
