import { useState, useEffect, useMemo } from 'react'
import { db, _ } from '../../../lib/cloudbase'
import { COLLECTIONS } from '../../../lib/collections'
import useCacheStore from '../../../store/cacheStore'
import useAuthStore from '../../../store/authStore'
import { useOperator } from '../../../hooks/useOperator'
import { refund } from '../../../services/refundService'
import { buildPaymentMap, getPaymentLabel, aggregatePaymentTotals } from '../../../utils/paymentMethods'

const formatDate = (d) => d.toISOString().split('T')[0]

const formatDateTime = (d) => {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d)
  const mo = date.getMonth() + 1
  const day = date.getDate()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${mo}/${day} ${hh}:${mm}`
}

/** 相邻行分组：有流水号按流水号，无流水号每行独立成组 */
const orderGroupKey = (t) => t.serial_number || `__${t._id}`

export default function TransactionManagement({ onBack }) {
  const { staff, members, products, getSetting, refreshCache } = useCacheStore()
  const user = useAuthStore((s) => s.user)
  const { operatorId } = useOperator()

  const today = new Date()
  const thirtyDaysAgo = new Date(today)
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const [keyword, setKeyword] = useState('')
  const [startDate, setStartDate] = useState(formatDate(thirtyDaysAgo))
  const [endDate, setEndDate] = useState(formatDate(today))
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [truncated, setTruncated] = useState(false)
  const [refundedMap, setRefundedMap] = useState({})

  const [refundModal, setRefundModal] = useState(null)
  const [selectedRefundIds, setSelectedRefundIds] = useState(new Set())
  const [refundLoading, setRefundLoading] = useState(false)
  const [modalLoading, setModalLoading] = useState(false)
  const [reversePromo, setReversePromo] = useState(false)

  const staffMap = Object.fromEntries(staff.map((s) => [s._id, s.name]))
  const memberMap = Object.fromEntries(members.map((m) => [m._id, m.name]))

  const fetchTransactions = async () => {
    setLoading(true)
    try {
      const start = new Date(startDate + 'T00:00:00')
      const end = new Date(endDate + 'T23:59:59')
      const res = await db
        .collection(COLLECTIONS.TRANSACTIONS)
        .where(
          _.and([
            { type: _.in(['purchase', 'refund']) },
            { operated_at: _.gte(start) },
            { operated_at: _.lte(end) },
          ])
        )
        .orderBy('operated_at', 'desc')
        .limit(500)
        .get()
      setTransactions(res.data)
      setTruncated(res.data.length === 500)

      const rMap = {}
      res.data.forEach((t) => {
        if (t.type === 'refund' && t.refund_ref_id) {
          rMap[t.refund_ref_id] = true
        }
      })
      setRefundedMap(rMap)
    } catch (err) {
      alert('查询失败：' + err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (members.length === 0) refreshCache('members')
    fetchTransactions()
  }, [])

  const filtered = keyword.trim()
    ? transactions.filter(
        (t) =>
          t.product_name?.toLowerCase().includes(keyword.trim().toLowerCase()) ||
          String(t.barcode || '').includes(keyword.trim())
      )
    : transactions

  const paymentMap = useMemo(() => buildPaymentMap(transactions), [transactions])
  const paymentTotals = useMemo(() => aggregatePaymentTotals(filtered), [filtered])
  const paymentSummaryItems = useMemo(() => ([
    { key: 'cash', label: '现金', amount: paymentTotals.cash },
    { key: 'scan', label: '扫码', amount: paymentTotals.scan },
    { key: 'balance', label: '储值卡', amount: paymentTotals.balance },
  ]).filter((item) => item.amount > 0), [paymentTotals])

  const total = filtered.reduce((sum, t) => sum + (t.product_price || 0), 0)
  const refundTotal = filtered
    .filter((t) => t.type === 'refund' && (t.product_price || 0) < 0)
    .reduce((sum, t) => sum + (t.product_price || 0), 0)

  const openRefundModal = async (tx) => {
    setModalLoading(true)
    try {
      let items = []
      let promoLine = null
      if (tx.serial_number) {
        const [purchaseRes, refundRes] = await Promise.all([
          db.collection(COLLECTIONS.TRANSACTIONS)
            .where({ serial_number: tx.serial_number, type: 'purchase' })
            .get(),
          db.collection(COLLECTIONS.TRANSACTIONS)
            .where({ serial_number: tx.serial_number, type: 'refund' })
            .get(),
        ])
        const refundedIds = new Set(refundRes.data.map((t) => t.refund_ref_id).filter(Boolean))
        items = purchaseRes.data.filter(
          (t) => (t.product_price || 0) > 0 && !refundedIds.has(t._id)
        )
        // 促销优惠行：该单唯一的负价 purchase 行；已冲销过则视为无促销
        const promoCandidate = purchaseRes.data.find((t) => (t.product_price || 0) < 0) || null
        promoLine = promoCandidate && !refundedIds.has(promoCandidate._id) ? promoCandidate : null
      } else {
        if (!refundedMap[tx._id] && (tx.product_price || 0) > 0) {
          items = [tx]
        }
      }
      if (items.length === 0) {
        alert('该订单所有商品已退款')
        return
      }
      setReversePromo(false)
      setRefundModal({ tx, items, promoLine })
      setSelectedRefundIds(new Set(items.map((t) => t._id)))
    } catch (err) {
      alert('加载失败：' + err.message)
    } finally {
      setModalLoading(false)
    }
  }

  const toggleRefundItem = (id) => {
    setSelectedRefundIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const executeRefund = async () => {
    if (!refundModal) return
    const selected = refundModal.items.filter((t) => selectedRefundIds.has(t._id))
    if (selected.length === 0) { alert('请至少选择一件商品'); return }
    // 整单全退自动冲销促销；部分退款看勾选
    const isFullRefund = selected.length === refundModal.items.length
    const shouldReversePromo = !!refundModal.promoLine && (isFullRefund || reversePromo)
    setRefundLoading(true)
    try {
      await refund({
        items: selected,
        serialNumber: refundModal.tx.serial_number || null,
        operatorId,
        products,
        pointsEnabled: getSetting('points_enabled', false),
        promoLine: shouldReversePromo ? refundModal.promoLine : null,
      })

      setRefundModal(null)
      setSelectedRefundIds(new Set())
      fetchTransactions()
    } catch (err) {
      alert('退款失败：' + err.message)
    } finally {
      setRefundLoading(false)
    }
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700">← 返回</button>
        <h2 className="text-xl font-bold text-gray-800">交易记录</h2>
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm mb-4 space-y-3">
        <input
          type="text"
          placeholder="搜索商品名称或条码"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
        />
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
          />
          <span className="text-gray-400 text-sm shrink-0">至</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
          />
          <button
            onClick={fetchTransactions}
            className="px-4 py-2 bg-indigo-500 text-white text-sm rounded-lg hover:bg-indigo-600 whitespace-nowrap"
          >
            查询
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-12 text-sm">加载中...</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          {truncated && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-amber-700 text-xs">
              ⚠ 结果已达500条上限，请缩小日期范围以查看完整记录
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  {['日期时间', '流水号', '商品名称', '条码', '原价', '折扣', '实付', '支付方式', '经手员工', '关联会员', '操作'].map((h, i) => (
                    <th
                      key={h}
                      className={`px-3 py-2.5 text-gray-500 font-medium whitespace-nowrap ${i >= 4 && i <= 6 ? 'text-right' : 'text-left'}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center text-gray-400 py-12">暂无数据</td>
                  </tr>
                ) : (
                  filtered.map((t, i) => {
                    const prev = i > 0 ? filtered[i - 1] : null
                    const isNewOrder = !prev || orderGroupKey(prev) !== orderGroupKey(t)
                    const isRefundRow = t.type === 'refund'
                    const isPromo = !isRefundRow && (t.product_price || 0) < 0
                    const isFree = !isRefundRow && !isPromo && (t.product_price || 0) === 0
                    const isRefunded = !isRefundRow && !isPromo && !isFree && !!refundedMap[t._id]
                    const canRefund = !isRefundRow && !isPromo && !isFree && !isRefunded

                    const origPrice =
                      !isRefundRow && !isPromo && !isFree && t.discount > 0 && t.discount < 1
                        ? +(t.product_price / t.discount).toFixed(2)
                        : !isRefundRow && !isPromo && !isFree
                        ? t.product_price
                        : null
                    const discountLabel = isRefundRow
                      ? '-'
                      : isPromo
                      ? '-'
                      : isFree
                      ? '赠品'
                      : t.discount === 1
                      ? '原价'
                      : `${(t.discount * 10).toFixed(1)}折`

                    const paymentLabel = getPaymentLabel(t, paymentMap)

                    let rowBg = ''
                    if (isRefundRow) rowBg = 'bg-red-50'
                    else if (isPromo) rowBg = 'bg-green-50'
                    else if (isRefunded) rowBg = 'bg-gray-50'

                    return (
                      <tr
                        key={t._id}
                        className={`border-b border-gray-100 last:border-0 ${
                          isNewOrder && i > 0 ? 'border-t-2 border-gray-300' : ''
                        } ${rowBg}`}
                      >
                        <td className="px-3 py-2 text-gray-500 whitespace-nowrap text-xs">
                          {formatDateTime(t.operated_at)}
                        </td>
                        <td className="px-3 py-2 text-gray-400 text-xs whitespace-nowrap">
                          {isNewOrder ? (t.serial_number || '-') : ''}
                        </td>
                        <td className="px-3 py-2 max-w-[160px] truncate">
                          <span className={isRefundRow ? 'text-red-600' : 'text-gray-800'}>
                            {t.product_name}
                          </span>
                          {isRefundRow && (
                            <span className="ml-1 text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded">退款</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-400 text-xs">
                          {t.barcode || '-'}
                        </td>
                        <td className="px-3 py-2 text-right text-gray-500">
                          {origPrice != null ? `¥${origPrice}` : '-'}
                        </td>
                        <td className={`px-3 py-2 text-right whitespace-nowrap ${isFree ? 'text-green-600 font-medium' : 'text-gray-500'}`}>
                          {discountLabel}
                        </td>
                        <td className={`px-3 py-2 text-right font-medium whitespace-nowrap ${
                          isRefundRow ? ((t.product_price || 0) >= 0 ? 'text-green-600' : 'text-red-600') : isPromo ? 'text-green-600' : 'text-gray-800'
                        }`}>
                          {isRefundRow
                            ? ((t.product_price || 0) >= 0 ? `+¥${(t.product_price || 0)}` : `-¥${Math.abs(t.product_price || 0)}`)
                            : isPromo
                            ? `-¥${Math.abs(t.product_price || 0)}`
                            : `¥${t.product_price || 0}`}
                        </td>
                        <td
                          className={`px-3 py-2 text-xs max-w-[140px] truncate ${isRefundRow ? 'text-red-500' : 'text-gray-500'}`}
                          title={paymentLabel}
                        >
                          {paymentLabel}
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {staffMap[t.therapist_id] || '-'}
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {t.member_id ? memberMap[t.member_id] || '-' : '-'}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {canRefund && (
                            <button
                              onClick={() => openRefundModal(t)}
                              disabled={modalLoading}
                              className="text-xs px-2 py-1 bg-red-50 text-red-600 border border-red-200 rounded hover:bg-red-100 disabled:opacity-50"
                            >
                              退款
                            </button>
                          )}
                          {isRefunded && (
                            <span className="text-xs text-gray-400">已退款</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
          {filtered.length > 0 && (
            <div className="px-4 py-3 border-t bg-gray-50 space-y-2">
              <div className="flex justify-between items-start gap-4">
                <span className="text-sm text-gray-500 shrink-0">{filtered.length} 条记录</span>
                <div className="text-sm text-right space-y-1.5 min-w-0">
                  {paymentSummaryItems.length > 0 && (
                    <div className="flex flex-wrap justify-end items-center gap-x-4 gap-y-1 text-gray-700">
                      <span className="text-gray-500 text-xs">收款</span>
                      {paymentSummaryItems.map((item) => (
                        <span key={item.key}>
                          {item.label}{' '}
                          <span className="font-medium">¥{item.amount.toFixed(2)}</span>
                        </span>
                      ))}
                    </div>
                  )}
                  {refundTotal < 0 && (
                    <div className="text-red-500 text-xs">
                      退款 ¥{Math.abs(refundTotal).toFixed(2)}
                    </div>
                  )}
                  <div className="text-gray-700">
                    净收入：
                    <span className="text-indigo-600 font-bold text-base ml-1">¥{total.toFixed(2)}</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 text-right leading-relaxed">
                * 收款为各支付方式实收汇总（按单去重）；净收入含退款冲减、促销调整等，二者口径不同
              </p>
            </div>
          )}
        </div>
      )}

      {/* 退款弹窗 */}
      {refundModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
            <div className="px-6 pt-6 pb-4 border-b">
              <h3 className="text-lg font-bold text-gray-800">退款确认</h3>
              <div className="text-xs text-gray-400 mt-1 space-x-3">
                {refundModal.tx.serial_number && (
                  <span>流水号：{refundModal.tx.serial_number}</span>
                )}
                {refundModal.tx.member_id && (
                  <span>会员：{memberMap[refundModal.tx.member_id] || '-'}</span>
                )}
              </div>
              {refundModal.tx.serial_number && paymentMap[refundModal.tx.serial_number] && (
                <p className="text-xs text-gray-500 mt-2">
                  原单支付：{paymentMap[refundModal.tx.serial_number]}
                </p>
              )}
            </div>
            <div className="px-6 py-4">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm text-gray-500">选择退款商品</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedRefundIds(new Set(refundModal.items.map((t) => t._id)))}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    全选
                  </button>
                  <button
                    onClick={() => setSelectedRefundIds(new Set())}
                    className="text-xs text-gray-400 hover:underline"
                  >
                    取消全选
                  </button>
                </div>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {refundModal.items.map((item) => (
                  <label
                    key={item._id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRefundIds.has(item._id)}
                      onChange={() => toggleRefundItem(item._id)}
                      className="w-4 h-4 accent-red-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-800 truncate">{item.product_name}</div>
                      {item.product_spec && (
                        <div className="text-xs text-gray-400">{item.product_spec}</div>
                      )}
                    </div>
                    <span className="text-sm font-medium text-gray-700 shrink-0">
                      ¥{item.product_price}
                    </span>
                  </label>
                ))}
              </div>
              {refundModal.promoLine && (() => {
                const promoAmt = Math.abs(refundModal.promoLine.product_price || 0)
                const isFull = selectedRefundIds.size === refundModal.items.length
                return isFull ? (
                  <div className="mt-3 px-1 text-xs text-emerald-600">
                    ✓ 整单退款，将一并冲销促销优惠 ¥{promoAmt.toFixed(2)}
                  </div>
                ) : (
                  <label className="mt-3 flex items-center gap-2 px-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={reversePromo}
                      onChange={(e) => setReversePromo(e.target.checked)}
                      className="w-4 h-4 accent-emerald-500"
                    />
                    <span className="text-sm text-gray-600">同时冲销本次促销优惠 ¥{promoAmt.toFixed(2)}</span>
                  </label>
                )
              })()}
              <div className="mt-4 pt-3 border-t flex justify-between items-center">
                <span className="text-sm text-gray-500">
                  已选 {selectedRefundIds.size} 件
                </span>
                <span className="text-base font-bold text-red-600">
                  退款 ¥{refundModal.items
                    .filter((t) => selectedRefundIds.has(t._id))
                    .reduce((sum, t) => sum + (t.product_price || 0), 0)
                    .toFixed(2)}
                </span>
              </div>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={() => { setRefundModal(null); setSelectedRefundIds(new Set()) }}
                disabled={refundLoading}
                className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={executeRefund}
                disabled={refundLoading || selectedRefundIds.size === 0}
                className="flex-1 py-3 bg-red-500 text-white rounded-xl font-medium hover:bg-red-600 disabled:bg-red-300"
              >
                {refundLoading ? '处理中...' : '确认退款'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
