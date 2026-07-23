// 会员详情右栏：选中项目卡片的核销记录（合并子快照，按日期倒序）
export default function CheckoutRecordPanel({ group, records, staffNameMap, onClose }) {
  const isKit = group.type === 'kit'
  const title = isKit ? group.parent.name : group.mp.project_name

  return (
    <div className="mt-3 md:mt-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden md:sticky md:top-4 animate-[slideIn_.25s_ease]">
      <div className="flex items-center justify-between px-4 py-3 bg-pink-50 border-b border-pink-100">
        <div className="min-w-0">
          <div className="font-semibold text-gray-800 truncate">核销记录</div>
          <div className="text-xs text-gray-500 truncate">{title}</div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none shrink-0 ml-2"
        >✕</button>
      </div>
      <div className="divide-y divide-gray-50 max-h-[70vh] overflow-y-auto">
        {records.length === 0 ? (
          <div className="text-center text-gray-400 py-10 text-sm">暂无核销记录</div>
        ) : (
          records.map((r) => (
            <div key={r._id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-gray-700">
                  {new Date(r.operated_at).toLocaleDateString()}
                  <span className="text-gray-400 ml-1.5">
                    {new Date(r.operated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </span>
                <span className="text-sm font-semibold text-pink-600 shrink-0">{r.feeCount} 次</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                <span>{staffNameMap[r.therapist_id] || '—'}</span>
                {isKit && r.productName && (
                  <span className="bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded truncate">{r.productName}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
