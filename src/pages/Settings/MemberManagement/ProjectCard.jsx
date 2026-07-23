// 会员项目卡片：single / kit / kit_old 三种形态。纯展示，行为通过回调上抛。
import { toArray } from '../../../utils/array'

export default function ProjectCard({
  group,
  colorClass,
  expanded,
  isSelected,
  compact = false, // 双排视图：隐藏卡片上的商品名，仅留项目名
  products,
  canEditSettings,
  isOwner,
  onToggleSelect,
  onToggleExpand,
  onTakeAway,
  onEdit,
  onDelete,
}) {
  const ring = isSelected ? 'ring-2 ring-pink-400' : ''

  if (group.type === 'single') {
    const mp = group.mp
    const overUsed = mp.used_sessions > mp.total_sessions
    const productName = mp.product_id ? products.find((p) => p._id === mp.product_id)?.name : null
    const remainColor = mp.remaining_sessions <= 0 ? 'text-red-500' : mp.remaining_sessions <= 2 ? 'text-orange-500' : 'text-gray-600'
    return (
      <div
        onClick={() => onToggleSelect(group)}
        className={`rounded-xl p-4 shadow-sm border cursor-pointer transition-shadow ${colorClass.bg} ${colorClass.border} ${isSelected ? 'ring-2 ring-pink-400' : 'hover:shadow-md'}`}>
        <div className="flex justify-between items-start">
          <div>
            <div className="font-semibold text-gray-800">
              {mp.project_name}
              {!compact && productName && <span className="font-normal text-gray-500 ml-1">· {productName}</span>}
            </div>
            {mp.product_spec && <div className="text-gray-400 text-xs mt-0.5">{mp.product_spec}</div>}
          </div>
          <div className="text-right">
            <div className="text-pink-600 font-medium">¥{mp.paid_amount}</div>
            <div className="text-gray-400 text-xs">{new Date(mp.purchased_at).toLocaleDateString()}</div>
          </div>
        </div>
        <div className={`flex gap-4 mt-2 text-sm ${remainColor}`}>
          <span className="text-gray-600">已用 {mp.used_sessions}/{mp.total_sessions}</span>
          <span>剩余 <strong>{mp.remaining_sessions}</strong></span>
          <span className="text-gray-400">最多 {mp.max_sessions} 次</span>
        </div>
        {overUsed && <div className="mt-1 text-xs text-red-500">已超规定次数</div>}
        {(canEditSettings || isOwner) && (
          <div className="flex gap-2 mt-3 items-center" onClick={(e) => e.stopPropagation()}>
            {canEditSettings && (
              <button onClick={() => onTakeAway({ mpId: mp._id, productName: productName || mp.project_name })} className="px-3 py-1 text-xs font-medium rounded-lg bg-teal-50 border border-teal-300 text-teal-600 hover:bg-teal-100">拿走</button>
            )}
            {isOwner && (
              <button onClick={() => onEdit(mp)} className="px-3 py-1 text-xs font-medium rounded-lg bg-blue-50 border border-blue-300 text-blue-600 hover:bg-blue-100">编辑</button>
            )}
            {isOwner && (
              <button onClick={() => onDelete(mp)} className="px-3 py-1 text-xs font-medium rounded-lg bg-red-50 border border-red-300 text-red-500 hover:bg-red-100 ml-auto">删除</button>
            )}
          </div>
        )}
      </div>
    )
  }

  if (group.type === 'kit') {
    return (
      <div className={`rounded-xl shadow-sm border overflow-hidden ${colorClass.border} ${ring}`}>
        <div
          className={`flex justify-between items-center px-4 py-3 cursor-pointer select-none ${colorClass.bg}`}
          onClick={() => onToggleSelect(group)}
        >
          <div className="flex items-center gap-2">
            <button onClick={(e) => { e.stopPropagation(); onToggleExpand(group.key) }} className="text-gray-400 text-2xl leading-none hover:text-gray-600 px-2 -ml-2">{expanded ? '▼' : '▶'}</button>
            {compact ? (
              <span className="font-semibold text-gray-800">{group.project_name}</span>
            ) : (
              <>
                <span className="font-semibold text-gray-800">{group.parent.name}</span>
                <span className="text-gray-500 text-sm">· {group.project_name}</span>
              </>
            )}
          </div>
          <div className="text-gray-400 text-xs">{new Date(group.purchased_at).toLocaleDateString()}</div>
        </div>
        {expanded && group.children.map((childMp, childIdx) => {
          const childProd = products.find((p) => p._id === childMp.product_id)
          const childOverUsed = childMp.used_sessions > childMp.total_sessions
          const kitTotalQty = toArray(group.parent.kit_components).reduce((s, c) => s + (typeof c === 'string' ? 1 : (c.qty || 1)), 0)
          const displayPrice = childMp.paid_amount ?? +(group.children.reduce((s, c) => s + (c.paid_amount ?? 0), 0) / kitTotalQty).toFixed(2)
          const sameCount = group.children.filter(c => c.product_id === childMp.product_id).length
          const sameIdx = group.children.slice(0, childIdx).filter(c => c.product_id === childMp.product_id).length + 1
          return (
            <div key={childMp._id} className="border-t border-gray-100 px-4 py-3 bg-white">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-sm font-medium text-gray-700">
                    {childProd?.name || '—'}
                    {sameCount > 1 && <span className="text-gray-400 text-xs ml-1">（{sameIdx}）</span>}
                  </div>
                  {childMp.product_spec && <div className="text-xs text-gray-400">{childMp.product_spec}</div>}
                </div>
                <div className="text-right">
                  <div className="text-pink-600 text-sm">¥{displayPrice}</div>
                </div>
              </div>
              <div className="flex gap-4 mt-1 text-xs">
                <span className="text-gray-500">已用 {childMp.used_sessions}/{childMp.total_sessions}</span>
                <span className={childMp.remaining_sessions <= 0 ? 'text-red-500' : childMp.remaining_sessions <= 2 ? 'text-orange-500' : 'text-gray-500'}>剩余 <strong>{childMp.remaining_sessions}</strong></span>
                <span className="text-gray-400">最多 {childMp.max_sessions}</span>
              </div>
              {childOverUsed && <div className="text-xs text-red-500 mt-0.5">已超规定次数</div>}
              {(canEditSettings || isOwner) && (
                <div className="flex gap-2 mt-2 items-center">
                  {canEditSettings && (
                    <button onClick={() => onTakeAway({ mpId: childMp._id, productName: childProd?.name || '—' })} className="px-3 py-1 text-xs font-medium rounded-lg bg-teal-50 border border-teal-300 text-teal-600 hover:bg-teal-100">拿走</button>
                  )}
                  {isOwner && (
                    <button onClick={() => onEdit(childMp)} className="px-3 py-1 text-xs font-medium rounded-lg bg-blue-50 border border-blue-300 text-blue-600 hover:bg-blue-100">编辑</button>
                  )}
                  {isOwner && (
                    <button onClick={() => onDelete(childMp)} className="px-3 py-1 text-xs font-medium rounded-lg bg-red-50 border border-red-300 text-red-500 hover:bg-red-100 ml-auto">删除</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (group.type === 'kit_old') {
    const mp = group.mp
    const normalizedKitComponents = toArray(group.parent.kit_components).map((c) =>
      typeof c === 'string' ? { product_id: c, qty: 1 } : c
    )
    const kitTotalQty = normalizedKitComponents.reduce((s, c) => s + (c.qty || 1), 0)
    return (
      <div className={`rounded-xl shadow-sm border overflow-hidden ${colorClass.border} ${ring}`}>
        <div
          className={`px-4 py-3 cursor-pointer select-none ${colorClass.bg}`}
          onClick={() => onToggleSelect(group)}
        >
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-2">
              <button onClick={(e) => { e.stopPropagation(); onToggleExpand(group.key) }} className="text-gray-400 text-2xl leading-none hover:text-gray-600 px-2 -ml-2">{expanded ? '▼' : '▶'}</button>
              <div>
                <div className="font-semibold text-gray-800">
                  {mp.project_name}
                  {!compact && <span className="font-normal text-gray-500 ml-1">· {group.parent.name}</span>}
                </div>
                {mp.product_spec && <div className="text-gray-400 text-xs">{mp.product_spec}</div>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-pink-600 font-medium">¥{mp.paid_amount}</div>
              <div className="text-gray-400 text-xs">{new Date(mp.purchased_at).toLocaleDateString()}</div>
            </div>
          </div>
        </div>
        {(canEditSettings || isOwner) && (
          <div className="flex gap-2 px-4 py-2 border-t border-gray-100 bg-white items-center">
            {canEditSettings && (
              <button onClick={() => onTakeAway({ mpId: mp._id, productName: group.parent.name })} className="px-3 py-1 text-xs font-medium rounded-lg bg-teal-50 border border-teal-300 text-teal-600 hover:bg-teal-100">拿走</button>
            )}
            {isOwner && (
              <button onClick={() => onEdit(mp)} className="px-3 py-1 text-xs font-medium rounded-lg bg-blue-50 border border-blue-300 text-blue-600 hover:bg-blue-100">编辑</button>
            )}
            {isOwner && (
              <button onClick={() => onDelete(mp)} className="px-3 py-1 text-xs font-medium rounded-lg bg-red-50 border border-red-300 text-red-500 hover:bg-red-100 ml-auto">删除</button>
            )}
          </div>
        )}
        {expanded && normalizedKitComponents.map(({ product_id, qty }) => {
          const childProd = products.find((p) => p._id === product_id)
          const perUnit = mp.paid_amount ? +(mp.paid_amount / kitTotalQty).toFixed(2) : 0
          const childPrice = +(perUnit * (qty || 1)).toFixed(2)
          return (
            <div key={product_id} className="border-t border-gray-100 px-4 py-3 bg-white">
              <div className="flex justify-between items-center">
                <div>
                  <div className="text-sm text-gray-600">{childProd?.name || product_id}</div>
                  {childProd?.spec && <div className="text-xs text-gray-400">{childProd.spec}</div>}
                </div>
                <div className="text-pink-600 text-sm">¥{childPrice}</div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return null
}
