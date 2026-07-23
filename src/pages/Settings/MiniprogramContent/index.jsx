import { useState, useEffect, useRef, useCallback } from 'react'
import { db } from '../../../lib/cloudbase'
import { uploadImage, batchGetUrls } from '../../../utils/uploadFile'
import useCacheStore from '../../../store/cacheStore'

const COL_BANNERS = 'promotion_banners'
const COL_SALE = 'sale_items'

// ── Shared image upload button ──────────────────────────────────────────────
function ImageUploadBox({ fileID, previewUrl, onUploaded, uploading, folder }) {
  const inputRef = useRef()
  const [localPreview, setLocalPreview] = useState(previewUrl || '')

  useEffect(() => { setLocalPreview(previewUrl || '') }, [previewUrl])

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setLocalPreview(URL.createObjectURL(file))
    const result = await onUploaded(file, folder)
    if (result?.previewUrl) setLocalPreview(result.previewUrl)
  }

  return (
    <div
      className="w-24 h-24 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center cursor-pointer overflow-hidden bg-gray-50 hover:bg-gray-100 transition-colors flex-shrink-0"
      onClick={() => inputRef.current?.click()}
    >
      {uploading ? (
        <span className="text-xs text-gray-400">上传中…</span>
      ) : localPreview ? (
        <img src={localPreview} alt="" className="w-full h-full object-cover" />
      ) : (
        <span className="text-2xl text-gray-300">+</span>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}

// ── Product search input ─────────────────────────────────────────────────────
function ProductSearch({ value, onSelect }) {
  const [query, setQuery] = useState(value || '')
  const [suggestions, setSuggestions] = useState([])
  const products = useCacheStore(s => s.products)

  useEffect(() => { setQuery(value || '') }, [value])

  function handleInput(e) {
    const q = e.target.value
    setQuery(q)
    if (!q.trim()) { setSuggestions([]); return }
    setSuggestions(
      products.filter(p => p.name.includes(q.trim())).slice(0, 8)
    )
  }

  function pick(p) {
    setSuggestions([])
    setQuery(p.name)
    onSelect(p)
  }

  return (
    <div className="relative">
      <input
        className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
        placeholder="输入商品名称搜索"
        value={query}
        onChange={handleInput}
      />
      {suggestions.length > 0 && (
        <ul className="absolute z-20 bg-white border rounded-lg shadow-lg mt-1 w-full max-h-48 overflow-y-auto">
          {suggestions.map(p => (
            <li
              key={p._id}
              className="px-3 py-2 text-sm hover:bg-pink-50 cursor-pointer"
              onMouseDown={() => pick(p)}
            >
              <span className="font-medium">{p.name}</span>
              <span className="text-gray-400 ml-2">{p.category} · ¥{p.sale_price}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Move order helpers ───────────────────────────────────────────────────────
async function swapOrder(col, a, b) {
  await Promise.all([
    db.collection(col).doc(a._id).update({ sort_order: b.sort_order }),
    db.collection(col).doc(b._id).update({ sort_order: a.sort_order }),
  ])
}

// ── Promotion Banners Section ────────────────────────────────────────────────
function BannersSection() {
  const [banners, setBanners] = useState([])
  const [urlMap, setUrlMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | { mode:'add'|'edit', item }
  const [form, setForm] = useState({ name: '', image_file_id: '', image_preview: '' })
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await db.collection(COL_BANNERS).orderBy('sort_order', 'asc').limit(20).get()
    const items = res.data
    const ids = items.map(i => i.image_file_id).filter(Boolean)
    const urls = ids.length ? await batchGetUrls(ids) : {}
    setBanners(items)
    setUrlMap(urls)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd() {
    setForm({ name: '', image_file_id: '', image_preview: '' })
    setModal({ mode: 'add' })
  }

  function openEdit(item) {
    setForm({
      name: item.name || '',
      image_file_id: item.image_file_id || '',
      image_preview: urlMap[item.image_file_id] || '',
    })
    setModal({ mode: 'edit', item })
  }

  async function handleUpload(file) {
    setUploading(true)
    try {
      const result = await uploadImage(file, 'miniprogram/banners')
      setForm(f => ({ ...f, image_file_id: result.fileID, image_preview: result.previewUrl }))
      return result
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    if (!form.name.trim()) { alert('请输入名称'); return }
    setSaving(true)
    try {
      const maxOrder = banners.length ? Math.max(...banners.map(b => b.sort_order || 0)) : -1
      if (modal.mode === 'add') {
        await db.collection(COL_BANNERS).add({
          name: form.name.trim(),
          image_file_id: form.image_file_id || '',
          sort_order: maxOrder + 1,
          enabled: true,
          created_at: new Date(),
        })
      } else {
        await db.collection(COL_BANNERS).doc(modal.item._id).update({
          name: form.name.trim(),
          image_file_id: form.image_file_id || '',
        })
      }
      setModal(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(item) {
    await db.collection(COL_BANNERS).doc(item._id).update({ enabled: !item.enabled })
    setBanners(bs => bs.map(b => b._id === item._id ? { ...b, enabled: !b.enabled } : b))
  }

  async function moveUp(idx) {
    if (idx === 0) return
    await swapOrder(COL_BANNERS, banners[idx], banners[idx - 1])
    await load()
  }

  async function moveDown(idx) {
    if (idx === banners.length - 1) return
    await swapOrder(COL_BANNERS, banners[idx], banners[idx + 1])
    await load()
  }

  async function handleDelete(item) {
    if (!confirm(`确认删除「${item.name}」？`)) return
    await db.collection(COL_BANNERS).doc(item._id).remove()
    await load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-gray-800">促销活动</p>
          <p className="text-xs text-gray-400 mt-0.5">以图片形式展示，纵向排列</p>
        </div>
        <button
          className="text-sm bg-pink-500 text-white px-3 py-1.5 rounded-lg hover:bg-pink-600"
          onClick={openAdd}
        >+ 添加</button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-4 text-center">加载中…</p>
      ) : banners.length === 0 ? (
        <p className="text-gray-400 text-sm py-4 text-center">暂无促销活动</p>
      ) : (
        <div className="space-y-2">
          {banners.map((item, idx) => (
            <div key={item._id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
              <div className="w-16 h-12 rounded-lg overflow-hidden bg-gray-200 flex-shrink-0">
                {urlMap[item.image_file_id]
                  ? <img src={urlMap[item.image_file_id]} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">无图</div>
                }
              </div>
              <span className="flex-1 text-sm font-medium text-gray-700 truncate">{item.name}</span>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  className={`text-xs px-2 py-1 rounded-lg ${item.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                  onClick={() => toggleEnabled(item)}
                >{item.enabled ? '启用' : '停用'}</button>
                <button className="text-gray-400 hover:text-gray-600 px-1 disabled:opacity-30" disabled={idx === 0} onClick={() => moveUp(idx)}>↑</button>
                <button className="text-gray-400 hover:text-gray-600 px-1 disabled:opacity-30" disabled={idx === banners.length - 1} onClick={() => moveDown(idx)}>↓</button>
                <button className="text-blue-500 hover:text-blue-700 text-xs px-1" onClick={() => openEdit(item)}>编辑</button>
                <button className="text-red-400 hover:text-red-600 text-xs px-1" onClick={() => handleDelete(item)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4">
            <h3 className="font-bold text-lg">{modal.mode === 'add' ? '添加促销活动' : '编辑促销活动'}</h3>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">名称</label>
              <input
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                placeholder="例：春季焕新优惠"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">图片</label>
              <ImageUploadBox
                fileID={form.image_file_id}
                previewUrl={form.image_preview}
                uploading={uploading}
                folder="miniprogram/banners"
                onUploaded={handleUpload}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button className="flex-1 border rounded-xl py-2.5 text-sm text-gray-600" onClick={() => setModal(null)}>取消</button>
              <button
                className="flex-1 bg-pink-500 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-60"
                disabled={saving || uploading}
                onClick={handleSave}
              >{saving ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sale Items Section ────────────────────────────────────────────────────────
function SaleItemsSection() {
  const products = useCacheStore(s => s.products)
  const [items, setItems] = useState([])
  const [urlMap, setUrlMap] = useState({})
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({
    product_id: '', product_name: '', category: '',
    sale_price: '', description: '',
    image_file_id: '', image_preview: '',
  })
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await db.collection(COL_SALE).orderBy('sort_order', 'asc').limit(20).get()
    const data = res.data
    const ids = data.map(i => i.image_file_id).filter(Boolean)
    const urls = ids.length ? await batchGetUrls(ids) : {}
    setItems(data)
    setUrlMap(urls)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function getOriginalPrice(item) {
    const p = products.find(p => p._id === item.product_id)
    return p?.sale_price ?? null
  }

  function openAdd() {
    setForm({ product_id: '', product_name: '', category: '', sale_price: '', description: '', image_file_id: '', image_preview: '' })
    setModal({ mode: 'add' })
  }

  function openEdit(item) {
    setForm({
      product_id: item.product_id || '',
      product_name: item.product_name || '',
      category: item.category || '',
      sale_price: String(item.sale_price ?? ''),
      description: item.description || '',
      image_file_id: item.image_file_id || '',
      image_preview: urlMap[item.image_file_id] || '',
    })
    setModal({ mode: 'edit', item })
  }

  function handleProductSelect(p) {
    setForm(f => ({
      ...f,
      product_id: p._id,
      product_name: p.name,
      category: p.category || '',
    }))
  }

  async function handleUpload(file) {
    setUploading(true)
    try {
      const result = await uploadImage(file, 'miniprogram/sale-items')
      setForm(f => ({ ...f, image_file_id: result.fileID, image_preview: result.previewUrl }))
      return result
    } finally {
      setUploading(false)
    }
  }

  async function handleSave() {
    if (!form.product_id) { alert('请选择商品'); return }
    const salePrice = parseFloat(form.sale_price)
    if (isNaN(salePrice) || salePrice < 0) { alert('请输入有效的售价'); return }
    setSaving(true)
    try {
      const maxOrder = items.length ? Math.max(...items.map(i => i.sort_order || 0)) : -1
      const payload = {
        product_id: form.product_id,
        product_name: form.product_name,
        category: form.category,
        sale_price: salePrice,
        description: form.description.trim(),
        image_file_id: form.image_file_id || '',
      }
      if (modal.mode === 'add') {
        await db.collection(COL_SALE).add({ ...payload, sort_order: maxOrder + 1, enabled: true, created_at: new Date() })
      } else {
        await db.collection(COL_SALE).doc(modal.item._id).update(payload)
      }
      setModal(null)
      await load()
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(item) {
    await db.collection(COL_SALE).doc(item._id).update({ enabled: !item.enabled })
    setItems(prev => prev.map(i => i._id === item._id ? { ...i, enabled: !i.enabled } : i))
  }

  async function moveUp(idx) {
    if (idx === 0) return
    await swapOrder(COL_SALE, items[idx], items[idx - 1])
    await load()
  }

  async function moveDown(idx) {
    if (idx === items.length - 1) return
    await swapOrder(COL_SALE, items[idx], items[idx + 1])
    await load()
  }

  async function handleDelete(item) {
    if (!confirm(`确认删除「${item.product_name}」？`)) return
    await db.collection(COL_SALE).doc(item._id).remove()
    await load()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="font-semibold text-gray-800">
            特价商品
            <span className="ml-2 text-xs text-gray-400 font-normal">{items.length}/20</span>
          </p>
          <p className="text-xs text-gray-400 mt-0.5">双列卡片展示，最多 20 个</p>
        </div>
        <button
          className="text-sm bg-pink-500 text-white px-3 py-1.5 rounded-lg hover:bg-pink-600 disabled:opacity-40"
          disabled={items.length >= 20}
          onClick={openAdd}
        >+ 添加</button>
      </div>

      {loading ? (
        <p className="text-gray-400 text-sm py-4 text-center">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-gray-400 text-sm py-4 text-center">暂无特价商品</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => {
            const originalPrice = getOriginalPrice(item)
            const discount = originalPrice && item.sale_price < originalPrice
              ? Math.round(item.sale_price / originalPrice * 10 * 10) / 10
              : null
            return (
              <div key={item._id} className="flex items-center gap-3 bg-gray-50 rounded-xl p-3">
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-200 flex-shrink-0">
                  {urlMap[item.image_file_id]
                    ? <img src={urlMap[item.image_file_id]} alt="" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">无图</div>
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{item.product_name}</p>
                  <p className="text-xs text-gray-400">{item.category}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-sm font-semibold text-rose-500">¥{item.sale_price}</span>
                    {originalPrice && <span className="text-xs text-gray-400 line-through">¥{originalPrice}</span>}
                    {discount && <span className="text-xs bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded">{discount}折</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    className={`text-xs px-2 py-1 rounded-lg ${item.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-500'}`}
                    onClick={() => toggleEnabled(item)}
                  >{item.enabled ? '启用' : '停用'}</button>
                  <button className="text-gray-400 hover:text-gray-600 px-1 disabled:opacity-30" disabled={idx === 0} onClick={() => moveUp(idx)}>↑</button>
                  <button className="text-gray-400 hover:text-gray-600 px-1 disabled:opacity-30" disabled={idx === items.length - 1} onClick={() => moveDown(idx)}>↓</button>
                  <button className="text-blue-500 hover:text-blue-700 text-xs px-1" onClick={() => openEdit(item)}>编辑</button>
                  <button className="text-red-400 hover:text-red-600 text-xs px-1" onClick={() => handleDelete(item)}>删除</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl w-full max-w-sm p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg">{modal.mode === 'add' ? '添加特价商品' : '编辑特价商品'}</h3>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">商品名称</label>
              <ProductSearch
                value={form.product_name}
                onSelect={handleProductSelect}
              />
              {form.category && (
                <p className="text-xs text-gray-400 mt-1">品类：{form.category}</p>
              )}
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">特价售价（元）</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                placeholder="例：188"
                value={form.sale_price}
                onChange={e => setForm(f => ({ ...f, sale_price: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">商品描述</label>
              <textarea
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 resize-none"
                rows={3}
                placeholder="简短描述商品特点或促销原因"
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">商品图片</label>
              <ImageUploadBox
                fileID={form.image_file_id}
                previewUrl={form.image_preview}
                uploading={uploading}
                folder="miniprogram/sale-items"
                onUploaded={handleUpload}
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button className="flex-1 border rounded-xl py-2.5 text-sm text-gray-600" onClick={() => setModal(null)}>取消</button>
              <button
                className="flex-1 bg-pink-500 text-white rounded-xl py-2.5 text-sm font-medium disabled:opacity-60"
                disabled={saving || uploading}
                onClick={handleSave}
              >{saving ? '保存中…' : '保存'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function MiniprogramContent({ onBack }) {
  return (
    <div className="p-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={onBack} className="text-gray-500 hover:text-gray-700">← 返回</button>
        <h2 className="text-xl font-bold text-gray-800">小程序内容管理</h2>
      </div>

      <div className="space-y-6">
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <BannersSection />
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <SaleItemsSection />
        </div>
      </div>
    </div>
  )
}
