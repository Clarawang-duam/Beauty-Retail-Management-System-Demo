import { useState, useEffect, useRef } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { db, _ } from '../../../lib/cloudbase'
import { COLLECTIONS } from '../../../lib/collections'
import { usePermission } from '../../../hooks/usePermission'
import useAuthStore from '../../../store/authStore'
import useCacheStore from '../../../store/cacheStore'
import BatchImport from '../../../components/BatchImport'
import OperationLogPanel from '../../../components/OperationLogPanel'
import {
  validateProduct,
  PRODUCT_HEADERS,
  PRODUCT_KEYS,
} from '../../../utils/validators'
import { exportToExcel } from '../../../utils/excelImport'
import { writeLog } from '../../../utils/operationLog'
import { toArray } from '../../../utils/array'
import { findDuplicateProduct } from '../../../utils/productDuplicate'

const EMPTY_FORM = {
  name: '', category: '', type: '', spec: '', barcode: '',
  purchase_price: '', sale_price: '',
  is_points_product: false,
  exclude_from_sales: false,
  kit_components: [],
}

export default function ProductManagement({ onBack }) {
  const { canEditSettings, isOwner, canViewPurchasePrice } = usePermission()
  const user = useAuthStore((s) => s.user)
  const { products, refreshCache } = useCacheStore()
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [batchEdit, setBatchEdit] = useState({ type: '' })
  const [tab, setTab] = useState('list')
  const [logVersion, setLogVersion] = useState(0)
  const [saving, setSaving] = useState(false)
  const [duplicateProduct, setDuplicateProduct] = useState(null)
  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState(null)
  const [searchError, setSearchError] = useState('')
  const [showScanner, setShowScanner] = useState(false)
  const [showSearchScanner, setShowSearchScanner] = useState(false)
  const [scanToast, setScanToast] = useState(null)
  const [componentSearch, setComponentSearch] = useState('')
  const scannerControlsRef = useRef(null)
  const searchScannerControlsRef = useRef(null)
  const videoRef = useRef(null)
  const searchVideoRef = useRef(null)
  const lastScanTimeRef = useRef(0)
  const searchLastScanRef = useRef(0)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef(null)

  useEffect(() => {
    if (!showMoreMenu) return
    const handleClick = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setShowMoreMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMoreMenu])

  const stopScanner = () => {
    if (scannerControlsRef.current) {
      scannerControlsRef.current.stop()
      scannerControlsRef.current = null
    }
    setShowScanner(false)
  }

  const stopSearchScanner = () => {
    if (searchScannerControlsRef.current) {
      searchScannerControlsRef.current.stop()
      searchScannerControlsRef.current = null
    }
    setShowSearchScanner(false)
  }

  const handleSearch = (overrideVal) => {
    const val = (overrideVal !== undefined ? overrideVal : searchInput).trim()
    if (!val) { setSearchResults(null); setSearchError(''); return }
    const results = products.filter((p) =>
      p.name.toLowerCase().includes(val.toLowerCase()) ||
      String(p.barcode).includes(val)
    )
    setSearchResults(results)
    setSearchError(results.length === 0 ? '没有匹配的商品' : '')
  }

  // 扫码（新增商品条形码）
  useEffect(() => {
    if (!showScanner) return
    let active = true
    const start = async () => {
      try {
        const codeReader = new BrowserMultiFormatReader()
        const video = videoRef.current
        if (!video) return
        const controls = await codeReader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          video,
          (result) => {
            if (!active || !result) return
            const now = Date.now()
            if (now - lastScanTimeRef.current < 1500) return
            lastScanTimeRef.current = now
            const barcode = result.getText()
            const exists = products.some((p) => String(p.barcode) === barcode)
            if (exists) {
              setScanToast({ message: '商品已存在', type: 'error' })
              setTimeout(() => { setScanToast(null); stopScanner() }, 500)
            } else {
              setForm((prev) => ({ ...prev, barcode }))
              stopScanner()
            }
          }
        )
        if (active) scannerControlsRef.current = controls
        else controls.stop()
      } catch (err) {
        if (active) {
          alert('无法启动摄像头：' + err.message)
          setShowScanner(false)
        }
      }
    }
    start()
    return () => {
      active = false
      if (scannerControlsRef.current) {
        scannerControlsRef.current.stop()
        scannerControlsRef.current = null
      }
    }
  }, [showScanner])

  // 扫码（搜索商品）
  useEffect(() => {
    if (!showSearchScanner) return
    let active = true
    const start = async () => {
      try {
        const codeReader = new BrowserMultiFormatReader()
        const video = searchVideoRef.current
        if (!video) return
        const controls = await codeReader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          video,
          (result) => {
            if (!active || !result) return
            const now = Date.now()
            if (now - searchLastScanRef.current < 1500) return
            searchLastScanRef.current = now
            const barcode = result.getText()
            setSearchInput(barcode)
            handleSearch(barcode)
            stopSearchScanner()
          }
        )
        if (active) searchScannerControlsRef.current = controls
        else controls.stop()
      } catch (err) {
        if (active) {
          alert('无法启动摄像头：' + err.message)
          setShowSearchScanner(false)
        }
      }
    }
    start()
    return () => {
      active = false
      if (searchScannerControlsRef.current) {
        searchScannerControlsRef.current.stop()
        searchScannerControlsRef.current = null
      }
    }
  }, [showSearchScanner])

  const existingBarcodes = new Set(products.map((p) => p.barcode).filter(Boolean))

  const [componentResults, setComponentResults] = useState([])

  const searchComponents = (val) => {
    const q = (val ?? componentSearch).trim()
    if (!q) { setComponentResults([]); return }
    const results = products
      .filter((p) =>
        p._id !== editItem?._id &&
        !form.kit_components.some((c) => c.product_id === p._id) &&
        (p.name.toLowerCase().includes(q.toLowerCase()) || String(p.barcode).includes(q))
      )
      .slice(0, 20)
    setComponentResults(results)
  }

  const addComponent = (productId) => {
    setForm((prev) => ({ ...prev, kit_components: [...prev.kit_components, { product_id: productId, qty: 1 }] }))
    setComponentSearch('')
    setComponentResults([])
  }

  const addAllComponents = () => {
    setForm((prev) => {
      const existingIds = new Set(prev.kit_components.map((c) => c.product_id))
      const newComponents = componentResults
        .filter((p) => !existingIds.has(p._id))
        .map((p) => ({ product_id: p._id, qty: 1 }))
      return { ...prev, kit_components: [...prev.kit_components, ...newComponents] }
    })
    setComponentSearch('')
    setComponentResults([])
  }

  const removeComponent = (productId) => {
    setForm((prev) => ({ ...prev, kit_components: prev.kit_components.filter((c) => c.product_id !== productId) }))
  }

  const updateComponentQty = (productId, qty) => {
    setForm((prev) => ({
      ...prev,
      kit_components: prev.kit_components.map((c) => {
        if (c.product_id !== productId) return c
        if (qty === '') return { ...c, qty: '' }            // 允许编辑时为空
        const n = Number(qty)
        return isNaN(n) ? c : { ...c, qty: Math.max(1, n) }
      }),
    }))
  }

  // 套盒子件数量失焦：空值归位为 1
  const normalizeComponentQty = (productId) => {
    setForm((prev) => ({
      ...prev,
      kit_components: prev.kit_components.map((c) =>
        c.product_id === productId && (c.qty === '' || isNaN(Number(c.qty)))
          ? { ...c, qty: 1 } : c
      ),
    }))
  }

  const openAdd = () => {
    setEditItem(null)
    setForm(EMPTY_FORM)
    setComponentSearch('')
    setComponentResults([])
    setShowForm(true)
  }

  const openEdit = (item) => {
    if (!canEditSettings) return
    setEditItem(item)
    const rawComponents = toArray(item.kit_components || [])
    const normalizedComponents = rawComponents.map((c) =>
      typeof c === 'string' ? { product_id: c, qty: 1 } : c
    )
    setForm({
      name: item.name || '',
      category: item.category || '',
      type: item.type || '',
      spec: item.spec || '',
      barcode: item.barcode || '',
      purchase_price: item.purchase_price ?? '',
      sale_price: item.sale_price ?? '',
      is_points_product: item.is_points_product || false,
      exclude_from_sales: item.exclude_from_sales || false,
      kit_components: normalizedComponents,
    })
    setComponentSearch('')
    setComponentResults([])
    setShowForm(true)
  }

  const handleSave = async () => {
    const barcode = form.barcode?.trim()
    if (!form.name || !form.sale_price || !barcode) {
      alert('商品名称、销售价、条形码为必填项')
      return
    }
    const dup = findDuplicateProduct(barcode, products, editItem?._id)
    if (dup) {
      setDuplicateProduct(dup)
      return
    }
    setSaving(true)
    try {
    const data = {
      ...form,
      barcode,
      purchase_price: form.purchase_price !== '' ? Number(form.purchase_price) : 0,
      sale_price: Number(form.sale_price),
      exclude_from_sales: form.exclude_from_sales || false,
      kit_components: form.kit_components,
    }
    if (editItem) {
      await db.collection(COLLECTIONS.PRODUCTS).doc(editItem._id).update(data)
      await db.collection(COLLECTIONS.INVENTORY)
        .where({ product_id: editItem._id })
        .update({ product_name: form.name, spec: form.spec || '', barcode: form.barcode || '', category: form.category || '', type: form.type || '' })
      const DIFF_FIELDS = [
        { key: 'name', label: '名称' },
        { key: 'type', label: '品类' },
        { key: 'sale_price', label: '销售价' },
        { key: 'category', label: '供应商' },
        { key: 'barcode', label: '条码' },
      ]
      const changes = DIFF_FIELDS
        .filter(({ key }) => String(editItem[key] ?? '') !== String(form[key] ?? ''))
        .map(({ key, label }) => `${label}由「${editItem[key] ?? ''}」改成「${form[key] ?? ''}」`)
      if (changes.length > 0) {
        await writeLog(user, '商品管理', `将「${editItem.name}」的${changes.join('、')}`)
      }
    } else {
      await db.collection(COLLECTIONS.PRODUCTS).add({ ...data, created_at: new Date() })
      await writeLog(user, '商品管理', `新增商品「${form.name}」`)
    }
    await refreshCache('products')
    setShowForm(false)
    setLogVersion((v) => v + 1)
    } catch (err) { alert('保存失败：' + err.message) } finally { setSaving(false) }
  }

  const exitSelectMode = () => {
    setSelectMode(false)
    setSelected(new Set())
    setBatchEdit({ type: '' })
  }

  const handleBatchEdit = async () => {
    if (selected.size === 0) return
    const type = batchEdit.type.trim()
    if (!type) { alert('请填写品类'); return }
    for (const id of selected) {
      await db.collection(COLLECTIONS.PRODUCTS).doc(id).update({ type })
    }
    await writeLog(user, '商品管理', `批量编辑 ${selected.size} 个商品：品类→${type}`)
    await refreshCache('products')
    exitSelectMode()
    setLogVersion((v) => v + 1)
  }

  const handleDeleteSelected = async () => {
    if (!window.confirm(`确认删除选中的 ${selected.size} 个商品？`)) return
    setSaving(true)
    try {
    const blocked = []
    for (const id of selected) {
      const product = products.find((p) => p._id === id)
      if (!product) continue
      const res = await db.collection(COLLECTIONS.MEMBER_PROJECTS)
        .where({ product_id: id, remaining_sessions: _.gt(0) })
        .limit(1)
        .get()
      if (res.data.length > 0) blocked.push(product.name)
    }

    if (blocked.length > 0) {
      alert(`以下商品仍有会员项目在使用，无法删除：\n${blocked.join('、')}`)
      setSaving(false)
      return
    }

    for (const id of selected) {
      await db.collection(COLLECTIONS.PRODUCTS).doc(id).remove()
    }
    await writeLog(user, '商品管理', `删除 ${selected.size} 个商品`)
    await refreshCache('products')
    exitSelectMode()
    setLogVersion((v) => v + 1)
    } catch (err) { alert('删除失败：' + err.message) } finally { setSaving(false) }
  }

  const handleBatchImport = async (rows) => {
    const col = db.collection(COLLECTIONS.PRODUCTS)
    let count = 0
    for (const row of rows) {
      await col.add({
        name: String(row['商品名称'] || '').trim(),
        category: String(row['供应商'] || '').trim(),
        type: String(row['品类'] || '').trim(),
        spec: String(row['规格'] || '').trim(),
        barcode: String(row['条形码'] || '').trim(),
        purchase_price: Number(row['进货价']) || 0,
        sale_price: Number(row['销售价']) || 0,
        is_points_product: false,
        exclude_from_sales: String(row['不计入业绩'] || '').trim() === '是',
        created_at: new Date(),
      })
      count++
    }
    await writeLog(user, '商品管理', `批量导入 ${count} 个商品`)
    await refreshCache('products')
    setLogVersion((v) => v + 1)
  }

  const handleExport = () => {
    const exportData = products.map((p) => ({ ...p, exclude_from_sales: p.exclude_from_sales ? '是' : '否' }))
    exportToExcel(exportData, PRODUCT_HEADERS, PRODUCT_KEYS, '商品管理.xlsx')
    writeLog(user, '商品管理', '导出商品目录')
    setLogVersion((v) => v + 1)
  }

  return (
    <div className="p-4">
      <div className="flex gap-4 max-w-6xl mx-auto">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="text-gray-500 hover:text-gray-700">← 返回</button>
              <h2 className="text-xl font-bold text-gray-800">商品管理</h2>
            </div>
            <div className="flex gap-2">
              {canEditSettings && (
                <>
                  {isOwner && (
                    <button onClick={openAdd}
                      className="px-3 py-1.5 bg-pink-500 text-white rounded text-sm">
                      新增
                    </button>
                  )}
                  <div className="relative" ref={moreMenuRef}>
                    <button
                      onClick={() => setShowMoreMenu(!showMoreMenu)}
                      className={`px-3 py-1.5 rounded text-sm tracking-widest ${showMoreMenu ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-700'} hover:bg-gray-200`}>
                      ⋮
                    </button>
                    {showMoreMenu && (
                      <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-20 min-w-[100px]">
                        {isOwner && (
                          <button
                            onClick={() => { setTab(tab === 'import' ? 'list' : 'import'); setShowMoreMenu(false) }}
                            className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                            {tab === 'import' ? '返回列表' : '批量导入'}
                          </button>
                        )}
                        <button
                          onClick={() => { handleExport(); setShowMoreMenu(false) }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          导出
                        </button>
                        {isOwner && (
                          <>
                            <button
                              onClick={() => { setSelectMode(true); setShowMoreMenu(false) }}
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                              删除
                            </button>
                            <button
                              onClick={() => { setSelectMode(true); setShowMoreMenu(false) }}
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                              批量编辑
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  {selectMode && (
                    <button
                      onClick={exitSelectMode}
                      className="px-3 py-1.5 rounded text-sm bg-gray-600 text-white">
                      取消
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {tab === 'import' ? (
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-medium text-gray-700 mb-3">批量导入商品</h3>
              <BatchImport
                headers={PRODUCT_HEADERS}
                validate={(row) => validateProduct(row, existingBarcodes)}
                onImport={handleBatchImport}
                templateFilename="商品导入模板.xlsx"
                context={existingBarcodes}
              />
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="条形码或商品名称…"
                  value={searchInput}
                  onChange={(e) => { setSearchInput(e.target.value); if (!e.target.value) { setSearchResults(null); setSearchError('') } }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  className="flex-1 max-w-xs border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                />
                <button onClick={() => handleSearch()}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm whitespace-nowrap">
                  搜索
                </button>
                <button onClick={() => setShowSearchScanner(true)}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm whitespace-nowrap">
                  📷 扫码
                </button>
                {searchError && <span className="text-red-500 text-sm">{searchError}</span>}
              </div>

              {selectMode && selected.size > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
                  <span className="text-gray-600 text-sm font-medium shrink-0">已选 {selected.size} 项</span>
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      type="text"
                      value={batchEdit.type}
                      onChange={(e) => setBatchEdit((b) => ({ ...b, type: e.target.value }))}
                      placeholder="品类"
                      className="w-28 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300"
                    />
                    <button onClick={handleBatchEdit}
                      className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm whitespace-nowrap">
                      应用
                    </button>
                  </div>
                  <button onClick={handleDeleteSelected} disabled={saving}
                    className="px-3 py-1 bg-red-500 disabled:bg-red-300 hover:bg-red-600 text-white rounded text-sm whitespace-nowrap">
                    {saving ? '删除中...' : '删除'}
                  </button>
                </div>
              )}

              {(() => {
                const filtered = searchResults !== null ? searchResults : products
                const allSelected = filtered.length > 0 && filtered.every((p) => selected.has(p._id))
                const toggleAll = () => {
                  if (allSelected) {
                    setSelected((prev) => { const s = new Set(prev); filtered.forEach((p) => s.delete(p._id)); return s })
                  } else {
                    setSelected((prev) => { const s = new Set(prev); filtered.forEach((p) => s.add(p._id)); return s })
                  }
                }
                return (
                  <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 text-gray-500">
                        <tr>
                          {selectMode && (
                            <th className="px-4 py-3 text-left">
                              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                            </th>
                          )}
                          <th className="px-4 py-3 text-left">商品名称</th>
                          <th className="px-4 py-3 text-left">供应商</th>
                          <th className="px-4 py-3 text-left">品类</th>
                          <th className="px-4 py-3 text-left">条形码</th>
                          <th className="px-4 py-3 text-right">销售价</th>
                          {canViewPurchasePrice && <th className="px-4 py-3 text-right">进货价</th>}
                          {isOwner && <th className="px-4 py-3 text-center">操作</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((item) => (
                          <tr
                            key={item._id}
                            className={`border-t hover:bg-gray-50 ${selectMode && selected.has(item._id) ? 'bg-red-50' : ''}`}
                            onClick={() => selectMode && setSelected(prev => {
                              const s = new Set(prev); s.has(item._id) ? s.delete(item._id) : s.add(item._id); return s
                            })}
                          >
                            {selectMode && (
                              <td className="px-4 py-3">
                                <input type="checkbox" checked={selected.has(item._id)} readOnly />
                              </td>
                            )}
                            <td className="px-4 py-3 font-medium text-gray-800">{item.name}</td>
                            <td className="px-4 py-3 text-gray-500">{item.category}</td>
                            <td className="px-4 py-3 text-gray-500">{item.type}</td>
                            <td className="px-4 py-3 text-gray-400">{item.barcode}</td>
                            <td className="px-4 py-3 text-right text-pink-600">¥{item.sale_price}</td>
                            {canViewPurchasePrice && (
                              <td className="px-4 py-3 text-right text-gray-400">¥{item.purchase_price}</td>
                            )}
                            {isOwner && (
                              <td className="px-4 py-3 text-center">
                                <button onClick={(e) => { e.stopPropagation(); openEdit(item) }}
                                  className="text-blue-500 hover:text-blue-700 text-xs">
                                  编辑
                                </button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filtered.length === 0 && (
                      <div className="text-center text-gray-400 py-16">
                        {searchResults !== null ? '没有匹配的商品' : '暂无商品，点击新增或批量导入'}
                      </div>
                    )}
                  </div>
                )
              })()}
            </>
          )}
        </div>

        {isOwner && (
          <div className="w-64 shrink-0">
            <OperationLogPanel module="商品管理" refreshTrigger={logVersion} />
          </div>
        )}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[90vh]">
            <h3 className="font-bold text-lg px-6 pt-6 pb-4 shrink-0">{editItem ? '编辑商品' : '新增商品'}</h3>
            <div className="overflow-y-auto flex-1 px-6 pb-2">
              <div className="space-y-3">
                {[
                  { key: 'name', label: '商品名称', required: true },
                  { key: 'category', label: '供应商' },
                  { key: 'type', label: '品类' },
                  { key: 'spec', label: '规格' },
                  { key: 'barcode', label: '条形码', required: true },
                  { key: 'sale_price', label: '销售价', type: 'number', required: true },
                  ...(canViewPurchasePrice ? [{ key: 'purchase_price', label: '进货价', type: 'number' }] : []),
                ].map(({ key, label, type = 'text', required }) => (
                  <div key={key}>
                    <label className="block text-sm text-gray-600 mb-1">
                      {label}{required && <span className="text-red-500">*</span>}
                    </label>
                    {key === 'barcode' && !editItem ? (
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={form.barcode}
                          onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                        />
                        <button
                          type="button"
                          onClick={() => setShowScanner(true)}
                          className="px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 whitespace-nowrap"
                        >
                          📷 商品扫码
                        </button>
                      </div>
                    ) : (
                      <input
                        type={type}
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                      />
                    )}
                  </div>
                ))}
              </div>
              {/* 不计入业绩 */}
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-600">不计入业绩</span>
                <button
                  type="button"
                  onClick={() => setForm({ ...form, exclude_from_sales: !form.exclude_from_sales })}
                  className={`w-11 h-6 rounded-full transition-colors ${form.exclude_from_sales ? 'bg-pink-500' : 'bg-gray-200'}`}
                >
                  <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${form.exclude_from_sales ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              {/* 子商品 */}
              <div className="mt-3">
                <label className="block text-sm text-gray-600 mb-1">子商品</label>
                {form.kit_components.length > 0 && (
                  <div className="flex flex-col gap-1.5 mb-2">
                    {form.kit_components.map(({ product_id, qty }) => {
                      const p = products.find((x) => x._id === product_id)
                      return (
                        <div key={product_id} className="flex items-center gap-2 px-2 py-1 bg-blue-50 rounded-lg">
                          <span className="flex-1 text-blue-700 text-xs truncate">{p?.name || product_id}</span>
                          <span className="text-gray-400 text-xs shrink-0">数量</span>
                          <input
                            type="number"
                            min="1"
                            value={qty}
                            onChange={(e) => updateComponentQty(product_id, e.target.value)}
                            onBlur={() => normalizeComponentQty(product_id)}
                            className="w-14 border border-blue-200 rounded px-1.5 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-blue-300"
                          />
                          <button type="button" onClick={() => removeComponent(product_id)} className="text-blue-300 hover:text-blue-600 text-sm leading-none shrink-0">×</button>
                        </div>
                      )
                    })}
                  </div>
                )}
                <div className="relative">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={componentSearch}
                      onChange={(e) => setComponentSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchComponents()}
                      placeholder="商品名称或条形码…"
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                    />
                    <button type="button" onClick={() => searchComponents()}
                      className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm whitespace-nowrap">
                      搜索
                    </button>
                  </div>
                  {componentResults.length > 0 && (
                    <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {componentResults.length >= 2 && (
                        <button type="button" onClick={addAllComponents}
                          className="w-full text-left px-3 py-2 text-sm border-b border-gray-100 text-blue-600 hover:bg-blue-50 font-medium flex items-center gap-2">
                          <input type="checkbox" readOnly className="pointer-events-none" />
                          全选（{componentResults.length} 个）
                        </button>
                      )}
                      {componentResults.map((p) => (
                        <button key={p._id} type="button" onClick={() => addComponent(p._id)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                          {p.name}{p.spec && <span className="text-gray-400 ml-1">{p.spec}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-6 py-4 shrink-0 border-t border-gray-100">
              <button
                type="button"
                disabled={saving}
                onClick={() => setShowForm(false)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 bg-pink-500 disabled:bg-pink-300 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateProduct && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-lg mb-2">条形码已存在</h3>
            <p className="text-sm text-gray-600 mb-1">
              该条形码已被其他商品使用，无法重复保存。
            </p>
            <p className="text-sm text-gray-800 mb-5">
              已有商品：<span className="font-medium">{duplicateProduct.product.name}</span>
              {duplicateProduct.product.barcode ? `（${duplicateProduct.product.barcode}）` : ''}
            </p>
            <button
              type="button"
              onClick={() => setDuplicateProduct(null)}
              className="w-full py-2 bg-pink-500 text-white rounded-lg text-sm"
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {showScanner && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/80">
            <span className="text-white font-medium">对准商品条形码</span>
            <button onClick={stopScanner} className="text-white text-2xl leading-none">✕</button>
          </div>
          <div className="flex-1 relative overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" />
            {scanToast && (
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-8 py-4 rounded-2xl bg-red-500/90 text-white font-bold text-xl shadow-xl">
                {scanToast.message}
              </div>
            )}
          </div>
        </div>
      )}

      {showSearchScanner && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/80">
            <span className="text-white font-medium">扫码搜索商品</span>
            <button onClick={stopSearchScanner} className="text-white text-2xl leading-none">✕</button>
          </div>
          <div className="flex-1 relative overflow-hidden">
            <video ref={searchVideoRef} className="w-full h-full object-cover" />
          </div>
        </div>
      )}
    </div>
  )
}
