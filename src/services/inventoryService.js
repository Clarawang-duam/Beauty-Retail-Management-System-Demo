// 库存编排 —— 含 db 写入，集中销售扣减 / 退款恢复 / 售前可用量检查
import { db } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import { writeLog } from '../utils/operationLog'

/** 购物车按商品聚合数量：{ [productId]: { qty, name, product } } */
function aggregateByProduct(cartItems) {
  const map = {}
  for (const item of cartItems) {
    const pid = item.product._id
    if (!map[pid]) map[pid] = { qty: 0, name: item.product.name, product: item.product }
    map[pid].qty += 1
  }
  return map
}

/**
 * 销售扣减库存（FIFO，按 created_at 升序逐批扣）。
 * 库存不足时：最后一条耗尽批次写成负数；无批次则新建负数批次；并记一条欠量日志。
 */
export async function deductFifo(cartItems, user) {
  const qtyMap = aggregateByProduct(cartItems)
  const now = new Date()
  const timeStr = `${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  for (const [productId, { qty, name, product }] of Object.entries(qtyMap)) {
    const res = await db.collection(COLLECTIONS.INVENTORY)
      .where({ product_id: productId })
      .orderBy('created_at', 'asc')
      .get()
    let remaining = qty
    let lastDepleted = null
    for (const inv of res.data) {
      if (remaining <= 0) break
      const deduct = Math.min(inv.quantity, remaining)
      if (deduct <= 0) continue
      await db.collection(COLLECTIONS.INVENTORY).doc(inv._id).update({
        quantity: inv.quantity - deduct,
      })
      remaining -= deduct
      lastDepleted = inv
    }
    if (remaining > 0) {
      if (lastDepleted) {
        await db.collection(COLLECTIONS.INVENTORY).doc(lastDepleted._id).update({ quantity: -remaining })
      } else if (res.data.length > 0) {
        const last = res.data[res.data.length - 1]
        await db.collection(COLLECTIONS.INVENTORY).doc(last._id).update({ quantity: last.quantity - remaining })
      } else {
        await db.collection(COLLECTIONS.INVENTORY).add({
          product_id: productId,
          product_name: product.name,
          category: product.category || '',
          spec: product.spec || '',
          barcode: product.barcode || '',
          sale_price: product.sale_price,
          purchase_price: product.purchase_price || 0,
          quantity: -remaining,
          expiry_date: '',
          created_at: new Date(),
        })
      }
      await writeLog(user, '销售收款', `「${user.name}，在『${timeStr}』预售「${name}」${remaining}件，库存出现欠量」`)
    }
  }
}

/** 退款恢复库存：追加到最新批次（created_at 降序第一条）；无批次则忽略 */
export async function restoreToLatestBatch(productId, qty = 1) {
  const res = await db.collection(COLLECTIONS.INVENTORY)
    .where({ product_id: productId })
    .orderBy('created_at', 'desc')
    .limit(1)
    .get()
  if (res.data.length > 0) {
    await db.collection(COLLECTIONS.INVENTORY).doc(res.data[0]._id).update({
      quantity: res.data[0].quantity + qty,
    })
  }
}

/** 售前可用量检查：返回欠量警告与需标记预售的商品 id 集合 */
export async function checkAvailable(cartItems) {
  const qtyMap = aggregateByProduct(cartItems)
  const warnings = []
  const presaleProductIds = new Set()
  for (const [productId, { qty, name }] of Object.entries(qtyMap)) {
    const res = await db.collection(COLLECTIONS.INVENTORY).where({ product_id: productId }).get()
    const available = res.data.reduce((sum, inv) => sum + inv.quantity, 0)
    if (available < qty) {
      warnings.push({ name, needed: qty, available: Math.max(0, available), shortage: qty - Math.max(0, available) })
      presaleProductIds.add(productId)
    }
  }
  return { warnings, presaleProductIds }
}
