import { useState } from 'react'
import { db } from '../../../lib/cloudbase'
import { COLLECTIONS } from '../../../lib/collections'
import useCacheStore from '../../../store/cacheStore'
import { toArray } from '../../../utils/array'

const EMPTY_PROMO = {
  name: '',
  type: 'spend_threshold',
  scope: 'global',
  product_ids: [],
  threshold: '',
  discount: '',
  enabled: true,
}

export default function PromoManagement({ onBack }) {
  const { getSetting, refreshCache, products } = useCacheStore()
  const [showForm, setShowForm] = useState(false)
  const [promoForm, setPromoForm] = useState(EMPTY_PROMO)
  const [editingPromoId, setEditingPromoId] = useState(null)
  const [promoProductSearch, setPromoProductSearch] = useState('')
  const [promoSearchResults, setPromoSearchResults] = useState(null)

  const currentPromos = toArray(getSetting('promotions', [])).filter(Boolean)

  const clearPromoSearch = () => { setPromoProductSearch(''); setPromoSearchResults(null) }
  const handlePromoSearch = () => {
    const val = promoProductSearch.trim()
    if (!val) { setPromoSearchResults(null); return }
    setPromoSearchResults(products.filter((p) =>
      p.name.toLowerCase().includes(val.toLowerCase()) || String(p.barcode).includes(val)
    ))
  }

  const savePromos = async (updated) => {
    const res = await db.collection(COLLECTIONS.SETTINGS).where({ key: 'promotions' }).get()
    if (res.data.length > 0) {
      await db.collection(COLLECTIONS.SETTINGS).doc(res.data[0]._id).update({ value: updated })
    } else {
      await db.collection(COLLECTIONS.SETTINGS).add({ key: 'promotions', value: updated })
    }
    await refreshCache('settings')
  }

  const handleSave = async () => {
    if (!promoForm.name.trim()) { alert('请填写活动名称'); return }
    if (promoForm.type === 'spend_threshold' && (!promoForm.threshold || !promoForm.discount)) {
      alert('请填写满减金额'); return
    }
    const entry = {
      ...promoForm,
      id: editingPromoId || Date.now().toString(),
      threshold: Number(promoForm.threshold) || 0,
      discount: Number(promoForm.discount) || 0,
    }
    const updated = editingPromoId
      ? currentPromos.map((p) => (p.id === editingPromoId ? entry : p))
      : [...currentPromos, entry]
    try {
      await savePromos(updated)
      setShowForm(false)
      setEditingPromoId(null)
      setPromoForm(EMPTY_PROMO)
      clearPromoSearch()
    } catch (err) {
      alert('保存失败：' + err.message)
    }
  }

  const handleToggle = async (promoId) => {
    await savePromos(currentPromos.map((p) => (p.id === promoId ? { ...p, enabled: !p.enabled } : p)))
  }

  const handleDelete = async (promoId) => {
    if (!window.confirm('确认删除此促销活动？')) return
    await savePromos(currentPromos.filter((p) => p.id !== promoId))
  }

  const openEdit = (promo) => {
    setEditingPromoId(promo.id)
    setPromoForm({ ...promo, threshold: promo.threshold || '', discount: promo.discount || '' })
    setShowForm(true)
  }

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700">← 返回</button>
        <h2 className="text-xl font-bold text-gray-800">促销活动</h2>
      </div>

      <div className="space-y-2">
        {currentPromos.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-8">暂无促销活动</div>
        )}
        {currentPromos.map((promo) => (
          <div key={promo.id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 shadow-sm">
            <div>
              <div className="text-sm font-medium text-gray-800">{promo.name}</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {promo.type === 'spend_threshold'
                  ? `满¥${promo.threshold}减¥${promo.discount}`
                  : '买一送一'}
                {' · '}
                {promo.scope === 'global' ? '全局' : `指定商品(${toArray(promo.product_ids).length}款)`}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 ml-2">
              <button
                onClick={() => handleToggle(promo.id)}
                className={`text-xs px-2 py-1 rounded-full ${promo.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
              >
                {promo.enabled ? '启用' : '停用'}
              </button>
              <button onClick={() => openEdit(promo)} className="text-xs text-blue-500">编辑</button>
              <button onClick={() => handleDelete(promo.id)} className="text-xs text-red-400">删除</button>
            </div>
          </div>
        ))}
        <button
          onClick={() => { setPromoForm(EMPTY_PROMO); setEditingPromoId(null); setShowForm(true) }}
          className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 text-sm hover:border-pink-300 hover:text-pink-400 transition-colors"
        >
          + 新增促销活动
        </button>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-5 w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-4">{editingPromoId ? '编辑促销' : '新增促销'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">活动名称 *</label>
                <input type="text" value={promoForm.name}
                  onChange={(e) => setPromoForm({ ...promoForm, name: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
              </div>

              <div>
                <label className="block text-sm text-gray-600 mb-1">活动类型</label>
                <div className="flex gap-2">
                  {[{ v: 'spend_threshold', l: '满减' }, { v: 'bogo', l: '买一送一' }].map(({ v, l }) => (
                    <button key={v} type="button"
                      onClick={() => setPromoForm({ ...promoForm, type: v })}
                      className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                        promoForm.type === v ? 'bg-pink-500 text-white border-pink-500' : 'bg-white text-gray-600 border-gray-300'
                      }`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {promoForm.type === 'spend_threshold' && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-sm text-gray-600 mb-1">满（¥）*</label>
                    <input type="number" value={promoForm.threshold}
                      onChange={(e) => setPromoForm({ ...promoForm, threshold: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-sm text-gray-600 mb-1">减（¥）*</label>
                    <input type="number" value={promoForm.discount}
                      onChange={(e) => setPromoForm({ ...promoForm, discount: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm text-gray-600 mb-1">生效范围</label>
                <div className="flex gap-2">
                  {[{ v: 'global', l: '全局' }, { v: 'products', l: '指定商品' }].map(({ v, l }) => (
                    <button key={v} type="button"
                      onClick={() => setPromoForm({ ...promoForm, scope: v, product_ids: [] })}
                      className={`flex-1 py-2 rounded-lg text-sm border transition-colors ${
                        promoForm.scope === v ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-300'
                      }`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              {promoForm.scope === 'products' && (
                <div>
                  <label className="block text-sm text-gray-600 mb-1">关联商品</label>
                  {toArray(promoForm.product_ids).length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {toArray(promoForm.product_ids).map((id) => {
                        const p = products.find((p) => p._id === id)
                        if (!p) return null
                        return (
                          <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                            {p.name}
                            <button type="button"
                              onClick={() => setPromoForm({ ...promoForm, product_ids: toArray(promoForm.product_ids).filter((i) => i !== id) })}
                              className="hover:text-blue-900">✕</button>
                          </span>
                        )
                      })}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input type="text" placeholder="商品名称或条形码"
                      value={promoProductSearch}
                      onChange={(e) => { setPromoProductSearch(e.target.value); if (!e.target.value) setPromoSearchResults(null) }}
                      onKeyDown={(e) => e.key === 'Enter' && handlePromoSearch()}
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
                    <button type="button" onClick={handlePromoSearch}
                      className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg whitespace-nowrap">
                      搜索
                    </button>
                    {promoProductSearch && (
                      <button type="button" onClick={clearPromoSearch}
                        className="px-2 text-gray-400 hover:text-gray-600 text-sm">✕</button>
                    )}
                  </div>
                  {promoSearchResults !== null && (
                    <div className="mt-2 flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                      {promoSearchResults.length === 0
                        ? <span className="text-gray-400 text-xs">没有匹配的商品</span>
                        : promoSearchResults.map((p) => {
                          const isSelected = toArray(promoForm.product_ids).includes(p._id)
                          return (
                            <button key={p._id} type="button"
                              onClick={() => {
                                const ids = isSelected
                                  ? toArray(promoForm.product_ids).filter((id) => id !== p._id)
                                  : [...toArray(promoForm.product_ids), p._id]
                                setPromoForm({ ...promoForm, product_ids: ids })
                              }}
                              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                                isSelected ? 'bg-blue-500 text-white border-blue-500' : 'bg-white text-gray-600 border-gray-300'
                              }`}>
                              {p.name}
                            </button>
                          )
                        })
                      }
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowForm(false); clearPromoSearch() }}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm">
                取消
              </button>
              <button onClick={handleSave}
                className="flex-1 py-2 bg-pink-500 text-white rounded-lg text-sm">
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
