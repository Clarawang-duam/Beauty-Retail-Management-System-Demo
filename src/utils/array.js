// CloudBase 有时把数组存成 {"0": "id", "1": "id"} 对象格式
// 统一转换为真正的数组
export function toArray(val) {
  if (!val) return []
  if (Array.isArray(val)) return val
  return Object.values(val)
}
