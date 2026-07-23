import { useState, useMemo, useEffect, useRef } from 'react'
import { db, _ } from '../../../lib/cloudbase'
import { COLLECTIONS } from '../../../lib/collections'
import { usePermission } from '../../../hooks/usePermission'
import useCacheStore from '../../../store/cacheStore'
import BatchImport from '../../../components/BatchImport'
import {
  validateProject,
  PROJECT_HEADERS,
  PROJECT_KEYS,
} from '../../../utils/validators'
import { exportToExcel } from '../../../utils/excelImport'
import { toArray } from '../../../utils/array'
import { getCategoryTemplates } from '../../../utils/categories'

const EMPTY_FORM = {
  name: '', category: '', duration_min: '', total_sessions: '',
  max_sessions: '', price: '', promo_price: '', efficacy: '',
  related_products: [],
}

export default function ProjectManagement({ onBack }) {
  const { canEditProjects: canEdit } = usePermission()
  const { projects, products, refreshCache, patchProject, getSetting } = useCacheStore()
  const allowOverCheckout = getSetting('allow_over_checkout', true)
  const [showForm, setShowForm] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleteMode, setDeleteMode] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [tab, setTab] = useState('list')
  const [saving, setSaving] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef(null)
  const [showAddCat, setShowAddCat] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [showCatManager, setShowCatManager] = useState(false)
  const [renamingCat, setRenamingCat] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const categoryTemplates = getCategoryTemplates(getSetting('project_categories', null), projects)

  // 通用：按 key upsert 一条 setting
  const upsertSetting = async (key, value) => {
    const res = await db.collection(COLLECTIONS.SETTINGS).where({ key }).get()
    if (res.data.length > 0) {
      await db.collection(COLLECTIONS.SETTINGS).doc(res.data[0]._id).update({ value })
    } else {
      await db.collection(COLLECTIONS.SETTINGS).add({ key, value })
    }
  }

  // 地图等级规则里替换/移除某大类
  const mapLevelsAfterCat = (oldName, newName /* null=删除 */) => {
    const levels = getSetting('project_map_levels', null)
    if (!Array.isArray(levels)) return null
    const apply = (arr) => {
      const out = []
      for (const c of arr || []) {
        if (c !== oldName) out.push(c)
        else if (newName) out.push(newName)
      }
      return out
    }
    return levels.map((lv) => {
      const rule = lv.rule || {}
      return {
        ...lv,
        rule: {
          ...rule,
          ...(rule.cats ? { cats: apply(rule.cats) } : {}),
          ...(rule.excludeOther ? { excludeOther: apply(rule.excludeOther) } : {}),
        },
      }
    })
  }

  const openCatManager = async () => {
    // 首次：把并集落地为权威模版列表
    const setting = getSetting('project_categories', null)
    if (!Array.isArray(setting) || setting.length === 0) {
      await upsertSetting('project_categories', categoryTemplates)
      await refreshCache('settings')
    }
    setRenamingCat(null); setRenameValue('')
    setShowCatManager(true)
  }

  const handleRenameCategory = async (oldName) => {
    const name = renameValue.trim()
    if (!name) { alert('请填写新名称'); return }
    if (name === oldName) { setRenamingCat(null); return }
    if (categoryTemplates.includes(name)) { alert('该大类名已存在'); return }
    setSaving(true)
    try {
      // 1. 级联改项目
      for (const p of projects.filter((p) => p.category === oldName)) {
        await db.collection(COLLECTIONS.PROJECTS).doc(p._id).update({ category: name })
      }
      // 2. 改地图等级规则
      const nextLevels = mapLevelsAfterCat(oldName, name)
      if (nextLevels) await upsertSetting('project_map_levels', nextLevels)
      // 3. 改模版列表
      await upsertSetting('project_categories', categoryTemplates.map((c) => (c === oldName ? name : c)))
      await refreshCache('settings')
      await refreshCache('projects')
      setRenamingCat(null); setRenameValue('')
    } catch (err) { alert('重命名失败：' + err.message) } finally { setSaving(false) }
  }

  const handleDeleteCategory = async (name) => {
    const used = projects.filter((p) => p.category === name)
    if (used.length > 0) { alert(`该大类下有 ${used.length} 个项目，无法删除，请先改类或删除这些项目`); return }
    if (!window.confirm(`确认删除大类「${name}」？`)) return
    setSaving(true)
    try {
      await upsertSetting('project_categories', categoryTemplates.filter((c) => c !== name))
      const nextLevels = mapLevelsAfterCat(name, null)
      if (nextLevels) await upsertSetting('project_map_levels', nextLevels)
      await refreshCache('settings')
    } catch (err) { alert('删除失败：' + err.message) } finally { setSaving(false) }
  }

  const handleAddCategory = async () => {
    const name = newCatName.trim()
    if (!name) { alert('请填写大类名称'); return }
    if (categoryTemplates.includes(name)) { alert('该大类已存在'); return }
    const next = [...categoryTemplates, name]
    const res = await db.collection(COLLECTIONS.SETTINGS).where({ key: 'project_categories' }).get()
    if (res.data.length > 0) {
      await db.collection(COLLECTIONS.SETTINGS).doc(res.data[0]._id).update({ value: next })
    } else {
      await db.collection(COLLECTIONS.SETTINGS).add({ key: 'project_categories', value: next })
    }
    await refreshCache('settings')
    setForm((prev) => ({ ...prev, category: name }))
    setNewCatName('')
    setShowAddCat(false)
  }

  useEffect(() => {
    if (!showMoreMenu) return
    const handleClick = (e) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target)) setShowMoreMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMoreMenu])

  const productCategories = useMemo(() =>
    [...new Set(products.map((p) => p.category).filter(Boolean))].sort()
  , [products])

  const productSearchResults = useMemo(() => {
    if (!categoryFilter && !productSearch.trim()) return null
    return products.filter((p) => {
      const matchesCategory = !categoryFilter || p.category === categoryFilter
      const val = productSearch.trim()
      const matchesText = !val || p.name.toLowerCase().includes(val.toLowerCase()) || String(p.barcode).includes(val)
      return matchesCategory && matchesText
    })
  }, [categoryFilter, productSearch, products])

  const clearProductSearch = () => { setProductSearch(''); setCategoryFilter('') }
  const handleProductSearch = () => {}

  const resetAddCat = () => { setShowAddCat(false); setNewCatName('') }
  const openAdd = () => { setEditItem(null); setForm(EMPTY_FORM); clearProductSearch(); resetAddCat(); setShowForm(true) }
  const openEdit = (item) => {
    if (!canEdit) return
    clearProductSearch()
    resetAddCat()
    setEditItem(item)
    setForm({
      name: item.name || '',
      category: item.category || '',
      duration_min: item.duration_min ?? '',
      total_sessions: item.total_sessions ?? '',
      max_sessions: item.max_sessions ?? '',
      price: item.price ?? '',
      promo_price: item.promo_price ?? '',
      efficacy: item.efficacy || '',
      related_products: toArray(item.related_products),
    })
    setShowForm(true)
  }

  const toggleProduct = (productId) => {
    setForm((prev) => {
      const arr = prev.related_products.includes(productId)
        ? prev.related_products.filter((id) => id !== productId)
        : [...prev.related_products, productId]
      return { ...prev, related_products: arr }
    })
  }

  const handleSave = async () => {
    const total = Number(form.total_sessions)
    // 关闭超核销时，最多手工次数隐藏并自动等于规定次数
    const max = allowOverCheckout ? Number(form.max_sessions) : total
    if (!form.name || !form.category || !total || (allowOverCheckout && !max)) {
      alert(allowOverCheckout ? '项目名称、大类、规定次数、最多手工次数为必填项' : '项目名称、大类、规定次数为必填项')
      return
    }
    if (allowOverCheckout && max < total) {
      alert('最多手工次数必须 >= 规定次数')
      return
    }
    const duplicate = projects.find(
      (p) => p.name === form.name.trim() && p._id !== (editItem?._id ?? '')
    )
    if (duplicate) {
      alert(`项目名称「${form.name}」已存在，请使用不同的名称`)
      return
    }
    setSaving(true)
    try {
    const data = {
      name: form.name,
      category: form.category,
      duration_min: Number(form.duration_min) || 0,
      total_sessions: total,
      max_sessions: max,
      price: Number(form.price) || 0,
      promo_price: form.promo_price !== '' ? Number(form.promo_price) : null,
      efficacy: form.efficacy,
      related_products: _.set(form.related_products),
    }
    if (editItem) {
      if (form.name.trim() !== editItem.name) {
        const confirmed = window.confirm(
          `项目名称从「${editItem.name}」改为「${form.name.trim()}」后，已有会员的历史项目记录不会自动更新，仍显示旧名称。确认修改？`
        )
        if (!confirmed) return
      }
      const { related_products, ...rest } = data
      // 先删除再写入，避免 CloudBase 对象格式数组深合并导致更新失败
      await db.collection(COLLECTIONS.PROJECTS).doc(editItem._id).update({
        ...rest,
        related_products: _.remove(),
      })
      await db.collection(COLLECTIONS.PROJECTS).doc(editItem._id).update({
        related_products: form.related_products,
      })
      patchProject(editItem._id, { ...rest, related_products: form.related_products })
    } else {
      await db.collection(COLLECTIONS.PROJECTS).add({
        ...data,
        related_products: form.related_products,
        created_at: new Date(),
      })
      await refreshCache('projects')
    }
    setShowForm(false)
    refreshCache('projects')
    } catch (err) { alert('保存失败：' + err.message) } finally { setSaving(false) }
  }

  const handleDeleteSelected = async () => {
    if (!window.confirm(`确认删除选中的 ${selected.size} 个项目？`)) return
    setSaving(true)
    try {

    const blocked = []
    for (const id of selected) {
      const proj = projects.find((p) => p._id === id)
      if (!proj) continue
      const res = await db.collection(COLLECTIONS.MEMBER_PROJECTS)
        .where({ project_name: proj.name, remaining_sessions: _.gt(0) })
        .limit(1)
        .get()
      if (res.data.length > 0) blocked.push(proj.name)
    }

    if (blocked.length > 0) {
      alert(`以下项目仍有会员在使用，无法删除：\n${blocked.join('、')}`)
      setSaving(false)
      return
    }

    for (const id of selected) {
      await db.collection(COLLECTIONS.PROJECTS).doc(id).remove()
    }
    await refreshCache('projects')
    setDeleteMode(false)
    setSelected(new Set())
    } catch (err) { alert('删除失败：' + err.message) } finally { setSaving(false) }
  }

  const handleBatchImport = async (rows) => {
    const col = db.collection(COLLECTIONS.PROJECTS)
    for (const row of rows) {
      const total = Number(row['规定次数'])
      const max = Number(row['最多手工次数'])
      await col.add({
        name: String(row['项目名称'] || '').trim(),
        category: String(row['大类'] || '').trim(),
        duration_min: Number(row['单次时长(分钟)']) || 0,
        total_sessions: total,
        max_sessions: max,
        price: Number(row['销售价']) || 0,
        promo_price: row['促销价'] !== '' ? Number(row['促销价']) : null,
        efficacy: String(row['功效描述'] || '').trim(),
        related_products: [],
        created_at: new Date(),
      })
    }
    await refreshCache('projects')
  }

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-gray-500 hover:text-gray-700">← 返回</button>
          <h2 className="text-xl font-bold text-gray-800">项目管理</h2>
        </div>
        <div className="flex gap-2">
          {canEdit && (
            <>
              <button onClick={openAdd}
                className="px-3 py-1.5 bg-pink-500 text-white rounded text-sm">
                新增
              </button>
              <button
                onClick={() => { setDeleteMode(!deleteMode); setSelected(new Set()) }}
                className={`px-3 py-1.5 rounded text-sm ${deleteMode ? 'bg-red-500 text-white' : 'bg-gray-100 text-gray-700'}`}>
                删除
              </button>
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
                      onClick={() => { exportToExcel(projects, PROJECT_HEADERS, PROJECT_KEYS, '项目管理.xlsx'); setShowMoreMenu(false) }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                      导出
                    </button>
                    {canEdit && (
                      <button
                        onClick={() => { openCatManager(); setShowMoreMenu(false) }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                        大类管理
                      </button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {tab === 'import' ? (
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <BatchImport
            headers={PROJECT_HEADERS}
            validate={validateProject}
            onImport={handleBatchImport}
            templateFilename="项目导入模板.xlsx"
          />
        </div>
      ) : (
        <>
          {deleteMode && selected.size > 0 && (
            <div className="mb-3 flex items-center gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
              <span className="text-red-600 text-sm">已选 {selected.size} 项</span>
              <button onClick={handleDeleteSelected} disabled={saving}
                className="px-3 py-1 bg-red-500 disabled:bg-red-300 text-white rounded text-sm">
                {saving ? '删除中...' : '确认删除'}
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {projects.map((item) => (
              <div
                key={item._id}
                onClick={() => deleteMode
                  ? setSelected(prev => { const s = new Set(prev); s.has(item._id) ? s.delete(item._id) : s.add(item._id); return s })
                  : openEdit(item)
                }
                className={`bg-white rounded-xl p-4 shadow-sm cursor-pointer hover:shadow-md transition-shadow border-2 ${
                  deleteMode && selected.has(item._id) ? 'border-red-400' : 'border-transparent'
                }`}
              >
                {deleteMode && <input type="checkbox" checked={selected.has(item._id)} readOnly className="mb-2" />}
                <div className="font-semibold text-gray-800">{item.name}</div>
                <div className="text-gray-400 text-xs mt-1">{item.category}</div>
                <div className="text-gray-500 text-xs mt-1">
                  {item.total_sessions}次 · 最多{item.max_sessions}次 · {item.duration_min}分钟
                </div>
                <div className="mt-2 text-pink-600 font-medium">¥{item.price}</div>
              </div>
            ))}
          </div>
          {projects.length === 0 && (
            <div className="text-center text-gray-400 py-16">暂无项目，点击新增或批量导入</div>
          )}
        </>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-4">{editItem ? '编辑项目' : '新增项目'}</h3>
            <div className="space-y-3">
              {[{ key: 'name', label: '项目名称', required: true }].map(({ key, label, type = 'text', required }) => (
                <div key={key}>
                  <label className="block text-sm text-gray-600 mb-1">
                    {label}{required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                  />
                </div>
              ))}

              {/* 大类：从模版下拉选择 + 新增 */}
              <div>
                <label className="block text-sm text-gray-600 mb-1">大类<span className="text-red-500">*</span></label>
                <div className="flex gap-2">
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300 bg-white"
                  >
                    <option value="">请选择大类</option>
                    {categoryTemplates.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setShowAddCat((v) => !v)}
                    title="新增大类"
                    className="w-10 shrink-0 rounded-lg bg-pink-50 border border-pink-200 text-pink-500 text-xl leading-none hover:bg-pink-100"
                  >+</button>
                </div>
                {showAddCat && (
                  <div className="flex gap-2 mt-2">
                    <input
                      type="text"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
                      placeholder="新大类名称"
                      autoFocus
                      className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                    />
                    <button type="button" onClick={handleAddCategory}
                      className="px-3 rounded-lg bg-pink-500 text-white text-sm">确定</button>
                    <button type="button" onClick={() => { setShowAddCat(false); setNewCatName('') }}
                      className="px-3 rounded-lg border border-gray-300 text-gray-500 text-sm">取消</button>
                  </div>
                )}
              </div>

              {[
                { key: 'duration_min', label: '单次时长（分钟）', type: 'number' },
                { key: 'total_sessions', label: '规定次数', type: 'number', required: true },
                ...(allowOverCheckout ? [{ key: 'max_sessions', label: '最多手工次数', type: 'number', required: true }] : []),
                { key: 'price', label: '销售价', type: 'number' },
                { key: 'promo_price', label: '促销价' },
                { key: 'efficacy', label: '功效描述' },
              ].map(({ key, label, type = 'text', required }) => (
                <div key={key}>
                  <label className="block text-sm text-gray-600 mb-1">
                    {label}{required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={type}
                    value={form[key]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-pink-300"
                  />
                </div>
              ))}

              {/* 关联商品 */}
              <div>
                <label className="block text-sm text-gray-600 mb-1">关联商品</label>
                {form.related_products.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {form.related_products.map((id) => {
                      const p = products.find((p) => p._id === id)
                      if (!p) return null
                      return (
                        <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                          {p.name}
                          <button type="button" onClick={() => toggleProduct(id)} className="hover:text-green-900">✕</button>
                        </span>
                      )
                    })}
                  </div>
                )}
                <div className="flex gap-2 mb-2">
                  <select
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none text-gray-600"
                  >
                    <option value="">全部分类</option>
                    {productCategories.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    placeholder="商品名称或条形码"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleProductSearch()}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                  <button type="button" onClick={handleProductSearch}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg whitespace-nowrap">
                    搜索
                  </button>
                  {(productSearch || categoryFilter) && (
                    <button type="button" onClick={clearProductSearch}
                      className="px-2 text-gray-400 hover:text-gray-600 text-sm">✕</button>
                  )}
                </div>
                {productSearchResults !== null && (
                  <div className="mt-1 max-h-40 overflow-y-auto">
                    {productSearchResults.length === 0 ? (
                      <span className="text-gray-400 text-xs">没有匹配的商品</span>
                    ) : (
                      <>
                        <label className="flex items-center gap-1.5 mb-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={productSearchResults.every((p) => form.related_products.includes(p._id))}
                            onChange={(e) => {
                              const ids = productSearchResults.map((p) => p._id)
                              setForm((prev) => ({
                                ...prev,
                                related_products: e.target.checked
                                  ? [...new Set([...prev.related_products, ...ids])]
                                  : prev.related_products.filter((id) => !ids.includes(id)),
                              }))
                            }}
                          />
                          <span className="text-xs text-gray-500">全选</span>
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {productSearchResults.map((p) => (
                            <button key={p._id} type="button" onClick={() => toggleProduct(p._id)}
                              className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                                form.related_products.includes(p._id)
                                  ? 'bg-green-500 text-white border-green-500'
                                  : 'bg-white text-gray-600 border-gray-300'
                              }`}>
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowForm(false); clearProductSearch() }}
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

      {/* 大类管理 */}
      {showCatManager && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg">大类管理</h3>
              <button onClick={() => setShowCatManager(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="space-y-2">
              {categoryTemplates.length === 0 && (
                <div className="text-center text-gray-400 py-6 text-sm">暂无大类，去编辑项目时用「+」新增</div>
              )}
              {categoryTemplates.map((cat) => {
                const count = projects.filter((p) => p.category === cat).length
                return (
                  <div key={cat} className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2">
                    {renamingCat === cat ? (
                      <>
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && handleRenameCategory(cat)}
                          autoFocus
                          className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none"
                        />
                        <button onClick={() => handleRenameCategory(cat)} disabled={saving}
                          className="px-2 py-1 text-xs rounded bg-pink-500 text-white">确定</button>
                        <button onClick={() => { setRenamingCat(null); setRenameValue('') }}
                          className="px-2 py-1 text-xs rounded border border-gray-300 text-gray-500">取消</button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 text-sm text-gray-800">{cat}</span>
                        <span className="text-xs text-gray-400">{count} 个项目</span>
                        <button onClick={() => { setRenamingCat(cat); setRenameValue(cat) }}
                          className="px-2 py-1 text-xs rounded bg-blue-50 border border-blue-200 text-blue-600 hover:bg-blue-100">重命名</button>
                        <button onClick={() => handleDeleteCategory(cat)} disabled={saving}
                          className="px-2 py-1 text-xs rounded bg-red-50 border border-red-200 text-red-500 hover:bg-red-100">删除</button>
                      </>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">重命名会同步更新使用该大类的项目和项目地图；被项目使用的大类不可删除。</p>
          </div>
        </div>
      )}
    </div>
  )
}
