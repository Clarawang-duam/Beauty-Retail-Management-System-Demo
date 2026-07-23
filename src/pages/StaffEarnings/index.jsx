import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import dayjs from 'dayjs'
import { db } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import useCacheStore from '../../store/cacheStore'
import EarningsPanel from '../../components/EarningsPanel'

const DIM_LABEL = { 日: '本日', 周: '本周', 月: '本月', 年: '本年' }

export default function StaffEarningsPage() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const { getSetting, members, refreshCache } = useCacheStore()

  const staffId = state?.staffId
  const staffName = state?.staffName || '员工'
  const staffLevel = state?.staffLevel || '初级'
  const dim = state?.dim || '月'

  // 月维度下支持「本月/上月」切换；其他维度沿用传入的区间
  const isMonthDim = dim === '月'
  const [monthPeriod, setMonthPeriod] = useState('current') // current | last

  const monthBase = monthPeriod === 'last' ? dayjs().subtract(1, 'month') : dayjs()
  const dimLabel = isMonthDim
    ? (monthPeriod === 'last' ? `${monthBase.month() + 1}月` : '本月')
    : (DIM_LABEL[dim] || '本月')

  const start = isMonthDim
    ? monthBase.startOf('month').toDate()
    : (state?.start ? new Date(state.start) : dayjs().startOf('month').toDate())
  const end = isMonthDim
    ? monthBase.endOf('month').toDate()
    : (state?.end ? new Date(state.end) : dayjs().endOf('month').toDate())

  const [txns, setTxns] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!staffId) return
    if (members.length === 0) refreshCache('members')
    setLoading(true)
    db.collection(COLLECTIONS.TRANSACTIONS)
      .where({ therapist_id: staffId, operated_at: db.command.gte(start).and(db.command.lte(end)) })
      .limit(1000)
      .get()
      .then((res) => setTxns(res.data))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [staffId, monthPeriod])

  if (!staffId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">参数缺失</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700">← 返回</button>
        <h1 className="text-lg font-bold text-gray-800">{staffName} · {dimLabel}业绩</h1>
      </div>
      <div className="p-4 max-w-2xl mx-auto">
        {isMonthDim && (
          <div className="flex gap-2 mb-4">
            {[{ key: 'current', label: '本月' }, { key: 'last', label: '上月' }].map((p) => (
              <button
                key={p.key}
                onClick={() => setMonthPeriod(p.key)}
                className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                  monthPeriod === p.key
                    ? 'bg-purple-500 text-white border-purple-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
        <EarningsPanel
          txns={txns}
          loading={loading}
          staffLevel={staffLevel}
          getSetting={getSetting}
          members={members}
          dimLabel={dimLabel}
        />
      </div>
    </div>
  )
}
