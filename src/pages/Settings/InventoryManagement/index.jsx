import { useState, useEffect, useRef } from 'react'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { db } from '../../../lib/cloudbase'
import { COLLECTIONS } from '../../../lib/collections'
import { usePermission } from '../../../hooks/usePermission'
import useAuthStore from '../../../store/authStore'
import useCacheStore from '../../../store/cacheStore'
import BatchImport from '../../../components/BatchImport'
import OperationLogPanel from '../../../components/OperationLogPanel'
import { validateInventory, INVENTORY_HEADERS, INVENTORY_KEYS } from '../../../utils/validators'
import { exportToExcel } from '../../../utils/excelImport'
import { writeLog } from '../../../utils/operationLog'
import { writeNotification } from '../../../utils/notification'

const ALL_EXPORT_COLS = [
  { key: 'product_name', label: '商品名称', required: true },
  { key: 'category',     label: '供应商' },
  { key: 'type',         label: '品类' },
  { key: 'spec',         label: '规格' },
  { key: 'barcode',      label: '条形码' },
  { key: 'quantity',     label: '数量' },
  { key: 'sale_price',   label: '销售价' },
  { key: 'purchase_price', label: '进货价', ownerOnly: true },
  { key: 'expiry_date',  label: '保质期' },
  { key: 'created_at',   label: '入库时间' },
]

