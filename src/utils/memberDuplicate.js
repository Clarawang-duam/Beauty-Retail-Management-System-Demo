/**
 * 会员重复检测：手机号重复，或姓名+手机号同时相同。
 * @param {string} excludeId 编辑时排除当前会员 _id
 */
export function findDuplicateMember(name, phone, memberList, excludeId = null) {
  const n = String(name || '').trim()
  const p = String(phone || '').trim()
  if (!p) return null

  const list = excludeId
    ? memberList.filter((m) => m._id !== excludeId)
    : memberList

  const byPhone = list.find((m) => String(m.phone || '').trim() === p)
  if (byPhone) {
    const bothMatch = n && String(byPhone.name || '').trim() === n
    return { member: byPhone, reason: bothMatch ? 'both' : 'phone' }
  }
  if (n) {
    const byBoth = list.find(
      (m) => String(m.name || '').trim() === n && String(m.phone || '').trim() === p
    )
    if (byBoth) return { member: byBoth, reason: 'both' }
  }
  return null
}

export function memberNamePhoneKey(name, phone) {
  return `${String(name || '').trim()}\0${String(phone || '').trim()}`
}
