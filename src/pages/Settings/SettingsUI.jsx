// Settings 各面板共用的小型展示组件

export function PanelSection({ title, open, onToggle, children }) {
  return (
    <div className="bg-white rounded-xl shadow-sm overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="font-medium text-gray-800">{title}</span>
        <span className="text-gray-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-4 pb-4 border-t border-gray-100">{children}</div>}
    </div>
  )
}

export function SettingRow({ label, children }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-gray-600">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

export function SaveButton({ onClick, saving }) {
  return (
    <button
      onClick={onClick}
      disabled={saving}
      className="mt-2 w-full py-2 bg-pink-500 hover:bg-pink-600 disabled:bg-pink-300 text-white rounded-lg text-sm"
    >
      {saving ? '保存中...' : '保存'}
    </button>
  )
}
