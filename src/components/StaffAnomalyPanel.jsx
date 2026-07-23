export default function StaffAnomalyPanel({ report, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="text-sm text-gray-400 text-center py-2">员工异常检测中…</div>
      </div>
    )
  }

  if (!report) return null

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-amber-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">员工异常</h3>
        <span className="text-xs text-gray-400">{report.periodLabel}</span>
      </div>

      {report.allNormal ? (
        <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
          ✅ 本期未发现员工经营异常。
        </p>
      ) : (
        <div className="space-y-3">
          {report.anomalies.map((item, i) => (
            <div
              key={`${item.dimension}-${item.staffId}-${item.serialNumber || i}`}
              className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5"
            >
              <div className="text-sm font-medium text-gray-800 mb-1">
                {item.icon} {item.title}
                <span className="text-gray-500 font-normal ml-2">{item.staffName}</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{item.message}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
