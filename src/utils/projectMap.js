// 项目地图：等级配置 + 解锁判定（纯函数，可单测）。
//
// 每个等级的解锁条件是一条「公式」：若干「条件项」用『和(and)/或(or)』左到右顺序连接。
// 条件项三种：
//   { type:'cat', cat }              —— 拥有该大类任意项目
//   { type:'anyOf', exclude:[...] }  —— 拥有"任意一个大类（除 exclude 及公式中已写明的具体大类）"的项目
//   { type:'all' }                   —— 拥有系统现有的全部大类
// 非首项带 op:'and'|'or'。左到右求值，无优先级。
//
// 兼容旧格式 rule:{type:'has'|'hasPlusOther'|'all'}（自动转公式）。
// 未来等级配置可整体挪到 settings 编辑——已是可 JSON 序列化结构。

export const PROJECT_MAP_LEVELS = [
  { id: 'basic', name: '基础项目',   formula: [{ type: 'cat', cat: '清洁类' }] },
  { id: 'combo', name: '组合项目',   formula: [{ type: 'cat', cat: '清洁类' }, { op: 'and', type: 'cat', cat: '补水类' }] },
  { id: 'multi', name: '多项目组合', formula: [{ type: 'cat', cat: '清洁类' }, { op: 'and', type: 'cat', cat: '补水类' }, { op: 'and', type: 'anyOf', exclude: ['面膜'] }] },
  { id: 'full',  name: '全家桶',     formula: [{ type: 'all' }] },
]

/** 会员拥有的大类：未退款且剩余次数>0 的项目所属大类 */
export function computeOwnedCategories(memberProjects, projects) {
  const nameToCat = {}
  for (const p of projects || []) nameToCat[p.name] = p.category
  const owned = new Set()
  for (const mp of memberProjects || []) {
    if (mp.status === 'refunded') continue
    if (!(mp.remaining_sessions > 0)) continue
    const cat = nameToCat[mp.project_name]
    if (cat) owned.add(cat)
  }
  return owned
}

/** 旧 rule → 公式 */
function ruleToFormula(rule) {
  if (!rule) return []
  if (rule.type === 'has') {
    return (rule.cats || []).map((c, i) => (i === 0 ? { type: 'cat', cat: c } : { op: 'and', type: 'cat', cat: c }))
  }
  if (rule.type === 'hasPlusOther') {
    const base = (rule.cats || []).map((c, i) => (i === 0 ? { type: 'cat', cat: c } : { op: 'and', type: 'cat', cat: c }))
    return [...base, { op: 'and', type: 'anyOf', exclude: rule.excludeOther || [] }]
  }
  if (rule.type === 'all') return [{ type: 'all' }]
  return []
}

/** 取等级的公式（优先 formula，否则由旧 rule 转换） */
export function levelFormula(level) {
  if (Array.isArray(level?.formula)) return level.formula
  return ruleToFormula(level?.rule)
}

function evalTerm(term, owned, allCats, namedCats) {
  if (term.type === 'cat') return owned.has(term.cat)
  if (term.type === 'all') return allCats.length > 0 && allCats.every((c) => owned.has(c))
  if (term.type === 'anyOf') {
    const ex = new Set([...(term.exclude || []), ...namedCats]) // 自动排除公式中已写明的具体大类
    return [...owned].some((c) => !ex.has(c))
  }
  return false
}

/** 公式是否解锁（左到右顺序求值） */
export function isFormulaUnlocked(formula, owned, allCats) {
  if (!Array.isArray(formula) || formula.length === 0) return false
  const namedCats = formula.filter((t) => t.type === 'cat').map((t) => t.cat)
  let result = evalTerm(formula[0], owned, allCats, namedCats)
  for (let i = 1; i < formula.length; i++) {
    const v = evalTerm(formula[i], owned, allCats, namedCats)
    result = formula[i].op === 'or' ? (result || v) : (result && v)
  }
  return result
}

/** 评估全部等级，返回 [{ ...level, unlocked }] */
export function evaluateProjectMap(memberProjects, projects, levels = PROJECT_MAP_LEVELS) {
  const owned = computeOwnedCategories(memberProjects, projects)
  const allCats = [...new Set((projects || []).map((p) => p.category).filter(Boolean))]
  return levels.map((lv) => ({ ...lv, unlocked: isFormulaUnlocked(levelFormula(lv), owned, allCats) }))
}
