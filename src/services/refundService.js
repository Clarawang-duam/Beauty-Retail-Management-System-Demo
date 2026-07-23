// 退款编排 —— 含 db 写入。行为与原 TransactionManagement.executeRefund 一致。
import { db, _ } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import { restoreToLatestBatch } from './inventoryService'
import { expandKitProductIds } from '../domain/kit'

/**
 * 退款：写退款流水 + 恢复库存 + 标记会员项目 refunded + 按比例回滚积分。
 * @param items 已选中的原始 purchase 交易条目
 */
export async function refund({ items, serialNumber, operatorId, products, pointsEnabled, promoLine = null }) {
  const now = new Date()
  const memberId = items[0]?.member_id || null

  const resolveProductId = (item) =>
    item.product_id || products.find((p) => p.name === item.product_name)?._id

  // 0. 冲销促销优惠：写一条正数 refund 行，refund_ref_id 指向促销行（防重 + 各业绩口径自动归正）
  if (promoLine) {
    await db.collection(COLLECTIONS.TRANSACTIONS).add({
      serial_number: serialNumber || promoLine.serial_number || '',
      member_id: promoLine.member_id || null,
      therapist_id: promoLine.therapist_id || operatorId,
      product_id: null,
      product_name: `${promoLine.product_name || '促销优惠'}（冲销）`,
      product_spec: '',
      barcode: '',
      product_price: -(promoLine.product_price || 0), // 原为负，取反得正
      discount: 1,
      type: 'refund',
      refund_ref_id: promoLine._id,
      operated_at: now,
    })
  }

  // 1. 写退款 transaction
  for (const item of items) {
    await db.collection(COLLECTIONS.TRANSACTIONS).add({
      serial_number: serialNumber || item.serial_number || '',
      member_id: item.member_id || null,
      // 业绩冲减需归到原销售员，故退款流水沿用原商品的 therapist_id（缺失才退回经手人）
      therapist_id: item.therapist_id || operatorId,
      product_id: item.product_id || null,
      product_name: item.product_name,
      product_spec: item.product_spec || '',
      barcode: item.barcode || '',
      product_price: -(item.product_price || 0),
      discount: item.discount || 1,
      type: 'refund',
      refund_ref_id: item._id,
      operated_at: now,
    })
  }

  // 2. 恢复库存（追加到最新批次）
  for (const item of items) {
    const productId = resolveProductId(item)
    if (!productId) continue
    try {
      await restoreToLatestBatch(productId, 1)
    } catch (_e) {}
  }

  // 3. 更新 member_projects（有 serial_number 才能精确匹配）
  //    套盒：流水 product_id 是父商品，但快照按子商品建，需展开成子商品 id 再匹配
  for (const item of items) {
    if (!item.member_id || !item.serial_number) continue
    const productId = resolveProductId(item)
    if (!productId) continue
    const matchIds = expandKitProductIds([productId], products)
    try {
      const mpRes = await db.collection(COLLECTIONS.MEMBER_PROJECTS)
        .where({ member_id: item.member_id, serial_number: item.serial_number, product_id: _.in(matchIds) })
        .get()
      for (const mp of mpRes.data) {
        if (!mp.status || mp.status === 'active') {
          await db.collection(COLLECTIONS.MEMBER_PROJECTS).doc(mp._id)
            .update({ status: 'refunded', remaining_sessions: 0 })
        }
      }
    } catch (_e) {}
  }

  // 4. 积分回滚（按退款金额占原单比例）
  if (memberId && pointsEnabled && serialNumber) {
    try {
      const refundedAmount = items.reduce((sum, t) => sum + (t.product_price || 0), 0)
      const allItemsRes = await db.collection(COLLECTIONS.TRANSACTIONS)
        .where({ serial_number: serialNumber, type: 'purchase' })
        .get()
      const purchaseTotal = allItemsRes.data.reduce((sum, t) => sum + Math.max(0, t.product_price || 0), 0)
      if (purchaseTotal > 0) {
        const proportion = refundedAmount / purchaseTotal
        const pointsRes = await db.collection(COLLECTIONS.POINTS_RECORDS)
          .where({ member_id: memberId, serial_number: serialNumber })
          .get()
        let earnedPoints = 0
        let redeemedPoints = 0
        pointsRes.data.forEach((pr) => {
          if (pr.type === 'earn') earnedPoints += pr.points || 0
          if (pr.type === 'redeem') redeemedPoints += Math.abs(pr.points || 0)
        })
        const toDeduct = Math.round(earnedPoints * proportion)
        const toRestore = Math.round(redeemedPoints * proportion)
        const netDelta = toRestore - toDeduct
        if (netDelta !== 0) {
          const memberRes = await db.collection(COLLECTIONS.MEMBERS).doc(memberId).get()
          const currentPoints = memberRes.data[0]?.points ?? 0
          await db.collection(COLLECTIONS.MEMBERS).doc(memberId)
            .update({ points: Math.max(0, currentPoints + netDelta) })
          await db.collection(COLLECTIONS.POINTS_RECORDS).add({
            member_id: memberId,
            type: netDelta > 0 ? 'earn' : 'redeem',
            points: netDelta,
            amount: refundedAmount,
            note: `退款积分调整（退 ¥${refundedAmount.toFixed(2)}）`,
            serial_number: serialNumber,
            created_at: now,
          })
        }
      }
    } catch (_e) {}
  }
}
