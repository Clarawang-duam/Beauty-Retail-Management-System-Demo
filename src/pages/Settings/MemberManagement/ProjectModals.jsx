// 会员项目的两个轻量弹窗：确认拿走 / 编辑项目记录。纯展示，状态由父组件持有。

export function TakeAwayModal({ productName, onCancel, onConfirm }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5">
        <h3 className="font-bold text-gray-800 text-lg mb-2">确认拿走</h3>
        <p className="text-gray-600 mb-5">「{productName}」确认不再留存？</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm">取消</button>
          <button onClick={onConfirm} className="flex-1 py-2 bg-teal-500 text-white rounded-lg text-sm">确认拿走</button>
        </div>
      </div>
    </div>
  )
}

export function EditProjectModal({ project, productName, form, setForm, onCancel, onSave }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm p-5">
        <h3 className="font-bold text-gray-800 text-lg mb-4">编辑项目记录</h3>
        <div className="text-sm text-gray-500 mb-4">
          {project.project_name}
          {productName && <span className="ml-1">· {productName}</span>}
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-gray-500 mb-1 block">实付金额（元）</label>
            <input
              type="number"
              min="0"
              value={form.paid_amount}
              onChange={(e) => setForm({ ...form, paid_amount: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-sm text-gray-500 mb-1 block">已做次数</label>
            <input
              type="number"
              min="0"
              value={form.used_sessions}
              onChange={(e) => setForm({ ...form, used_sessions: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <div className="text-xs text-gray-400 mt-1">
              剩余将自动更新为 {project.total_sessions - Number(form.used_sessions)} 次
            </div>
          </div>
          <div>
            <label className="text-sm text-gray-500 mb-1 block">备注</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
              rows={2}
              placeholder="选填"
            />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onCancel} className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm">取消</button>
          <button onClick={onSave} className="flex-1 py-2 bg-pink-500 text-white rounded-lg text-sm">保存</button>
        </div>
      </div>
    </div>
  )
}
