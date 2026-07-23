import useCacheStore from '../store/cacheStore'

export default function OperatorSelector({ onSelect, onCancel }) {
  const staff = useCacheStore((s) => s.staff)
  const selectable = staff.filter((s) => s.role !== 'owner' && s.status === '在职')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="px-6 pt-5 pb-3 flex items-start justify-between">
          <div>
            <h2 className="font-semibold text-gray-800 text-lg">选择当前操作人</h2>
            <p className="text-sm text-gray-400 mt-0.5">业绩将归属到所选员工</p>
          </div>
          {onCancel && (
            <button onClick={onCancel} className="text-gray-400 text-sm mt-1 hover:text-gray-600">
              返回
            </button>
          )}
        </div>
        <div className="px-4 pb-6 space-y-2 max-h-72 overflow-y-auto">
          {selectable.length === 0 && (
            <div className="text-center text-gray-400 text-sm py-6">暂无在职员工</div>
          )}
          {selectable.map((s) => (
            <button
              key={s._id}
              onClick={() => onSelect(s)}
              className="w-full text-left px-4 py-3 rounded-xl border border-gray-200 hover:bg-[#40C8B8]/10 hover:border-[#40C8B8] transition-colors flex items-center gap-3"
            >
              <div className="w-9 h-9 rounded-full bg-[#40C8B8]/15 flex items-center justify-center text-[#40C8B8] font-semibold shrink-0">
                {s.name.slice(0, 1)}
              </div>
              <div>
                <div className="font-medium text-gray-800">{s.name}</div>
                {s.level && <div className="text-xs text-gray-400">{s.level}</div>}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
