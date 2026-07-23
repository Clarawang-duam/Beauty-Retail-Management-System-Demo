// 项目大类模版：取并集（设置中的模版 ∪ 现有项目里出现过的大类）。
// 这样存量自由文本大类自动并入，无需迁移项目数据；新增的大类存进 settings。
export function getCategoryTemplates(settingList, projects) {
  const base = Array.isArray(settingList) ? settingList.filter(Boolean) : []
  const seen = new Set(base)
  const result = [...base]
  for (const p of projects || []) {
    const c = p.category
    if (c && !seen.has(c)) { seen.add(c); result.push(c) }
  }
  return result
}