export default function InventoryManagement({ onBack }) {
  const { canEditSettings, isOwner, canViewPurchasePrice } = usePermission()
  const user = useAuthStore((s) => s.user)
  const { products, refreshCache } = useCacheStore()
  const [inventory, setInventory] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [selectedProductId, setSelectedProductId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [tab, setTab] = useState('list')
  const [deleteMode, setDeleteMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [logVersion, setLogVersion] = useState(0)
  const [showScanner, setShowScanner] = useState(false)
  const [scanToast, setScanToast] = useState(null)
  const [showExportModal, setShowExportModal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [exportColKeys, setExportColKeys] = useState(new Set())
  const [exportSelectMode, setExportSelectMode] = useState(false)
  const [listFilter, setListFilter] = useState('all')
  const [listFilterVal, setListFilterVal] = useState(10)
  const [productSearchInput, setProductSearchInput] = useState('')
  const [productSearchResults, setProductSearchResults] = useState(null)
  const [productSearchError, setProductSearchError] = useState('')
  const [showAddModeModal, setShowAddModeModal] = useState(false)
  const [pendingAddData, setPendingAddData] = useState(null)
  const [listSearch, setListSearch] = useState('')
  const [listSearchApplied, setListSearchApplied] = useState('')
  const [showListScanner, setShowListScanner] = useState(false)
  const scannerControlsRef = useRef(null)
  const videoRef = useRef(null)
  const lastScanTimeRef = useRef(0)
  const listScannerControlsRef = useRef(null)
  const listVideoRef = useRef(null)
  const listLastScanRef = useRef(0)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef(null)

  const stopScanner = () => {
    if (scannerControlsRef.current) {
      scannerControlsRef.current.stop()
      scannerControlsRef.current = null
    }
    setShowScanner(false)
  }

  const stopListScanner = () => {
    if (listScannerControlsRef.current) {
      listScannerControlsRef.current.stop()
      listScannerControlsRef.current = null
    }
    setShowListScanner(false)
  }

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
            const prod = products.find((p) => String(p.barcode) === barcode)
            if (prod) {
              setScanToast({ message: '扫码成功', type: 'success' })
              setSelectedProductId(prod._id)
              setTimeout(() => { setScanToast(null); stopScanner() }, 500)
            } else {
              setScanToast({ message: '没有该商品', type: 'error' })
              setTimeout(() => { setScanToast(null); stopScanner() }, 500)
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

  useEffect(() => {
    if (!showListScanner) return
    let active = true
    const start = async () => {
      try {
        const codeReader = new BrowserMultiFormatReader()
        const video = listVideoRef.current
        if (!video) return
        const controls = await codeReader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          video,
          (result) => {
            if (!active || !result) return
            const now = Date.now()
            if (now - listLastScanRef.current < 1500) return
            listLastScanRef.current = now
            const barcode = result.getText()
            setListSearch(barcode)
            setListSearchApplied(barcode)
            stopListScanner()
          }
        )
        if (active) listScannerControlsRef.current = controls
        else controls.stop()
      } catch (err) {
        if (active) {
          alert('无法启动摄像头：' + err.message)
          setShowListScanner(false)
        }
      }
    }
    start()
    return () => {
      active = false
      if (listScannerControlsRef.current) {
        listScannerControlsRef.current.stop()
        listScannerControlsRef.current = null
      }
    }
  }, [showListScanner])

  const productNameSet = new Set(products.map((p) => p.name))

  const fetchInventory = async () => {
    const res = await db.collection(COLLECTIONS.INVENTORY).orderBy('created_at', 'desc').limit(500).get()
    setInventory(res.data)
  }

  useEffect(() => { fetchInventory() }, [])

  useEffect(() => {
    if (!showMoreMenu) return
    const handleClick = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setShowMoreMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMoreMenu])

  const filteredInventory = inventory.filter((item) => {
    if (listSearchApplied.trim()) {
      const q = listSearchApplied.trim().toLowerCase()
      const category = item.category || products.find((p) => p._id === item.product_id)?.category || ''
      if (!(
        item.product_name.toLowerCase().includes(q) ||
        category.toLowerCase().includes(q) ||
        String(item.type || '').toLowerCase().includes(q) ||
        String(item.barcode || '').toLowerCase().includes(q)
      )) return false
    }
    if (listFilter === 'low_stock') return item.quantity <= listFilterVal
    if (listFilter === 'expiring') {
      if (!item.expiry_date) return false
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() + listFilterVal)
      return new Date(item.expiry_date) <= cutoff
    }
    return true
  }).slice().sort((a, b) => {
    const aLow = a.quantity <= 0
    const bLow = b.quantity <= 0
    if (aLow && !bLow) return -1
    if (!aLow && bLow) return 1
    return 0
  })

  const handleProductSearch = () => {
    const val = productSearchInput.trim()
    if (!val) return
    const byBarcode = products.find((p) => String(p.barcode) === val)
    if (byBarcode) {
      setSelectedProductId(byBarcode._id)
      setProductSearchInput('')
      setProductSearchResults(null)
      setProductSearchError('')
      return
    }
    const results = products.filter((p) =>
      p.name.toLowerCase().includes(val.toLowerCase()) ||
      String(p.barcode).includes(val)
    )
    setProductSearchResults(results)
    setProductSearchError(results.length === 0 ? '没有匹配的商品' : '')
  }

  const closeForm = () => {
    setShowForm(false)
    setProductSearchInput('')
    setProductSearchResults(null)
    setProductSearchError('')
  }

  const openAdd = () => {
    setEditItem(null)
    setSelectedProductId('')
    setQuantity('')
    setExpiryDate('')
    setProductSearchInput('')
    setProductSearchResults(null)
    setProductSearchError('')
    setShowForm(true)
  }

  const openEdit = (item) => {
    if (!canEditSettings) return
    setEditItem(item)
    setSelectedProductId(item.product_id)
    setQuantity(item.quantity)
    setExpiryDate(item.expiry_date || '')
    setShowForm(true)
  }

  const handleSave = async () => {
    const product = products.find((p) => p._id === selectedProductId)
    if (!product || !quantity) {
      alert('请选择商品并填写数量')
      return
    }
    setSaving(true)
    try {
    const data = {
      product_id: product._id,
      product_name: product.name,
      category: product.category || '',
      type: product.type || '',
      spec: product.spec || '',
      barcode: product.barcode || '',
      sale_price: product.sale_price,
      purchase_price: product.purchase_price || 0,
      quantity: Number(quantity),
      expiry_date: expiryDate,
    }
    if (editItem) {
      await db.collection(COLLECTIONS.INVENTORY).doc(editItem._id).update({
        quantity: Number(quantity),
        expiry_date: expiryDate,
      })
      const invChanges = []
      if (editItem.quantity !== Number(quantity))
        invChanges.push(`数量由「${editItem.quantity}」改成「${Number(quantity)}」`)
      if (String(editItem.expiry_date ?? '') !== String(expiryDate ?? ''))
        invChanges.push(`保质期由「${editItem.expiry_date ?? ''}」改成「${expiryDate ?? ''}」`)
      if (invChanges.length > 0)
        await writeLog(user, '库存管理', `将「${product.name}」的${invChanges.join('、')}`)
      await fetchInventory()
      closeForm()
      setLogVersion((v) => v + 1)
    } else {
      const existing = inventory.find((item) => item.product_id === product._id)
      if (existing) {
        setPendingAddData({ data, product, existing })
        setShowAddModeModal(true)
        return
      }
      await db.collection(COLLECTIONS.INVENTORY).add({ ...data, created_at: new Date() })
      await writeLog(user, '库存管理', `新增「${product.name}」入库，数量 ${Number(quantity)}`)
      writeNotification(`新增「${product.name}」入库，数量 ${Number(quantity)}`)
      await fetchInventory()
      closeForm()
      setLogVersion((v) => v + 1)
    }
    } catch (err) { alert('操作失败：' + err.message) } finally { setSaving(false) }
  }

  const handleConfirmAddMode = async (mode) => {
    const { data, product, existing } = pendingAddData
    setShowAddModeModal(false)
    setPendingAddData(null)
    setSaving(true)
    try {
    if (mode === 'append') {
      const newQty = existing.quantity + data.quantity
      await db.collection(COLLECTIONS.INVENTORY).doc(existing._id).update({
        quantity: newQty,
        expiry_date: data.expiry_date || existing.expiry_date,
      })
      await writeLog(user, '库存管理', `追加「${product.name}」库存，${existing.quantity} → ${newQty}`)
      writeNotification(`追加「${product.name}」库存，${existing.quantity} → ${newQty}`)
    } else {
      await db.collection(COLLECTIONS.INVENTORY).add({ ...data, created_at: new Date() })
      await writeLog(user, '库存管理', `新批次入库「${product.name}」，数量 ${data.quantity}`)
      writeNotification(`新批次入库「${product.name}」，数量 ${data.quantity}`)
    }
    await fetchInventory()
    closeForm()
    setLogVersion((v) => v + 1)
    } catch (err) { alert('操作失败：' + err.message) } finally { setSaving(false) }
  }

  const handleDeleteSelected = async () => {
    if (!window.confirm(`确认删除选中的 ${selected.size} 条库存记录？`)) return
    setSaving(true)
    try {
    for (const id of selected) {
      await db.collection(COLLECTIONS.INVENTORY).doc(id).remove()
    }
    await writeLog(user, '库存管理', `删除 ${selected.size} 条库存记录`)
    await fetchInventory()
    setDeleteMode(false)
    setSelected(new Set())
    setLogVersion((v) => v + 1)
    } catch (err) { alert('删除失败：' + err.message) } finally { setSaving(false) }
  }

  const handleBatchImport = async (rows) => {
    const col = db.collection(COLLECTIONS.INVENTORY)
    let count = 0
    for (const row of rows) {
      const productName = String(row['商品名称'] || '').trim()
      const product = products.find((p) => p.name === productName)
      if (!product) continue
      await col.add({
        product_id: product._id,
        product_name: product.name,
        category: product.category || '',
        type: product.type || '',
        spec: product.spec || '',
        barcode: product.barcode || '',
        sale_price: product.sale_price,
        purchase_price: product.purchase_price || 0,
        quantity: Number(row['数量']) || 0,
        expiry_date: String(row['保质期'] || '').trim(),
        created_at: new Date(),
      })
      count++
    }
    await writeLog(user, '库存管理', `批量导入 ${count} 条库存`)
    await fetchInventory()
    setLogVersion((v) => v + 1)
  }

  const openExportModal = () => {
    setExportColKeys(new Set(ALL_EXPORT_COLS.filter(c => !c.ownerOnly || isOwner).map(c => c.key)))
    setShowExportModal(true)
  }

  const handleExportConfirm = () => {
    const data = inventory.filter(item => selected.has(item._id))
    const cols = ALL_EXPORT_COLS.filter(c => (!c.ownerOnly || isOwner) && exportColKeys.has(c.key))
    const enriched = data.map(item => ({
      ...item,
      category: item.category || products.find(p => p._id === item.product_id)?.category || '',
    }))
    exportToExcel(enriched, cols.map(c => c.label), cols.map(c => c.key), `库存管理_已选${data.length}条.xlsx`)
    writeLog(user, '库存管理', `导出库存（已选${data.length}条）`)
    setLogVersion((v) => v + 1)
    setShowExportModal(false)
    setExportSelectMode(false)
    setSelected(new Set())
  }

  return (
    <div className="p-4">
      <div className="flex gap-4 max-w-6xl mx-auto">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={onBack} className="text-gray-500 hover:text-gray-700">← 返回</button>
              <h2 className="text-xl font-bold text-gray-800">库存管理</h2>
            </div>
            <div className="flex gap-2">
              {isOwner && (
                <button onClick={openAdd}
                  className="px-3 py-1.5 bg-pink-500 text-white rounded text-sm">
                  入库
                </button>
              )}
              {canEditSettings && (
                <button
                  onClick={() => { setExportSelectMode(!exportSelectMode); setSelected(new Set()); if (deleteMode) setDeleteMode(false) }}
                  className={`px-3 py-1.5 rounded text-sm ${exportSelectMode ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white'}`}>
                  导出
                </button>
              )}
              {isOwner && (
                <div className="relative" ref={moreMenuRef}>
                  <button
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                    className={`px-3 py-1.5 rounded text-sm tracking-widest ${showMoreMenu ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 text-gray-700'} hover:bg-gray-200`}>
                    ⋮
                  </button>
                  {showMoreMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-100 py-1 z-20 min-w-[100px]">
                      <button
                        onClick={() => { setTab(tab === 'import' ? 'list' : 'import'); setShowMoreMenu(false) }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        {tab === 'import' ? '返回列表' : '批量导入'}
                      </button>
                      <button
                        onClick={() => { setDeleteMode(!deleteMode); setSelected(new Set()); if (exportSelectMode) setExportSelectMode(false); setShowMoreMenu(false) }}
                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-50 ${deleteMode ? 'text-red-600' : 'text-gray-700'}`}>
                        {deleteMode ? '退出删除' : '删除'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {tab === 'import' ? (
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <BatchImport
                headers={INVENTORY_HEADERS}
                validate={(row) => validateInventory(row, productNameSet)}
                onImport={handleBatchImport}
                templateFilename="库存导入模板.xlsx"
              />
            </div>
          ) : (
            <>
              {exportSelectMode && (
                <div className="mb-3 flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex-wrap">
                  <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filteredInventory.length > 0 && filteredInventory.every(item => selected.has(item._id))}
                      onChange={() => {
                        const allIds = filteredInventory.map(item => item._id)
                        const allSelected = allIds.every(id => selected.has(id))
                        setSelected(prev => {
                          const s = new Set(prev)
                          allSelected ? allIds.forEach(id => s.delete(id)) : allIds.forEach(id => s.add(id))
                          return s
                        })
                      }}
                    />
                    {listSearchApplied || listFilter !== 'all' ? '全选筛选结果' : '全选'}
                  </label>
                  <span className="text-blue-600 text-sm">已选 {selected.size} 项</span>
                  {selected.size > 0 && (
                    <button onClick={openExportModal}
                      className="px-3 py-1 bg-blue-500 text-white rounded text-sm">
                      导出选中
                    </button>
                  )}
                </div>
              )}

              {deleteMode && selected.size > 0 && (
                <div className="mb-3 flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 flex-wrap">
                  <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={filteredInventory.length > 0 && filteredInventory.every(item => selected.has(item._id))}
                      onChange={() => {
                        const allIds = filteredInventory.map(item => item._id)
                        const allSelected = allIds.every(id => selected.has(id))
                        setSelected(prev => {
                          const s = new Set(prev)
                          allSelected ? allIds.forEach(id => s.delete(id)) : allIds.forEach(id => s.add(id))
                          return s
                        })
                      }}
                    />
                    {listSearchApplied ? '全选筛选结果' : '全选'}
                  </label>
                  <span className="text-red-600 text-sm">已选 {selected.size} 项</span>
                  <button onClick={handleDeleteSelected} disabled={saving}
                    className="px-3 py-1 bg-red-500 disabled:bg-red-300 text-white rounded text-sm">
                    {saving ? '删除中...' : '确认删除'}
                  </button>
                </div>
              )}

              <div className="mb-2 flex items-center gap-2 flex-wrap">
                {[
                  { value: 'low_stock', label: '低库存', defaultVal: 10, suffix: '件' },
                  { value: 'expiring', label: '临期', defaultVal: 30, suffix: '天内到期' },
                ].map(f => (
                  <div key={f.value} className="flex items-center gap-1">
                    <button
                      onClick={() => { setListFilter(listFilter === f.value ? 'all' : f.value); setListFilterVal(f.defaultVal) }}
                      className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${listFilter === f.value ? (f.value === 'low_stock' ? 'bg-red-100 border-red-300 text-red-700' : 'bg-orange-100 border-orange-300 text-orange-700') : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'}`}>
                      {f.label}
                    </button>
                    {listFilter === f.value && (
                      <div className="flex items-center gap-1 text-sm text-gray-500">
                        ≤
                        <input type="number" min={1} value={listFilterVal}
                          onChange={e => setListFilterVal(Number(e.target.value))}
                          className="w-12 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-300" />
                        {f.suffix}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="mb-3 flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={listSearch}
                    onChange={(e) => setListSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && setListSearchApplied(listSearch)}
                    placeholder="商品名称 / 供应商 / 品类 / 条码"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-pink-200"
                  />
                  {listSearch && (
                    <button
                      onClick={() => { setListSearch(''); setListSearchApplied('') }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-base leading-none">
                      ✕
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setListSearchApplied(listSearch)}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg whitespace-nowrap">
                  搜索
                </button>
                <button
                  onClick={() => setShowListScanner(true)}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg">
                  📷
                </button>
              </div>

              <div className="bg-white rounded-xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      {(deleteMode || exportSelectMode) && <th className="px-4 py-3 text-left"></th>}
                      <th className="px-4 py-3 text-left">商品名称</th>
                      <th className="px-4 py-3 text-left">供应商</th>
                      <th className="px-4 py-3 text-left">品类</th>
                      <th className="px-4 py-3 text-left">规格</th>
                      <th className="px-4 py-3 text-left">条形码</th>
                      <th className="px-4 py-3 text-right">数量</th>
                      <th className="px-4 py-3 text-right">销售价</th>
                      {canViewPurchasePrice && <th className="px-4 py-3 text-right">进货价</th>}
                      <th className="px-4 py-3 text-left">保质期</th>
                      {isOwner && <th className="px-4 py-3 text-center">操作</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInventory.map((item) => (
                      <tr
                        key={item._id}
                        className={`border-t hover:bg-gray-50 ${(deleteMode || exportSelectMode) && selected.has(item._id) ? (deleteMode ? 'bg-red-50' : 'bg-blue-50') : item.quantity < 0 ? 'bg-red-50' : ''}`}
                        onClick={() => (deleteMode || exportSelectMode) && setSelected(prev => {
                          const s = new Set(prev); s.has(item._id) ? s.delete(item._id) : s.add(item._id); return s
                        })}
                      >
                        {(deleteMode || exportSelectMode) && (
                          <td className="px-4 py-3">
                            <input type="checkbox" checked={selected.has(item._id)} readOnly />
                          </td>
                        )}
                        <td className="px-4 py-3 font-medium text-gray-800">{item.product_name}</td>
                        <td className="px-4 py-3 text-gray-500">{item.category || products.find(p => p._id === item.product_id)?.category || ''}</td>
                        <td className="px-4 py-3 text-gray-500">{item.type || products.find(p => p._id === item.product_id)?.type || ''}</td>
                        <td className="px-4 py-3 text-gray-500">{item.spec}</td>
                        <td className="px-4 py-3 text-gray-400">{item.barcode}</td>
                        <td className={`px-4 py-3 text-right font-medium ${item.quantity < 0 ? 'text-red-600' : ''}`}>
                          {item.quantity < 0 ? `欠 ${Math.abs(item.quantity)} 件` : item.quantity}
                        </td>
                        <td className="px-4 py-3 text-right text-pink-600">¥{item.sale_price}</td>
                        {canViewPurchasePrice && (
                          <td className="px-4 py-3 text-right text-gray-400">¥{item.purchase_price}</td>
                        )}
                        <td className="px-4 py-3 text-gray-500">{item.expiry_date}</td>
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
                {filteredInventory.length === 0 && (
                  <div className="text-center text-gray-400 py-16">
                    {listSearchApplied ? '没有匹配的商品' : '暂无库存记录'}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {isOwner && (
          <div className="w-64 shrink-0">
            <OperationLogPanel module="库存管理" refreshTrigger={logVersion} />
          </div>
        )}
      </div>

      {showExportModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-lg mb-1">导出配置</h3>
            <p className="text-sm text-gray-400 mb-5">将导出已选中的 {selected.size} 条记录</p>

            <div className="mb-6">
              <p className="text-sm font-medium text-gray-700 mb-2">选择导出列</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {ALL_EXPORT_COLS.filter(c => !c.ownerOnly || isOwner).map(col => (
                  <label key={col.key} className={`flex items-center gap-2 text-sm ${col.required ? 'text-gray-400' : 'text-gray-700 cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={exportColKeys.has(col.key)}
                      disabled={col.required}
                      onChange={() => {
                        setExportColKeys(prev => {
                          const s = new Set(prev)
                          s.has(col.key) ? s.delete(col.key) : s.add(col.key)
                          return s
                        })
                      }}
                    />
                    {col.label}{col.required && <span className="text-xs text-gray-400">（必选）</span>}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setShowExportModal(false)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm">
                取消
              </button>
              <button onClick={handleExportConfirm}
                className="flex-1 py-2 bg-pink-500 text-white rounded-lg text-sm">
                确认导出
              </button>
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="font-bold text-lg mb-4">{editItem ? '编辑库存' : '入库'}</h3>
            <div className="space-y-3">
              <div>
                {editItem ? (
                  <>
                    <label className="block text-sm text-gray-600 mb-1">商品</label>
                    <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700">
                      {products.find((p) => p._id === selectedProductId)?.name || ''}
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block text-sm text-gray-600 mb-1">商品<span className="text-red-500">*</span></label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={productSearchInput}
                        onChange={(e) => {
                          setProductSearchInput(e.target.value)
                          if (!e.target.value) { setProductSearchResults(null); setProductSearchError('') }
                        }}
                        onKeyDown={(e) => e.key === 'Enter' && handleProductSearch()}
                        placeholder="商品名称或条形码"
                        className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                      />
                      <button type="button" onClick={handleProductSearch}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg whitespace-nowrap">
                        搜索
                      </button>
                      <button type="button" onClick={() => setShowScanner(true)}
                        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg">
                        📷
                      </button>
                    </div>
                    {productSearchError && <div className="text-red-500 text-xs mt-1">{productSearchError}</div>}
                    {productSearchResults !== null && productSearchResults.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2 max-h-28 overflow-y-auto">
                        {productSearchResults.map((p) => (
                          <button key={p._id} type="button"
                            onClick={() => {
                              setSelectedProductId(p._id)
                              setProductSearchInput('')
                              setProductSearchResults(null)
                              setProductSearchError('')
                            }}
                            className="px-2 py-1 text-xs bg-pink-50 border border-pink-200 text-pink-700 rounded-lg hover:bg-pink-100 whitespace-nowrap">
                            {p.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {selectedProductId && (
                      <div className="mt-1.5 px-3 py-2 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 flex items-center justify-between">
                        <span>{products.find((p) => p._id === selectedProductId)?.name}</span>
                        <button type="button" onClick={() => setSelectedProductId('')}
                          className="text-green-600 hover:text-green-800 ml-2 text-xs">✕</button>
                      </div>
                    )}
                  </>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">数量<span className="text-red-500">*</span></label>
                <input type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">保质期</label>
                <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={closeForm}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm">
                取消
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2 bg-pink-500 disabled:bg-pink-300 text-white rounded-lg text-sm">
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddModeModal && pendingAddData && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-lg mb-1">该商品已有库存</h3>
            <p className="text-sm text-gray-500 mb-4">
              {pendingAddData.product.name} · 当前 {pendingAddData.existing.quantity} 件
              {pendingAddData.existing.expiry_date && `，保质期至 ${pendingAddData.existing.expiry_date}`}
            </p>
            <div className="space-y-3">
              <button onClick={() => handleConfirmAddMode('append')}
                className="w-full py-3 px-4 bg-pink-500 text-white rounded-xl text-left">
                <div className="text-sm font-medium">追加到已有库存</div>
                <div className="text-xs text-pink-100 mt-0.5">
                  {pendingAddData.existing.quantity} + {pendingAddData.data.quantity} = {pendingAddData.existing.quantity + pendingAddData.data.quantity} 件
                  {pendingAddData.data.expiry_date && pendingAddData.data.expiry_date !== pendingAddData.existing.expiry_date && (
                    <span>，保质期更新为 {pendingAddData.data.expiry_date}</span>
                  )}
                </div>
              </button>
              <button onClick={() => handleConfirmAddMode('new_batch')}
                className="w-full py-3 px-4 bg-gray-100 text-gray-700 rounded-xl text-left">
                <div className="text-sm font-medium">按新批次入库</div>
                <div className="text-xs text-gray-400 mt-0.5">生成独立记录，适合保质期不同的批次</div>
              </button>
            </div>
            <button onClick={() => { setShowAddModeModal(false); setPendingAddData(null) }}
              className="w-full mt-3 py-2 text-gray-400 text-sm">
              取消
            </button>
          </div>
        </div>
      )}

      {showListScanner && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/80">
            <span className="text-white font-medium">扫码搜索商品</span>
            <button onClick={stopListScanner} className="text-white text-2xl leading-none">✕</button>
          </div>
          <div className="flex-1 relative overflow-hidden">
            <video ref={listVideoRef} className="w-full h-full object-cover" />
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
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-8 py-4 rounded-2xl text-white font-bold text-xl shadow-xl ${
                scanToast.type === 'success' ? 'bg-green-500/90' : 'bg-red-500/90'
              }`}>
                {scanToast.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
