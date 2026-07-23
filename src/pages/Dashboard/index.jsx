import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import { db } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import useCacheStore from '../../store/cacheStore'
import BusinessReportPanel from '../../components/BusinessReportPanel'
import StaffAnomalyPanel from '../../components/StaffAnomalyPanel'
import { ensureBusinessReports } from '../../services/businessReportService'
import { ensureStaffAnomalyReport } from '../../services/staffAnomalyService'
import { calcSalary } from '../../domain/salary'

const DIMS = ['日', '周', '月', '年']

export default function Dashboard() {
  const navigate = useNavigate()
  const { staff, products, getSetting, refreshCache } = useCacheStore()
  const salaryFormula = getSetting('salary_formula', null)
  const monthlyStaffTarget = getSetting('monthly_staff_target', 0)
  const [activeTab, setActiveTab] = useState('business')
  const [dim, setDim] = useState('日')
  const [transactions, setTransactions] = useState([])
  const [attendanceRecords, setAttendanceRecords] = useState([])
  const [checkedInAppointments, setCheckedInAppointments] = useState([])
  const [loading, setLoading] = useState(true)

  const [retentionMPs, setRetentionMPs] = useState([])
  const [retentionActiveMembers, setRetentionActiveMembers] = useState([])
  const [retentionLoaded, setRetentionLoaded] = useState(false)
  const [retentionLoading, setRetentionLoading] = useState(false)

  const [weeklyReport, setWeeklyReport] = useState(null)
  const [monthlyReport, setMonthlyReport] = useState(null)
  const [reportsLoading, setReportsLoading] = useState(true)
  const [staffAnomalyReport, setStaffAnomalyReport] = useState(null)
  const [staffAnomalyLoading, setStaffAnomalyLoading] = useState(true)

  useEffect(() => {
    ensureBusinessReports({ getSetting, refreshCache })
      .then(({ weeklyReport: w, monthlyReport: m }) => {
        setWeeklyReport(w)
        setMonthlyReport(m)
      })
      .catch((err) => console.error('经营报告加载失败', err))
      .finally(() => setReportsLoading(false))

    ensureStaffAnomalyReport({ getSetting, refreshCache })
      .then(({ staffAnomalyReport: r }) => setStaffAnomalyReport(r))
      .catch((err) => console.error('员工异常检测失败', err))
      .finally(() => setStaffAnomalyLoading(false))
  }, [])

  const fetchRetentionData = async () => {
    if (retentionLoaded) return
    setRetentionLoading(true)
    try {
      const [mpRes, memberRes] = await Promise.all([
        db.collection(COLLECTIONS.MEMBER_PROJECTS)
          .where({ remaining_sessions: db.command.gt(0) })
          .limit(2000)
          .get(),
        db.collection(COLLECTIONS.MEMBERS)
          .where({ is_key: true })
          .limit(2000)
          .get(),
      ])
      setRetentionMPs(mpRes.data.filter((mp) => mp.status !== 'refunded'))
      setRetentionActiveMembers(memberRes.data)
      setRetentionLoaded(true)
    } catch (err) {
      console.error(err)
    } finally {
      setRetentionLoading(false)
    }
  }

  const handleTabChange = (tab) => {
    setActiveTab(tab)
    if (tab === 'retention') fetchRetentionData()
  }

  const { start, end, prevStart, prevEnd } = getDateRange(dim)

  useEffect(() => {
    fetchData()
  }, [dim])

  const fetchData = async () => {
    setLoading(true)
    try {
      const monthStart = dayjs().startOf('month').format('YYYY-MM-DD')
      const monthEnd = dayjs().endOf('month').format('YYYY-MM-DD')
      const [txnRes, attRes, apptRes] = await Promise.all([
        db.collection(COLLECTIONS.TRANSACTIONS)
          .where({ operated_at: db.command.gte(prevStart).and(db.command.lte(end)) })
          .limit(1000)
          .get(),
        db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
          .where({ date: db.command.gte(monthStart).and(db.command.lte(monthEnd)) })
          .limit(2000)
          .get(),
        db.collection(COLLECTIONS.APPOINTMENTS)
          .where({
            status: 'checked_in',
            scheduled_time: db.command.gte(new Date(monthStart)).and(db.command.lte(new Date(monthEnd + 'T23:59:59'))),
          })
          .limit(2000)
          .get(),
      ])
      setTransactions(txnRes.data)
      setAttendanceRecords(attRes.data)
      setCheckedInAppointments(apptRes.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const current = transactions.filter((t) =>
    new Date(t.operated_at) >= start && new Date(t.operated_at) <= end
  )
  const prev = transactions.filter((t) =>
    new Date(t.operated_at) >= prevStart && new Date(t.operated_at) < start
  )

  // 含 refund（负值）以净额计：退款冲减其发生周期的店铺营收
  const sumPrice = (arr) => arr.filter((t) => t.type === 'purchase' || t.type === 'refund').reduce((s, t) => s + (t.product_price || 0), 0)

  const currentRevenue = sumPrice(current)
  const prevRevenue = sumPrice(prev)
  const revenueChange = prevRevenue > 0
    ? (((currentRevenue - prevRevenue) / prevRevenue) * 100).toFixed(1)
    : null

  const { cogs: currentCOGS, unmatched: unmatchedCount } = calcCOGS(current, products)
  const staffSalaryTotal = staff
    .filter((s) => s.role !== 'owner' && s.status !== '离职')
    .reduce((sum, s) => {
      const level = s.level || '初级'
      const formula = salaryFormula?.[level] || []
      if (formula.length === 0) return sum
      return sum + calcSalary(s._id, formula, current, dim, products, attendanceRecords, monthlyStaffTarget, checkedInAppointments)
    }, 0)
  const currentProfit = currentRevenue - currentCOGS
  const currentCost = currentCOGS + staffSalaryTotal

  // 柱状图数据
  const barData = buildBarData(current, dim)

  // 商品销售列表：按商品名统计卖出次数
  const productSalesList = buildProductSalesList(current, staff)

  // 员工业绩
  const staffPerf = buildStaffPerf(current, staff, salaryFormula, dim, products, attendanceRecords, monthlyStaffTarget, checkedInAppointments)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white shadow-sm">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-gray-500">← 返回</button>
            <h1 className="text-lg font-bold text-gray-800">老板看板</h1>
          </div>
          {activeTab === 'business' && (
            <div className="flex gap-1">
              {DIMS.map((d) => (
                <button
                  key={d}
                  onClick={() => setDim(d)}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    dim === d ? 'bg-[#40C8B8] text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex border-t border-gray-100">
          {[{ key: 'business', label: '经营数据' }, { key: 'retention', label: '会员留存' }].map((t) => (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                activeTab === t.key
                  ? 'text-[#40C8B8] border-b-2 border-[#40C8B8]'
                  : 'text-gray-400 border-b-2 border-transparent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'business' && (loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">加载中...</div>
      ) : (
        <div className="p-4 max-w-5xl mx-auto space-y-4">

          {/* 三张指标卡 */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              color="bg-pink-50 border-pink-200"
              titleColor="text-pink-600"
              title={`${dim}销售额`}
              value={`¥${currentRevenue.toFixed(2)}`}
              change={revenueChange}
              dim={dim}
            />
            <StatCard
              color="bg-purple-50 border-purple-200"
              titleColor="text-purple-600"
              title={`${dim}利润`}
              value={`¥${currentProfit.toFixed(2)}`}
              formula={`销售 ¥${currentRevenue.toFixed(2)} − 进货 ¥${currentCOGS.toFixed(2)}`}
              note={unmatchedCount > 0 ? `${unmatchedCount}笔未匹配商品` : null}
            />
            <StatCard
              color="bg-green-50 border-green-200"
              titleColor="text-green-600"
              title={`${dim}成本`}
              value={`¥${currentCost.toFixed(2)}`}
              formula={`进货 ¥${currentCOGS.toFixed(2)} + 薪酬 ¥${staffSalaryTotal.toFixed(2)}`}
            />
          </div>

          {/* 员工业绩 */}
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
              <h3 className="font-semibold text-gray-700">员工业绩</h3>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#40C8B8]/10 text-[#40C8B8] border border-[#40C8B8]/30">
                {dim === '日' ? '本日' : dim === '周' ? '本周' : dim === '月' ? '本月' : '本年'}
              </span>
            </div>
            {staffPerf.length === 0 ? (
              <div className="text-gray-400 text-sm text-center py-4">暂无数据</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-gray-400 border-b">
                  <tr>
                    <th className="text-left pb-2">员工</th>
                    <th className="text-right pb-2">销售额</th>
                    <th className="text-right pb-2">手工次数</th>
                    <th className="text-right pb-2">手工费合计</th>
                    <th className="text-right pb-2">本期薪酬</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {staffPerf.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b last:border-0 cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => navigate('/staff-earnings', { state: { staffId: s.id, staffName: s.name, staffLevel: s.level || '初级', dim, start: start.toISOString(), end: end.toISOString() } })}
                    >
                      <td className="py-2">
                        {s.name}
                        {s.resigned && <span className="text-gray-400 text-xs ml-1">[已离职]</span>}
                      </td>
                      <td className="py-2 text-right">¥{s.revenue.toFixed(2)}</td>
                      <td className="py-2 text-right">{s.checkouts}次</td>
                      <td className="py-2 text-right text-pink-600">¥{s.fee.toFixed(2)}</td>
                      <td className="py-2 text-right text-purple-600">
                        {s.salary !== null
                          ? `¥${s.salary.toFixed(2)}`
                          : <span className="text-gray-300 text-xs">未配置</span>}
                      </td>
                      <td className="py-2 pl-2 text-gray-300">›</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 图表区 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* 柱状图 */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-3">{dim}销售趋势</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData}>
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => [`¥${v.toFixed(2)}`, '本月销售额']} />
                  <Bar dataKey="value" fill="#f472b6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* 商品销售列表 */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <h3 className="font-semibold text-gray-700 mb-3">销售构成（商品）</h3>
              {productSalesList.length > 0 ? (
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  <div className="flex items-center text-xs text-gray-400 pb-1 border-b border-gray-100 gap-1">
                    <span className="w-4 shrink-0" />
                    <span className="flex-1 min-w-0">商品</span>
                    <span className="w-12 text-center shrink-0">经手</span>
                    <span className="w-16 text-right shrink-0">实付</span>
                  </div>
                  {productSalesList.map((item, i) => (
                    <div key={item.name} className="flex items-center text-sm gap-1">
                      <span className="text-gray-300 w-4 text-right shrink-0 text-xs">{i + 1}</span>
                      <span className="text-gray-700 truncate flex-1 min-w-0">{item.name}</span>
                      <span
                        className="text-gray-500 text-xs w-12 text-center truncate shrink-0"
                        title={item.staffName}
                      >
                        {item.staffName}
                      </span>
                      <span className="text-pink-600 font-medium w-16 text-right shrink-0">
                        ¥{item.paidTotal.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center h-48 text-gray-300">暂无数据</div>
              )}
            </div>
          </div>

          <StaffAnomalyPanel report={staffAnomalyReport} loading={staffAnomalyLoading} />

          <BusinessReportPanel
            weeklyReport={weeklyReport}
            monthlyReport={monthlyReport}
            loading={reportsLoading}
          />
        </div>
      ))}

      {activeTab === 'retention' && (
        <RetentionTab
          loading={retentionLoading}
          memberProjects={retentionMPs}
          activeMembers={retentionActiveMembers}
        />
      )}
    </div>
  )
}

// ——— 会员留存 Tab ———

function TooltipHint({ text }) {
  const [pos, setPos] = useState(null)
  const btnRef = useRef(null)

  const show = () => {
    if (!btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.top - 8, left: r.left + r.width / 2 })
  }
  const hide = () => setPos(null)

  return (
    <span className="inline-block ml-1">
      <button
        ref={btnRef}
        className="cursor-help text-gray-400 text-xs border border-gray-300 rounded-full w-4 h-4 inline-flex items-center justify-center hover:bg-gray-100"
        onMouseEnter={show}
        onMouseLeave={hide}
        onClick={() => pos ? hide() : show()}
      >?</button>
      {pos && (
        <span
          style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translate(-50%, -100%)' }}
          className="px-2 py-1 bg-gray-800 text-white text-xs rounded whitespace-nowrap z-50 pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  )
}

function RetentionTab({ loading, memberProjects, activeMembers }) {
  if (loading) return <div className="flex items-center justify-center py-20 text-gray-400">加载中...</div>

  const unconsumed = (mp) =>
    mp.total_sessions > 0 ? (mp.paid_amount || 0) / mp.total_sessions * (mp.remaining_sessions || 0) : 0

  const totalValue = memberProjects.reduce((s, mp) => s + unconsumed(mp), 0)
  const involvedCount = new Set(memberProjects.map((mp) => mp.member_id)).size
  const avgPerMember = involvedCount > 0 ? totalValue / involvedCount : 0
  const activeMemberCount = activeMembers.length

  const projectMap = {}
  memberProjects.forEach((mp) => {
    const name = mp.project_name || '未知项目'
    if (!projectMap[name]) projectMap[name] = { name, memberIds: new Set(), remaining: 0, value: 0 }
    projectMap[name].memberIds.add(mp.member_id)
    projectMap[name].remaining += mp.remaining_sessions || 0
    projectMap[name].value += unconsumed(mp)
  })
  const projectRows = Object.values(projectMap)
    .map((p) => ({
      name: p.name,
      memberCount: p.memberIds.size,
      penetration: activeMemberCount > 0 ? p.memberIds.size / activeMemberCount : 0,
      remaining: p.remaining,
      value: p.value,
      avgRemaining: p.memberIds.size > 0 ? p.remaining / p.memberIds.size : 0,
    }))
    .sort((a, b) => b.value - a.value)

  return (
    <div className="p-4 max-w-5xl mx-auto space-y-4">
      {/* 总览卡片 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-3 border bg-indigo-50 border-indigo-200">
          <div className="text-xs font-medium mb-1 text-indigo-600">未消耗服务总价值</div>
          <div className="text-lg font-bold text-gray-800">¥{totalValue.toFixed(0)}</div>
        </div>
        <div className="rounded-xl p-3 border bg-purple-50 border-purple-200">
          <div className="text-xs font-medium mb-1 text-purple-600">涉及会员数</div>
          <div className="text-lg font-bold text-gray-800">{involvedCount} <span className="text-sm font-normal text-gray-400">人</span></div>
          <div className="text-xs text-gray-400 mt-0.5">星标会员 {activeMemberCount} 人</div>
        </div>
        <div className="rounded-xl p-3 border bg-pink-50 border-pink-200">
          <div className="text-xs font-medium mb-1 text-pink-600">平均未消耗金额</div>
          <div className="text-lg font-bold text-gray-800">¥{avgPerMember.toFixed(0)}</div>
          <div className="text-xs text-gray-400 mt-0.5">/ 人</div>
        </div>
      </div>

      {/* 项目留存分布 */}
      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h3 className="font-semibold text-gray-700 mb-3">项目留存分布</h3>
        {projectRows.length === 0 ? (
          <div className="text-center py-8 text-gray-300">暂无数据</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-gray-400 border-b">
                <tr>
                  <th className="text-left pb-2 pr-3">项目名称</th>
                  <th className="text-right pb-2 pr-3">持有会员数</th>
                  <th className="text-right pb-2 pr-3">渗透率<TooltipHint text="持有会员数 ÷ 星标会员总数" /></th>
                  <th className="text-right pb-2 pr-3">总剩余次数</th>
                  <th className="text-right pb-2 pr-3">未消耗金额</th>
                  <th className="text-right pb-2">平均剩余次数/人<TooltipHint text="总剩余次数 ÷ 持有会员数" /></th>
                </tr>
              </thead>
              <tbody>
                {projectRows.map((row) => (
                  <tr key={row.name} className="border-b last:border-0">
                    <td className="py-2 pr-3 text-gray-700 font-medium">{row.name}</td>
                    <td className="py-2 pr-3 text-right">{row.memberCount}</td>
                    <td className="py-2 pr-3 text-right text-gray-500">
                      {activeMemberCount > 0 ? (row.penetration * 100).toFixed(1) + '%' : '—'}
                    </td>
                    <td className="py-2 pr-3 text-right">{row.remaining}</td>
                    <td className="py-2 pr-3 text-right text-indigo-600 font-medium">¥{row.value.toFixed(0)}</td>
                    <td className="py-2 text-right text-gray-500">{row.avgRemaining.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ——— 工具函数 ———

function getDateRange(dim) {
  const now = dayjs()
  let start, end, prevStart, prevEnd

  if (dim === '日') {
    start = now.startOf('day').toDate()
    end = now.endOf('day').toDate()
    prevStart = now.subtract(1, 'day').startOf('day').toDate()
    prevEnd = now.subtract(1, 'day').endOf('day').toDate()
  } else if (dim === '周') {
    start = now.startOf('week').toDate()
    end = now.endOf('week').toDate()
    prevStart = now.subtract(1, 'week').startOf('week').toDate()
    prevEnd = now.subtract(1, 'week').endOf('week').toDate()
  } else if (dim === '月') {
    start = now.startOf('month').toDate()
    end = now.endOf('month').toDate()
    prevStart = now.subtract(1, 'month').startOf('month').toDate()
    prevEnd = now.subtract(1, 'month').endOf('month').toDate()
  } else {
    start = now.startOf('year').toDate()
    end = now.endOf('year').toDate()
    prevStart = now.subtract(1, 'year').startOf('year').toDate()
    prevEnd = now.subtract(1, 'year').endOf('year').toDate()
  }
  return { start, end, prevStart, prevEnd }
}

function buildBarData(transactions, dim) {
  const map = {}

  transactions.forEach((t) => {
    const d = dayjs(t.operated_at)
    let key
    if (dim === '日') key = d.format('HH') + ':00'
    else if (dim === '周') key = ['日', '一', '二', '三', '四', '五', '六'][d.day()]
    else if (dim === '月') key = d.format('D') + '日'
    else key = d.format('M') + '月'

    map[key] = (map[key] || 0) + (t.product_price || 0)
  })

  if (dim === '日') {
    return Array.from({ length: 14 }, (_, i) => {
      const h = String(i + 8).padStart(2, '0') + ':00'
      return { label: h, value: +(map[h] || 0).toFixed(2) }
    })
  }
  if (dim === '周') {
    return ['一', '二', '三', '四', '五', '六', '日'].map((d) => ({
      label: d, value: +(map[d] || 0).toFixed(2),
    }))
  }
  if (dim === '月') {
    const days = dayjs().daysInMonth()
    return Array.from({ length: days }, (_, i) => ({
      label: `${i + 1}`, value: +(map[`${i + 1}日`] || 0).toFixed(2),
    }))
  }
  return Array.from({ length: 12 }, (_, i) => ({
    label: `${i + 1}月`, value: +(map[`${i + 1}月`] || 0).toFixed(2),
  }))
}

function buildProductSalesList(transactions, staff = []) {
  const staffMap = Object.fromEntries((staff || []).map((s) => [s._id, s.name]))
  const refundedIds = new Set(
    (transactions || [])
      .filter((t) => t.type === 'refund' && t.refund_ref_id)
      .map((t) => t.refund_ref_id)
  )
  const map = {}
  for (const t of transactions || []) {
    if (t.type !== 'purchase') continue
    if (!t.product_name || t.product_name.startsWith('促销优惠')) continue
    if (refundedIds.has(t._id)) continue
    const name = t.product_name
    const staffName = staffMap[t.therapist_id] || null
    if (!map[name]) {
      map[name] = { name, paidTotal: 0, staffSet: new Set() }
    }
    map[name].paidTotal += t.product_price || 0
    if (staffName) map[name].staffSet.add(staffName)
  }
  return Object.values(map)
    .map((item) => ({
      name: item.name,
      paidTotal: +item.paidTotal.toFixed(2),
      staffName: [...item.staffSet].join('、') || '-',
    }))
    .sort((a, b) => b.paidTotal - a.paidTotal)
}

function buildStaffPerf(transactions, allStaff, salaryFormula, dim, products, attendanceRecords, monthlyStaffTarget, checkedInAppointments) {
  const map = {}
  const feeTimestamps = {}
  const refundedRefIds = new Set(
    transactions.filter((t) => t.type === 'refund').map((t) => t.refund_ref_id).filter(Boolean)
  )
  transactions.forEach((t) => {
    const id = t.therapist_id
    if (!id) return
    if (!map[id]) { map[id] = { id, revenue: 0, checkouts: 0, fee: 0 }; feeTimestamps[id] = new Set() }
    if (t.type === 'purchase' && !refundedRefIds.has(t._id)) map[id].revenue += t.product_price || 0
    if (t.type === 'checkout' && t.is_fee) {
      feeTimestamps[id].add(new Date(t.operated_at).getTime())
      map[id].fee += t.product_price || 0
    }
  })
  Object.keys(map).forEach((id) => { map[id].checkouts = feeTimestamps[id].size })

  return Object.values(map).map((s) => {
    const staffInfo = allStaff.find((st) => st._id === s.id)
    const level = staffInfo?.level || '初级'
    const formula = salaryFormula?.[level] || []
    const salary = formula.length > 0 ? calcSalary(s.id, formula, transactions, dim, products, attendanceRecords, monthlyStaffTarget, checkedInAppointments) : null
    return {
      ...s,
      name: staffInfo?.name || '未知员工',
      level,
      resigned: staffInfo?.status === '离职',
      salary,
    }
  })
}

function calcCOGS(transactions, products) {
  let cogs = 0
  let unmatched = 0
  for (const t of transactions) {
    if (t.type !== 'purchase' || (t.product_price || 0) <= 0) continue
    const prod = products.find((p) => p.barcode && String(p.barcode) === String(t.barcode))
      || products.find((p) => p.name === t.product_name)
    if (prod) {
      cogs += prod.purchase_price || 0
    } else {
      unmatched += 1
    }
  }
  return { cogs, unmatched }
}

function StatCard({ color, titleColor, title, value, change, formula, note, dim }) {
  const isUp = change !== null && parseFloat(change) >= 0
  return (
    <div className={`rounded-xl p-3 border ${color}`}>
      <div className={`text-xs font-medium mb-1 ${titleColor}`}>{title}</div>
      <div className="text-lg font-bold text-gray-800">{value}</div>
      {formula && <div className="text-xs text-gray-400 mt-1 leading-relaxed">{formula}</div>}
      {change !== null && change !== undefined && (
        <div className={`text-xs mt-1 ${isUp ? 'text-red-500' : 'text-green-600'}`}>
          {isUp ? '▲' : '▼'} {Math.abs(change)}%
          <span className="text-gray-400 ml-1">较{dim === '日' ? '昨日' : dim === '周' ? '上周' : dim === '月' ? '上月' : '去年'}</span>
        </div>
      )}
      {note && <div className="text-xs text-orange-400 mt-1">{note}</div>}
    </div>
  )
}
