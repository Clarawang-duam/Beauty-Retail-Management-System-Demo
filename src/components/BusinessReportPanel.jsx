import MarkdownReport from './MarkdownReport'

export default function BusinessReportPanel({ weeklyReport, monthlyReport, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div className="text-sm text-gray-400 text-center py-2">经营报告生成中…</div>
      </div>
    )
  }

  if (!weeklyReport && !monthlyReport) return null

  return (
    <div className="space-y-3">
      {monthlyReport && (
        <ReportCard title="月报" report={monthlyReport} />
      )}
      {weeklyReport && (
        <ReportCard title="周报" report={weeklyReport} />
      )}
    </div>
  )
}

function ReportCard({ title, report }) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-indigo-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-800">{title}</h3>
        <span className="text-xs text-gray-400">{report.periodLabel}</span>
      </div>

      {report.insufficientData && !report.aiMarkdown ? (
        <p className="text-sm text-gray-500">
          经营数据尚不足，暂无法生成报告。请积累更多成交后再查看。
        </p>
      ) : report.aiMarkdown ? (
        <MarkdownReport text={report.aiMarkdown} />
      ) : (
        <LegacyAnomalyView report={report} />
      )}
    </div>
  )
}

/** 无 AI 文案时的兜底展示（旧版异常卡片） */
function LegacyAnomalyView({ report }) {
  if (report.allNormal) {
    return (
      <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
        ✅ {report.periodType === 'week' ? '本周' : '本月'}各项经营指标在正常范围内，无异常。
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {report.anomalies.map((item) => (
        <div key={item.dimension} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
          <div className="text-sm font-medium text-gray-800 mb-1">{item.icon} {item.title}</div>
          <p className="text-sm text-gray-700 leading-relaxed">{item.message}</p>
        </div>
      ))}
    </div>
  )
}
