// 销售结算编排 —— 含 db 写入。集中一笔销售涉及的多表写入。
// 行为与原 Sales.handleConfirmPayment 一致（CloudBase 无事务，中途失败会留半成品，维持现状）。
import { db } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'
import { generateSerialNumber } from '../utils/serialNumber'
import { splitKitUnits } from '../domain/kit'
import { proratePromoDiscount } from '../domain/promo'
import { deductFifo } from './inventoryService'
import { markConvertedIfNeeded } from './recallService'

const WALK_IN = 'WALK_IN'
const TAKE_AWAY = 'TAKE_AWAY'

/**
 * 执行一笔销售结算。定价/抵扣数值由调用方（domain/payment、domain/promo）算好后传入。
 * @returns {{ serialNumber: string }}
 */
export async function checkout({
  cartItems,
  selectedMember,
  operatorId,
  user,
  products,
  selectedPromo,
  promoDiscount,
  promoSubtotal,
  bogoFreeIdxs,
  presaleProductIds,
  pointsEnabled,
  pointsToRedeem,
  pointsEarned,
  pointsDiscount,
  balanceEnabled,
  balanceDiscount,
  supplementAmount,
  totalNum,
  roundoff = 0,
  paymentMethods = [],
  selectedGift,
  giftQty,
  giftReason,
}) {
  const now = new Date()
  const saleSerialNumber = generateSerialNumber()

  // 1. 商品流水
  for (let i = 0; i < cartItems.length; i++) {
    const item = cartItems[i]
    const amount = bogoFreeIdxs.has(i) || item.is_gift ? 0 : +(item.product.sale_price * item.discount / 10).toFixed(2)
    await db.collection(COLLECTIONS.TRANSACTIONS).add({
      serial_number: saleSerialNumber,
      member_id: selectedMember?._id || null,
      member_project_id: null,
      therapist_id: operatorId,
      product_id: item.product._id,
      product_name: item.product.name,
      product_spec: item.product.spec || '',
      barcode: item.product.barcode || '',
      product_price: amount,
      discount: item.discount / 10,
      payment_platform_no: '',
      type: 'purchase',
      payment_methods: paymentMethods,
      ...(presaleProductIds.has(item.product._id) ? { is_presale: true } : {}),
      ...(item.is_gift ? { is_gift: true } : {}),
      operated_at: now,
    })
  }

  // 2. 促销优惠负行
  if (promoDiscount > 0) {
    await db.collection(COLLECTIONS.TRANSACTIONS).add({
      serial_number: saleSerialNumber,
      member_id: selectedMember?._id || null,
      member_project_id: null,
      therapist_id: operatorId,
      product_name: `促销优惠：${selectedPromo.name}`,
      product_spec: '',
      barcode: '',
      product_price: -promoDiscount,
      discount: 1.0,
      payment_platform_no: '',
      type: 'purchase',
      payment_methods: paymentMethods,
      operated_at: now,
    })
  }

  // 3. 会员项目快照（满减分摊后实付；套盒按子件拆分）
  if (selectedMember) {
    const proratedAmounts = proratePromoDiscount({ cartItems, bogoFreeIdxs, promoDiscount, promoSubtotal })

    for (let i = 0; i < cartItems.length; i++) {
      const item = cartItems[i]
      const linkedProject = item.linkedProject
      if (!linkedProject || linkedProject._id === WALK_IN || linkedProject._id === TAKE_AWAY) continue
      const paidAmount = bogoFreeIdxs.has(i) || item.is_gift
        ? 0
        : proratedAmounts[i] !== null
        ? proratedAmounts[i]
        : +(item.product.sale_price * item.discount / 10).toFixed(2)

      const kitUnits = splitKitUnits({ product: item.product, paidAmount, products })
      const units = kitUnits ?? [{
        product_id: item.product._id,
        product_spec: item.product.spec || '',
        paid_amount: paidAmount,
        product_paid_price: paidAmount,
      }]

      for (const u of units) {
        await db.collection(COLLECTIONS.MEMBER_PROJECTS).add({
          member_id: selectedMember._id,
          project_name: linkedProject.name,
          product_id: u.product_id,
          product_paid_price: u.product_paid_price,
          paid_amount: u.paid_amount,
          total_sessions: linkedProject.total_sessions,
          max_sessions: linkedProject.max_sessions,
          product_spec: u.product_spec,
          used_sessions: 0,
          remaining_sessions: linkedProject.total_sessions,
          serial_number: saleSerialNumber,
          status: 'active',
          purchased_at: now,
        })
      }
    }
  }

  // 4. 补差价
  if (supplementAmount > 0) {
    await db.collection(COLLECTIONS.TRANSACTIONS).add({
      serial_number: saleSerialNumber,
      member_id: selectedMember?._id || null,
      member_project_id: null,
      therapist_id: operatorId,
      product_id: null,
      product_name: '补差价',
      product_spec: '',
      barcode: '',
      product_price: supplementAmount,
      discount: 1.0,
      payment_platform_no: '',
      type: 'purchase',
      payment_methods: paymentMethods,
      operated_at: now,
    })
  }

  // 4.5 抹零（向下抹到角的让利，负行）
  if (roundoff > 0) {
    await db.collection(COLLECTIONS.TRANSACTIONS).add({
      serial_number: saleSerialNumber,
      member_id: selectedMember?._id || null,
      member_project_id: null,
      therapist_id: operatorId,
      product_id: null,
      product_name: '抹零',
      product_spec: '',
      barcode: '',
      product_price: -roundoff,
      discount: 1.0,
      payment_platform_no: '',
      type: 'purchase',
      payment_methods: paymentMethods,
      operated_at: now,
    })
  }

  // 5. 库存扣减（吞错，允许欠量预售）
  try { await deductFifo(cartItems, user) } catch (_) {}

  // 6. 最近到店
  if (selectedMember) {
    await db.collection(COLLECTIONS.MEMBERS).doc(selectedMember._id).update({ last_visit_at: now })
    try { await markConvertedIfNeeded(selectedMember._id, saleSerialNumber) } catch (_) {}
  }

  // 7. 积分
  if (selectedMember && pointsEnabled) {
    const pointsDelta = pointsEarned - pointsToRedeem
    await db.collection(COLLECTIONS.MEMBERS).doc(selectedMember._id).update({
      points: (selectedMember.points ?? 0) + pointsDelta,
    })
    if (pointsToRedeem > 0) {
      await db.collection(COLLECTIONS.POINTS_RECORDS).add({
        member_id: selectedMember._id,
        type: 'redeem',
        points: -pointsToRedeem,
        amount: pointsDiscount,
        note: `积分抵扣 ¥${pointsDiscount}`,
        serial_number: saleSerialNumber,
        created_at: now,
      })
    }
    if (pointsEarned > 0) {
      await db.collection(COLLECTIONS.POINTS_RECORDS).add({
        member_id: selectedMember._id,
        type: 'earn',
        points: pointsEarned,
        amount: totalNum,
        note: `消费 ¥${totalNum.toFixed(2)} 获得积分`,
        serial_number: saleSerialNumber,
        created_at: now,
      })
    }
  }

  // 8. 余额抵扣
  if (selectedMember && balanceEnabled && balanceDiscount > 0) {
    const newBal = +((selectedMember.balance ?? 0) - balanceDiscount).toFixed(2)
    await db.collection(COLLECTIONS.MEMBERS).doc(selectedMember._id).update({ balance: newBal })
    await db.collection(COLLECTIONS.BALANCE_RECORDS).add({
      member_id: selectedMember._id,
      type: 'spend',
      amount: -balanceDiscount,
      bonus_amount: 0,
      note: `消费抵扣 ¥${balanceDiscount.toFixed(2)}`,
      staff_id: operatorId,
      serial_number: saleSerialNumber,
      created_at: now,
    })
  }

  // 9. 赠品发放
  if (selectedMember && selectedGift) {
    await db.collection(COLLECTIONS.GIFT_RECORDS).add({
      type: 'give',
      material_id: selectedGift._id,
      material_name: selectedGift.name,
      member_id: selectedMember._id,
      member_name: selectedMember.name,
      quantity: giftQty,
      reason: giftReason,
      staff_id: operatorId || user?.uid || '',
      given_at: now,
      notes: '',
    })
    await db.collection(COLLECTIONS.GIFT_MATERIALS).doc(selectedGift._id).update({
      stock: selectedGift.stock - giftQty,
    })
  }

  return { serialNumber: saleSerialNumber }
}
