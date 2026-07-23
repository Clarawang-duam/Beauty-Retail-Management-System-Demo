import { db } from '../cloudbase'

// CloudBase 单次查询最多返回 100 条，统一分页拉全量
// 用法：fetchAll(COLLECTIONS.MEMBER_PROJECTS, { member_id }, q => q.orderBy('purchased_at', 'desc'))
export async function fetchAll(collection, where = {}, shape) {
  const PAGE = 100
  let all = []
  let skip = 0
  while (true) {
    let q = db.collection(collection).where(where)
    if (shape) q = shape(q)
    const res = await q.skip(skip).limit(PAGE).get()
    all = all.concat(res.data)
    if (res.data.length < PAGE) break
    skip += PAGE
  }
  return all
}

export { db }
