import { describe, it, expect } from 'vitest'
import { computeOwnedCategories, isFormulaUnlocked, levelFormula, evaluateProjectMap, PROJECT_MAP_LEVELS } from './projectMap'

const projects = [
  { name: '清洁A', category: '清洁类' },
  { name: '补水B', category: '补水类' },
  { name: '面膜C', category: '面膜' },
  { name: '美白D', category: '美白类' },
]
const mp = (project_name, remaining = 1, status = 'active') => ({ project_name, remaining_sessions: remaining, status })
const all = ['清洁类', '补水类', '面膜', '美白类']

describe('computeOwnedCategories', () => {
  it('仅计未退款且剩余>0 的项目大类', () => {
    const owned = computeOwnedCategories([mp('清洁A', 2), mp('补水B', 0), mp('面膜C', 1, 'refunded'), mp('美白D', 3)], projects)
    expect([...owned].sort()).toEqual(['清洁类', '美白类'])
  })
})

describe('isFormulaUnlocked', () => {
  it('cat 和 cat：需全部拥有', () => {
    const f = [{ type: 'cat', cat: '清洁类' }, { op: 'and', type: 'cat', cat: '补水类' }]
    expect(isFormulaUnlocked(f, new Set(['清洁类', '补水类']), all)).toBe(true)
    expect(isFormulaUnlocked(f, new Set(['清洁类']), all)).toBe(false)
  })
  it('或：满足其一即可', () => {
    const f = [{ type: 'cat', cat: '清洁类' }, { op: 'or', type: 'cat', cat: '补水类' }]
    expect(isFormulaUnlocked(f, new Set(['补水类']), all)).toBe(true)
    expect(isFormulaUnlocked(f, new Set(['美白类']), all)).toBe(false)
  })
  it('anyOf 自动排除公式中已写的具体大类', () => {
    // 清洁 和 补水 和 (任一大类 除了 面膜) → "任一"须是清洁/补水/面膜之外
    const f = [{ type: 'cat', cat: '清洁类' }, { op: 'and', type: 'cat', cat: '补水类' }, { op: 'and', type: 'anyOf', exclude: ['面膜'] }]
    expect(isFormulaUnlocked(f, new Set(['清洁类', '补水类']), all)).toBe(false) // 没有其他大类
    expect(isFormulaUnlocked(f, new Set(['清洁类', '补水类', '面膜']), all)).toBe(false) // 其他只有面膜
    expect(isFormulaUnlocked(f, new Set(['清洁类', '补水类', '美白类']), all)).toBe(true)
  })
  it('all：拥有全部大类', () => {
    expect(isFormulaUnlocked([{ type: 'all' }], new Set(all), all)).toBe(true)
    expect(isFormulaUnlocked([{ type: 'all' }], new Set(['清洁类']), all)).toBe(false)
  })
  it('左到右求值：A 和 B 或 C = (A 和 B) 或 C', () => {
    const f = [{ type: 'cat', cat: '清洁类' }, { op: 'and', type: 'cat', cat: '补水类' }, { op: 'or', type: 'cat', cat: '美白类' }]
    expect(isFormulaUnlocked(f, new Set(['美白类']), all)).toBe(true) // C 真 → 整体真
    expect(isFormulaUnlocked(f, new Set(['清洁类']), all)).toBe(false) // (清洁 且 补水)假，C假
  })
})

describe('兼容旧 rule', () => {
  it('hasPlusOther 转公式后语义一致', () => {
    const lv = { rule: { type: 'hasPlusOther', cats: ['清洁类', '补水类'], excludeOther: ['面膜'] } }
    const f = levelFormula(lv)
    expect(isFormulaUnlocked(f, new Set(['清洁类', '补水类', '美白类']), all)).toBe(true)
    expect(isFormulaUnlocked(f, new Set(['清洁类', '补水类', '面膜']), all)).toBe(false)
  })
})

describe('evaluateProjectMap', () => {
  it('全大类齐 → 默认四级全解锁', () => {
    const res = evaluateProjectMap([mp('清洁A'), mp('补水B'), mp('面膜C'), mp('美白D')], projects)
    expect(res.map((l) => l.unlocked)).toEqual([true, true, true, true])
  })
  it('默认配置形状稳定', () => {
    expect(PROJECT_MAP_LEVELS.map((l) => l.id)).toEqual(['basic', 'combo', 'multi', 'full'])
  })
})
