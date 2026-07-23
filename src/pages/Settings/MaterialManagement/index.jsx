import { useState, useEffect, useMemo } from 'react'
import { db } from '../../../lib/cloudbase'
import { COLLECTIONS } from '../../../lib/collections'
import useCacheStore from '../../../store/cacheStore'
import useAuthStore from '../../../store/authStore'
import { useOperator } from '../../../hooks/useOperator'
import { usePermission } from '../../../hooks/usePermission'
import dayjs from 'dayjs'

const GIFT_REASONS = ['满额赠品', '指定商品赠品', '活动赠品', '其他']

// ── 赠品物料 Tab ──────────────────────────────────────────────

function GiftMaterialsTab({ isOwner }) {
  const user = useAuthStore((s) => s.user)
  const { operatorId } = useOperator()
  const { members } = useCacheStore()

  const [materials, setMaterials] = useState([])
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)

  // 入库 modal
  const [showStock, setShowStock] = useState(false)
  const [stockForm, setStockForm] = useState({ name: '', spec: '', quantity: '', notes: '' })
  const [stockSaving, setStockSaving] = useState(false)

  // 发放 modal
  const [giveTarget, setGiveTarget] = useState(null) // gift_materials record
  const [showGive, setShowGive] = useState(false)
  const [giveForm, setGiveForm] = useState({ memberSearch: '', selectedMember: null, quantity: 1, reason: '满额赠品', notes: '' })
  const [memberResults, setMemberResults] = useState([])
  const [giveSaving, setGiveSaving] = useState(false)

  // 详情 modal
  const [detailTarget, setDetailTarget] = useState(null)

  const [deletingId, setDeletingId] = useState(null)

  // 库存调整 modal
  const [adjustTarget, setAdjustTarget] = useState(null)
  const [adjustForm, setAdjustForm] = useState({ newStock: '', reason: '' })
  const [adjustSaving, setAdjustSaving] = useState(false)

  const memberMap = useMemo(
    () => Object.fromEntries((members || []).map((m) => [m._id, m.name])),
    [members]
  )

  const fetchAll = async () => {
    setLoading(true)
    try {
      const [mRes, rRes] = await Promise.all([
        db.collection(COLLECTIONS.GIFT_MATERIALS).limit(200).get(),
        db.collection(COLLECTIONS.GIFT_RECORDS).limit(500).get(),
      ])
      setMaterials((mRes.data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)))
      setRecords((rRes.data || []).sort((a, b) => new Date(b.given_at) - new Date(a.given_at)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAll() }, [])

  // 会员搜索
  useEffect(() => {
    const q = giveForm.memberSearch.trim()
    if (!q) { setMemberResults([]); return }
    const lower = q.toLowerCase()
    setMemberResults(
      (members || []).filter(m =>
        m.name?.toLowerCase().includes(lower) || m.phone?.includes(q)
      ).slice(0, 8)
    )
  }, [giveForm.memberSearch, members])

  const openGive = (e, mat) => {
    e.stopPropagation()
    setGiveTarget(mat)
    setGiveForm({ memberSearch: '', selectedMember: null, quantity: 1, reason: '满额赠品', notes: '' })
    setMemberResults([])
    setShowGive(true)
  }

  const handleGiveSubmit = async () => {
    if (!giveForm.selectedMember) { alert('请选择会员'); return }
    if (!giveForm.quantity || giveForm.quantity < 1) { alert('发放数量至少为1'); return }
    if (giveForm.quantity > giveTarget.stock) { alert('库存不足'); return }
    setGiveSaving(true)
    try {
      const now = new Date()
      await db.collection(COLLECTIONS.GIFT_RECORDS).add({
        type: 'give',
        material_id: giveTarget._id,
        material_name: giveTarget.name,
        member_id: giveForm.selectedMember._id,
        member_name: giveForm.selectedMember.name,
        quantity: giveForm.quantity,
        reason: giveForm.reason,
        staff_id: operatorId || user?.uid || '',
        given_at: now,
        notes: giveForm.notes,
      })
      await db.collection(COLLECTIONS.GIFT_MATERIALS).doc(giveTarget._id).update({
        stock: giveTarget.stock - giveForm.quantity,
      })
      setShowGive(false)
      await fetchAll()
    } catch (err) {
      alert('发放失败：' + err.message)
    } finally {
      setGiveSaving(false)
    }
  }

  const handleStockSubmit = async () => {
    if (!stockForm.name.trim()) { alert('请填写物料名称'); return }
    const qty = parseInt(stockForm.quantity)
    if (!qty || qty < 1) { alert('入库数量须为正整数'); return }
    setStockSaving(true)
    try {
      await db.collection(COLLECTIONS.GIFT_MATERIALS).add({
        name: stockForm.name.trim(),
        spec: stockForm.spec.trim(),
        stock: qty,
        initial_quantity: qty,
        created_at: new Date(),
        notes: stockForm.notes.trim(),
      })
      setShowStock(false)
      setStockForm({ name: '', spec: '', quantity: '', notes: '' })
      await fetchAll()
    } catch (err) {
      alert('入库失败：' + err.message)
    } finally {
      setStockSaving(false)
    }
  }

  const openAdjust = (e, mat) => {
    e.stopPropagation()
    setAdjustTarget(mat)
    setAdjustForm({ newStock: String(mat.stock), reason: '' })
  }

  const handleAdjustSubmit = async () => {
    const next = parseInt(adjustForm.newStock)
    if (isNaN(next) || next < 0) { alert('请输入有效的库存数量（≥0）'); return }
    const delta = next - adjustTarget.stock
    if (delta === 0) { alert('库存数量未变化'); return }
    if (!adjustForm.reason.trim()) { alert('请填写调整原因'); return }
    setAdjustSaving(true)
    try {
      const now = new Date()
      await db.collection(COLLECTIONS.GIFT_RECORDS).add({
        type: 'adjust',
        material_id: adjustTarget._id,
        material_name: adjustTarget.name,
        member_id: '',
        member_name: '',
        quantity: delta,
        stock_before: adjustTarget.stock,
        stock_after: next,
        reason: adjustForm.reason.trim(),
        staff_id: operatorId || user?.uid || '',
        given_at: now,
        notes: '',
      })
      await db.collection(COLLECTIONS.GIFT_MATERIALS).doc(adjustTarget._id).update({
        stock: next,
      })
      setAdjustTarget(null)
      await fetchAll()
    } catch (err) {
      alert('调整失败：' + err.message)
    } finally {
      setAdjustSaving(false)
    }
  }

  const handleDelete = async (e, mat) => {
    e.stopPropagation()
    if (!window.confirm(`确认删除「${mat.name}」？此操作不可撤销。`)) return
    setDeletingId(mat._id)
    try {
      await db.collection(COLLECTIONS.GIFT_MATERIALS).doc(mat._id).remove()
      await fetchAll()
    } catch (err) {
      alert('删除失败：' + err.message)
    } finally {
      setDeletingId(null)
    }
  }

  const recordsForMaterial = (matId) => records.filter(r => r.material_id === matId)

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">加载中...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-400">{materials.length} 个批次</span>
        {isOwner && (
          <button
            onClick={() => { setStockForm({ name: '', spec: '', quantity: '', notes: '' }); setShowStock(true) }}
            className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl text-sm font-medium"
          >
            + 入库
          </button>
        )}
      </div>

      {materials.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">暂无物料记录</div>
      ) : (
        <div className="space-y-3">
          {materials.map(mat => {
            const matRecords = recordsForMaterial(mat._id)
            const givenNames = [...new Set(matRecords.map(r => r.member_name).filter(Boolean))]
            const lowStock = mat.stock <= 5
            return (
              <div
                key={mat._id}
                onClick={() => setDetailTarget(mat)}
                className="bg-white rounded-xl p-4 shadow-sm flex items-center gap-4 cursor-pointer hover:shadow-md transition-shadow"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800 text-base">{mat.name}</span>
                    {mat.spec && <span className="text-xs text-gray-400">{mat.spec}</span>}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {dayjs(mat.created_at).format('YYYY年MM月DD日')} 入库 · 原始 {mat.initial_quantity} 件
                  </div>
                  <div className="mt-1">
                    {givenNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {givenNames.slice(0, 5).map(n => (
                          <span key={n} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{n}</span>
                        ))}
                        {givenNames.length > 5 && (
                          <span className="text-xs text-gray-400">+{givenNames.length - 5}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">暂无发放记录</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className={`text-2xl font-bold ${lowStock ? 'text-red-500' : 'text-gray-700'}`}>
                      {mat.stock}
                    </div>
                    <div className="text-xs text-gray-400">剩余</div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <button
                      onClick={(e) => openGive(e, mat)}
                      className="px-3 py-1.5 bg-pink-500 hover:bg-pink-600 text-white rounded-lg text-sm font-medium"
                    >
                      + 发放
                    </button>
                    {isOwner && (
                      <div className="flex gap-1.5">
                        <button
                          onClick={(e) => openAdjust(e, mat)}
                          className="flex-1 px-2 py-1 border border-amber-200 rounded-lg text-xs text-amber-600 hover:bg-amber-50"
                        >
                          调整库存
                        </button>
                        <button
                          onClick={(e) => handleDelete(e, mat)}
                          disabled={deletingId === mat._id}
                          className="flex-1 px-2 py-1 border border-red-200 rounded-lg text-xs text-red-400 hover:bg-red-50 disabled:opacity-50"
                        >
                          {deletingId === mat._id ? '...' : '删除'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 详情弹窗（只读） */}
      {detailTarget && (() => {
        const mat = materials.find(m => m._id === detailTarget._id) || detailTarget
        const matRecords = recordsForMaterial(mat._id)
        return (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
            <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] flex flex-col shadow-xl">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-800">{mat.name}</h3>
                <button onClick={() => setDetailTarget(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
              </div>
              <div className="px-5 py-4 border-b border-gray-100 space-y-1.5 text-sm">
                {mat.spec && <div className="flex gap-2"><span className="text-gray-400 w-16">规格</span><span>{mat.spec}</span></div>}
                <div className="flex gap-2"><span className="text-gray-400 w-16">入库数量</span><span>{mat.initial_quantity} 件</span></div>
                <div className="flex gap-2"><span className="text-gray-400 w-16">当前剩余</span><span className={mat.stock <= 5 ? 'text-red-500 font-semibold' : ''}>{mat.stock} 件</span></div>
                <div className="flex gap-2"><span className="text-gray-400 w-16">入库时间</span><span>{dayjs(mat.created_at).format('YYYY年MM月DD日')}</span></div>
                {mat.notes && <div className="flex gap-2"><span className="text-gray-400 w-16">备注</span><span>{mat.notes}</span></div>}
              </div>
              <div className="flex-1 overflow-y-auto px-5 py-3">
                <div className="text-xs text-gray-400 mb-2">记录（{matRecords.length} 条）</div>
                {matRecords.length === 0 ? (
                  <div className="text-sm text-gray-300 text-center py-6">暂无记录</div>
                ) : (
                  <div className="space-y-2">
                    {matRecords.map(r => {
                      const isAdjust = r.type === 'adjust'
                      return (
                        <div key={r._id} className="bg-gray-50 rounded-lg px-3 py-2.5 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-700">{isAdjust ? '库存调整' : r.member_name}</span>
                            <span className="text-xs text-gray-400">{dayjs(r.given_at).format('MM/DD HH:mm')}</span>
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            {isAdjust ? (
                              <>
                                <span className={r.quantity >= 0 ? 'text-green-600' : 'text-red-500'}>
                                  {r.quantity >= 0 ? `+${r.quantity}` : r.quantity} 件
                                </span>
                                {`（${r.stock_before} → ${r.stock_after}）· ${r.reason}`}
                              </>
                            ) : (
                              <>
                                {r.quantity} 件 · {r.reason}
                                {r.notes && ` · ${r.notes}`}
                              </>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      {/* 发放 modal */}
      {showGive && giveTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">发放 · {giveTarget.name}</h3>
              <button onClick={() => setShowGive(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="text-xs text-gray-400">当前剩余 <span className={`font-semibold ${giveTarget.stock <= 5 ? 'text-red-500' : 'text-gray-700'}`}>{giveTarget.stock}</span> 件</div>

              {/* 会员搜索 */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">会员 *</label>
                {giveForm.selectedMember ? (
                  <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <span className="flex-1 text-sm font-medium text-green-800">{giveForm.selectedMember.name}</span>
                    <button
                      onClick={() => setGiveForm(f => ({ ...f, selectedMember: null, memberSearch: '' }))}
                      className="text-gray-400 text-xs"
                    >更换</button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      value={giveForm.memberSearch}
                      onChange={e => setGiveForm(f => ({ ...f, memberSearch: e.target.value }))}
                      placeholder="搜索会员姓名或手机号"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                    />
                    {memberResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1 max-h-48 overflow-y-auto">
                        {memberResults.map(m => (
                          <button
                            key={m._id}
                            onClick={() => setGiveForm(f => ({ ...f, selectedMember: m, memberSearch: '' }))}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50 text-sm"
                          >
                            <span className="font-medium">{m.name}</span>
                            {m.phone && <span className="text-gray-400 ml-2 text-xs">{m.phone}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 数量 */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">发放数量</label>
                <input
                  type="number"
                  min="1"
                  max={giveTarget.stock}
                  value={giveForm.quantity}
                  onChange={e => {
                    const v = e.target.value
                    if (v === '') { setGiveForm(f => ({ ...f, quantity: '' })); return }
                    const n = parseInt(v)
                    if (!isNaN(n)) setGiveForm(f => ({ ...f, quantity: Math.max(1, Math.min(giveTarget.stock, n)) }))
                  }}
                  onBlur={() => setGiveForm(f => {
                    const n = parseInt(f.quantity)
                    return { ...f, quantity: isNaN(n) ? 1 : Math.max(1, Math.min(giveTarget.stock, n)) }
                  })}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                />
              </div>

              {/* 原因 */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">发放原因</label>
                <select
                  value={giveForm.reason}
                  onChange={e => setGiveForm(f => ({ ...f, reason: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 bg-white"
                >
                  {GIFT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              {/* 备注 */}
              <div>
                <label className="text-xs text-gray-500 mb-1 block">备注（选填）</label>
                <input
                  value={giveForm.notes}
                  onChange={e => setGiveForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="可选"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                />
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowGive(false)} className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 text-sm">取消</button>
              <button onClick={handleGiveSubmit} disabled={giveSaving} className="flex-1 py-3 bg-pink-500 hover:bg-pink-600 disabled:bg-pink-300 text-white rounded-xl text-sm font-medium">
                {giveSaving ? '发放中...' : '确认发放'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 库存调整 modal */}
      {adjustTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">库存调整 · {adjustTarget.name}</h3>
              <button onClick={() => setAdjustTarget(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div className="text-xs text-gray-400">当前库存 <span className="font-semibold text-gray-700">{adjustTarget.stock}</span> 件</div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">调整后库存 *</label>
                <input
                  type="number"
                  min="0"
                  value={adjustForm.newStock}
                  onChange={e => setAdjustForm(f => ({ ...f, newStock: e.target.value }))}
                  placeholder="盘点后的实际数量"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
                {adjustForm.newStock !== '' && !isNaN(parseInt(adjustForm.newStock)) && parseInt(adjustForm.newStock) !== adjustTarget.stock && (
                  <div className="text-xs text-gray-400 mt-1">
                    变化 {parseInt(adjustForm.newStock) - adjustTarget.stock >= 0 ? '+' : ''}{parseInt(adjustForm.newStock) - adjustTarget.stock} 件
                  </div>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">调整原因 *</label>
                <input
                  value={adjustForm.reason}
                  onChange={e => setAdjustForm(f => ({ ...f, reason: e.target.value }))}
                  placeholder="如：盘点纠错、物料损耗、丢失"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-300"
                />
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setAdjustTarget(null)} className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 text-sm">取消</button>
              <button onClick={handleAdjustSubmit} disabled={adjustSaving} className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white rounded-xl text-sm font-medium">
                {adjustSaving ? '保存中...' : '确认调整'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 入库 modal */}
      {showStock && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">赠品物料入库</h3>
              <button onClick={() => setShowStock(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">物料名称 *</label>
                <input
                  value={stockForm.name}
                  onChange={e => setStockForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="如：润肤霜小样"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">规格（选填）</label>
                <input
                  value={stockForm.spec}
                  onChange={e => setStockForm(f => ({ ...f, spec: e.target.value }))}
                  placeholder="如：5ml"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">入库数量 *</label>
                <input
                  type="number"
                  min="1"
                  value={stockForm.quantity}
                  onChange={e => setStockForm(f => ({ ...f, quantity: e.target.value }))}
                  placeholder="正整数"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">备注（选填）</label>
                <input
                  value={stockForm.notes}
                  onChange={e => setStockForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="可选"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-300"
                />
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowStock(false)} className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 text-sm">取消</button>
              <button onClick={handleStockSubmit} disabled={stockSaving} className="flex-1 py-3 bg-yellow-500 hover:bg-yellow-600 disabled:bg-yellow-300 text-white rounded-xl text-sm font-medium">
                {stockSaving ? '入库中...' : '确认入库'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 消耗品 Tab ────────────────────────────────────────────────

function ConsumablesTab({ isOwner }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showStock, setShowStock] = useState(false)
  const [stockForm, setStockForm] = useState({ name: '', spec: '', quantity: '', purchased_at: dayjs().format('YYYY-MM-DD'), notes: '' })
  const [stockSaving, setStockSaving] = useState(false)
  const [markingId, setMarkingId] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [editForm, setEditForm] = useState({ name: '', spec: '', quantity: '', purchased_at: '', notes: '' })
  const [editSaving, setEditSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const fetchItems = async () => {
    setLoading(true)
    try {
      const res = await db.collection(COLLECTIONS.CONSUMABLES).limit(200).get()
      setItems((res.data || []).sort((a, b) => new Date(b.purchased_at) - new Date(a.purchased_at)))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchItems() }, [])

  const handleStockSubmit = async () => {
    if (!stockForm.name.trim()) { alert('请填写消耗品名称'); return }
    const qty = parseInt(stockForm.quantity)
    if (!qty || qty < 1) { alert('数量须为正整数'); return }
    setStockSaving(true)
    try {
      await db.collection(COLLECTIONS.CONSUMABLES).add({
        name: stockForm.name.trim(),
        spec: stockForm.spec.trim(),
        quantity: qty,
        purchased_at: new Date(stockForm.purchased_at),
        used_up_at: null,
        notes: stockForm.notes.trim(),
      })
      setShowStock(false)
      setStockForm({ name: '', spec: '', quantity: '', purchased_at: dayjs().format('YYYY-MM-DD'), notes: '' })
      await fetchItems()
    } catch (err) {
      alert('入库失败：' + err.message)
    } finally {
      setStockSaving(false)
    }
  }

  const handleMarkUsedUp = async (item) => {
    if (!window.confirm(`确认将「${item.name}」标记为已用完？`)) return
    setMarkingId(item._id)
    try {
      await db.collection(COLLECTIONS.CONSUMABLES).doc(item._id).update({ used_up_at: new Date() })
      await fetchItems()
    } catch (err) {
      alert('操作失败：' + err.message)
    } finally {
      setMarkingId(null)
    }
  }

  const openEdit = (item) => {
    setEditTarget(item)
    setEditForm({
      name: item.name,
      spec: item.spec || '',
      quantity: String(item.quantity),
      purchased_at: dayjs(item.purchased_at).format('YYYY-MM-DD'),
      notes: item.notes || '',
    })
  }

  const handleEditSubmit = async () => {
    if (!editForm.name.trim()) { alert('请填写消耗品名称'); return }
    const qty = parseInt(editForm.quantity)
    if (!qty || qty < 1) { alert('数量须为正整数'); return }
    setEditSaving(true)
    try {
      await db.collection(COLLECTIONS.CONSUMABLES).doc(editTarget._id).update({
        name: editForm.name.trim(),
        spec: editForm.spec.trim(),
        quantity: qty,
        purchased_at: new Date(editForm.purchased_at),
        notes: editForm.notes.trim(),
      })
      setEditTarget(null)
      await fetchItems()
    } catch (err) {
      alert('保存失败：' + err.message)
    } finally {
      setEditSaving(false)
    }
  }

  const handleDelete = async (item) => {
    if (!window.confirm(`确认删除「${item.name}」？此操作不可撤销。`)) return
    setDeletingId(item._id)
    try {
      await db.collection(COLLECTIONS.CONSUMABLES).doc(item._id).remove()
      await fetchItems()
    } catch (err) {
      alert('删除失败：' + err.message)
    } finally {
      setDeletingId(null)
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-400 text-sm">加载中...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-gray-400">{items.length} 条记录</span>
        {isOwner && (
          <button
            onClick={() => { setStockForm({ name: '', spec: '', quantity: '', purchased_at: dayjs().format('YYYY-MM-DD'), notes: '' }); setShowStock(true) }}
            className="px-4 py-2 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium"
          >
            + 入库
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="text-center py-16 text-gray-400 text-sm">暂无消耗品记录</div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-400 text-xs">
              <tr>
                <th className="text-left px-4 py-3">名称</th>
                <th className="text-left px-4 py-3 hidden sm:table-cell">规格</th>
                <th className="text-center px-4 py-3">数量</th>
                <th className="text-left px-4 py-3 hidden md:table-cell">入库时间</th>
                <th className="text-left px-4 py-3">状态</th>
                <th className="text-center px-4 py-3">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map(item => {
                const usedUp = !!item.used_up_at
                return (
                  <tr key={item._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-800">{item.name}</div>
                      {item.notes && <div className="text-xs text-gray-400">{item.notes}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{item.spec || '—'}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{item.quantity}</td>
                    <td className="px-4 py-3 text-gray-400 hidden md:table-cell">{dayjs(item.purchased_at).format('YYYY/MM/DD')}</td>
                    <td className="px-4 py-3">
                      {usedUp ? (
                        <span className="text-xs text-gray-400">已用完 · {dayjs(item.used_up_at).format('M月D日')}</span>
                      ) : (
                        <span className="text-xs text-green-600 font-medium">使用中</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        {!usedUp && (
                          <button
                            onClick={() => handleMarkUsedUp(item)}
                            disabled={markingId === item._id}
                            className="text-xs px-2.5 py-1 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-50"
                          >
                            {markingId === item._id ? '...' : '标记用完'}
                          </button>
                        )}
                        {isOwner && (
                          <>
                            <button
                              onClick={() => openEdit(item)}
                              className="text-xs px-2.5 py-1 border border-blue-200 rounded-lg text-blue-500 hover:bg-blue-50"
                            >
                              编辑
                            </button>
                            <button
                              onClick={() => handleDelete(item)}
                              disabled={deletingId === item._id}
                              className="text-xs px-2.5 py-1 border border-red-200 rounded-lg text-red-400 hover:bg-red-50 disabled:opacity-50"
                            >
                              {deletingId === item._id ? '...' : '删除'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 入库 modal */}
      {showStock && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">消耗品入库</h3>
              <button onClick={() => setShowStock(false)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">消耗品名称 *</label>
                <input
                  value={stockForm.name}
                  onChange={e => setStockForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="如：棉片"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">规格（选填）</label>
                <input
                  value={stockForm.spec}
                  onChange={e => setStockForm(f => ({ ...f, spec: e.target.value }))}
                  placeholder="如：100片/包"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">数量 *</label>
                <input
                  type="number"
                  min="1"
                  value={stockForm.quantity}
                  onChange={e => setStockForm(f => ({ ...f, quantity: e.target.value }))}
                  placeholder="正整数"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">入库时间</label>
                <input
                  type="date"
                  value={stockForm.purchased_at}
                  onChange={e => setStockForm(f => ({ ...f, purchased_at: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">备注（选填）</label>
                <input
                  value={stockForm.notes}
                  onChange={e => setStockForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="可选"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setShowStock(false)} className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 text-sm">取消</button>
              <button onClick={handleStockSubmit} disabled={stockSaving} className="flex-1 py-3 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white rounded-xl text-sm font-medium">
                {stockSaving ? '入库中...' : '确认入库'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑 modal */}
      {editTarget && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="font-semibold text-gray-800">编辑消耗品</h3>
              <button onClick={() => setEditTarget(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500 mb-1 block">消耗品名称 *</label>
                <input
                  value={editForm.name}
                  onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">规格（选填）</label>
                <input
                  value={editForm.spec}
                  onChange={e => setEditForm(f => ({ ...f, spec: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">数量 *</label>
                <input
                  type="number"
                  min="1"
                  value={editForm.quantity}
                  onChange={e => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">入库时间</label>
                <input
                  type="date"
                  value={editForm.purchased_at}
                  onChange={e => setEditForm(f => ({ ...f, purchased_at: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500 mb-1 block">备注（选填）</label>
                <input
                  value={editForm.notes}
                  onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                />
              </div>
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button onClick={() => setEditTarget(null)} className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600 text-sm">取消</button>
              <button onClick={handleEditSubmit} disabled={editSaving} className="flex-1 py-3 bg-teal-500 hover:bg-teal-600 disabled:bg-teal-300 text-white rounded-xl text-sm font-medium">
                {editSaving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── 主页面 ────────────────────────────────────────────────────

export default function MaterialManagement({ onBack }) {
  const [activeTab, setActiveTab] = useState('gift')
  const { isOwner } = usePermission()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={onBack} className="text-gray-500">← 返回</button>
        <h1 className="text-lg font-bold text-gray-800">物料管理</h1>
      </div>

      <div className="flex border-b border-gray-200 bg-white px-4">
        {[{ key: 'gift', label: '赠品物料' }, { key: 'consumables', label: '消耗品' }].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key
                ? 'border-yellow-500 text-yellow-600'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4 max-w-3xl mx-auto">
        {activeTab === 'gift' ? <GiftMaterialsTab isOwner={isOwner} /> : <ConsumablesTab isOwner={isOwner} />}
      </div>
    </div>
  )
}
