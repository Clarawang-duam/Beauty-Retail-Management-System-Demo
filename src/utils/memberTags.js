import dayjs from 'dayjs'

export const TAG_STYLES = {
  '新客':   'bg-green-100 text-green-700 border-green-200',
  '高频客': 'bg-blue-100 text-blue-700 border-blue-200',
  '大客户': 'bg-purple-100 text-purple-700 border-purple-200',
  '沉睡客': 'bg-orange-100 text-orange-700 border-orange-200',
}

export const ALL_TAGS = ['新客', '高频客', '大客户', '沉睡客']

export function computeTxnAggregates(checkoutTxns3m, purchaseTxns) {
  const agg = {}
  const ensure = (id) => { if (!agg[id]) agg[id] = { checkouts3m: 0, totalSpend: 0 } }
  for (const t of checkoutTxns3m) {
    if (!t.member_id) continue
    ensure(t.member_id)
    agg[t.member_id].checkouts3m++
  }
  // 累计消费：purchase（正）+ refund（负）求和 = 净消费；调用方已限定近 1 年
  for (const t of purchaseTxns) {
    if (!t.member_id) continue
    if (t.type !== 'purchase' && t.type !== 'refund') continue
    ensure(t.member_id)
    agg[t.member_id].totalSpend += (t.product_price || 0)
  }
  return agg
}

export function getMemberTags(member, agg, getSetting) {
  const highFreqMin = Number(getSetting('tag_high_freq_min', 4))
  const bigSpenderMin = Number(getSetting('tag_big_spender_min', 3000))
  const dormantDays = Number(getSetting('tag_dormant_days', 30))
  const newDays = Number(getSetting('tag_new_days', 30))

  const now = dayjs()
  const data = agg[member._id] || { checkouts3m: 0, totalSpend: 0 }
  const monthlyAvg = data.checkouts3m / 3

  const isNew = member.created_at && now.diff(dayjs(member.created_at), 'day') <= newDays
  const lastVisit = member.last_visit_at ? dayjs(member.last_visit_at) : null
  const daysSince = lastVisit ? now.diff(lastVisit, 'day') : null

  const tags = []
  if (isNew) tags.push('新客')
  if (monthlyAvg >= highFreqMin) tags.push('高频客')
  if (data.totalSpend >= bigSpenderMin) tags.push('大客户')
  if (!isNew && (daysSince === null || daysSince >= dormantDays)) tags.push('沉睡客')
  return tags
}
