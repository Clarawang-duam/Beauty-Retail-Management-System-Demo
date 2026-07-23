import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { db, _ } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import useCacheStore from '../../store/cacheStore'
import useAuthStore from '../../store/authStore'
import { useOperator } from '../../hooks/useOperator'
import OperatorSelector from '../../components/OperatorSelector'
import TimeGrid from '../../components/TimeGrid'
import {
  timeToMinutes, minutesToTime, roundUpToStep, buildDateTime, dateToMinutes,
} from '../../utils/timeSlots'
import { generateBookingCode } from '../../utils/bookingCode'

export default function AppointmentPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { getSetting, projects, activeStaff } = useCacheStore()
  const { isShared, operatorName, setActiveStaff } = useOperator()
  const [showOperatorSwitch, setShowOperatorSwitch] = useState(false)

  const maxDaysAhead = getSetting('max_booking_days_ahead', 30)
  const maxRows = getSetting('max_clients_per_slot', 2)
  const morningStart = getSetting('morning_shift_start', '09:00')
  const eveningEnd = getSetting('evening_shift_end', '20:00')

  const today = dayjs().format('YYYY-MM-DD')
  const [selectedDate, setSelectedDate] = useState(today)
  const [showCalendar, setShowCalendar] = useState(false)
  const [memberId, setMemberId] = useState('')
  const [memberSearch, setMemberSearch] = useState('')
  const [memberResults, setMemberResults] = useState([])
  const [selectedMember, setSelectedMember] = useState(null)
  const [therapistId, setTherapistId] = useState(user?.uid || '')
  const [startTime, setStartTime] = useState(morningStart)
  const [projectIds, setProjectIds] = useState([])
  const [memberAvailableProjects, setMemberAvailableProjects] = useState([])
  const [loadingProjects, setLoadingProjects] = useState(false)
  const [appointmentsByStaff, setAppointmentsByStaff] = useState({})
  const [saving, setSaving] = useState(false)
  const [selectedAppt, setSelectedAppt] = useState(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const selectedProjects = projects.filter((p) => projectIds.includes(p._id))
  const duration = selectedProjects.reduce((sum, p) => sum + (p.duration_min || 0), 0) || 30
  const startMin = timeToMinutes(startTime)

  // 搜索会员：姓名任意长度触发；手机号最少4位才触发
  useEffect(() => {
    if (!memberSearch) { setMemberResults([]); return }
    const isDigits = /^\d+$/.test(memberSearch)
    if (isDigits && memberSearch.length < 4) { setMemberResults([]); return }
    const timer = setTimeout(async () => {
      const res = await db.collection(COLLECTIONS.MEMBERS)
        .where(db.command.or([
          { name: db.RegExp({ regexp: memberSearch, options: 'i' }) },
          { phone: db.RegExp({ regexp: memberSearch, options: 'i' }) },
        ]))
        .limit(10).get()
      setMemberResults(res.data)
    }, 300)
    return () => clearTimeout(timer)
  }, [memberSearch])

  // 会员切换时，拉取该会员有余量的项目
  useEffect(() => {
    setProjectIds([])
    setMemberAvailableProjects([])
    if (!selectedMember) return
    setLoadingProjects(true)
    db.collection(COLLECTIONS.MEMBER_PROJECTS)
      .where({ member_id: selectedMember._id })
      .limit(100).get()
      .then((res) => {
        const available = res.data.filter(
          (mp) => mp.status !== 'refunded' && (mp.used_sessions ?? 0) < (mp.max_sessions ?? Infinity)
        )
        const names = [...new Set(available.map((r) => r.project_name))]
        const matched = names.map((name) => projects.find((p) => p.name === name)).filter(Boolean)
        setMemberAvailableProjects(matched)
      })
      .finally(() => setLoadingProjects(false))
  }, [selectedMember])

  // 一次拉取当天所有员工的预约
  useEffect(() => {
    if (!selectedDate) return
    fetchAllAppointments()
  }, [selectedDate])

  const fetchAllAppointments = async () => {
    const dayStart = dayjs(selectedDate).startOf('day').toDate()
    const dayEnd = dayjs(selectedDate).endOf('day').toDate()
    const res = await db.collection(COLLECTIONS.APPOINTMENTS)
      .where({
        status: db.command.neq('cancelled'),
        scheduled_time: db.command.gte(dayStart).and(db.command.lte(dayEnd)),
      })
      .get()

    const enriched = await Promise.all(res.data.map(async (appt) => {
      const [mRes, mpRes] = await Promise.all([
        db.collection(COLLECTIONS.MEMBERS).doc(appt.member_id).get(),
        appt.member_project_id
          ? db.collection(COLLECTIONS.MEMBER_PROJECTS).doc(appt.member_project_id).get()
          : Promise.resolve({ data: [] }),
      ])
      const projectNames = appt.project_names?.length > 0
        ? appt.project_names
        : appt.project_name
        ? [appt.project_name]
        : [mpRes.data?.[0]?.project_name || '未知项目']
      return {
        ...appt,
        member_name: mRes.data?.[0]?.name || '未知',
        project_names: projectNames,
      }
    }))

    const byStaff = {}
    for (const appt of enriched) {
      if (!byStaff[appt.therapist_id]) byStaff[appt.therapist_id] = []
      byStaff[appt.therapist_id].push(appt)
    }
    setAppointmentsByStaff(byStaff)
  }

  // 选中的美容师置顶
  const sortedStaff = [...activeStaff()].sort((a, b) => {
    if (a._id === therapistId) return -1
    if (b._id === therapistId) return 1
    return 0
  })

  const closeApptModal = () => { setSelectedAppt(null); setConfirmCancel(false) }

  const handleCancelAppt = async () => {
    setCancelling(true)
    try {
      await db.collection(COLLECTIONS.APPOINTMENTS).doc(selectedAppt._id).update({ status: 'cancelled' })
      closeApptModal()
      await fetchAllAppointments()
    } catch (err) {
      alert('取消失败：' + err.message)
    } finally {
      setCancelling(false)
    }
  }

  const handleCellClick = (min) => {
    const snapped = roundUpToStep(min, 5)
    setStartTime(minutesToTime(snapped))
  }

  const handleTimeInput = (val) => {
    setStartTime(val)
  }

  const maxProjects = Math.max(0, Number(getSetting('checkout_max_projects', 0)) || 0)
  const toggleProject = (id) => {
    setProjectIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (maxProjects > 0 && prev.length >= maxProjects) {
        alert(`单次最多预约 ${maxProjects} 个项目`)
        return prev
      }
      return [...prev, id]
    })
  }

  const validate = () => {
    if (!selectedMember) return '请选择会员'
    if (!therapistId) return '请选择美容师'
    if (projectIds.length === 0) return '请选择预约项目'

    const shiftStartMin = timeToMinutes(morningStart)
    const shiftEndMin = timeToMinutes(eveningEnd)
    if (startMin < shiftStartMin) return `开始时间不能早于 ${morningStart}`

    const maxDate = dayjs().add(maxDaysAhead, 'day').format('YYYY-MM-DD')
    if (selectedDate > maxDate) return `最远只能预约 ${maxDaysAhead} 天后`
    if (selectedDate < today) return '不能预约过去的日期'

    return null
  }

  const handleSubmit = async () => {
    const err = validate()
    if (err) { alert(err); return }

    setSaving(true)
    try {
      const bookingCode = await generateBookingCode(selectedMember.phone, selectedDate)
      const scheduledTime = buildDateTime(selectedDate, startTime)

      await db.collection(COLLECTIONS.APPOINTMENTS).add({
        booking_code: bookingCode,
        member_id: selectedMember._id,
        therapist_id: therapistId,
        member_project_id: '',
        scheduled_time: scheduledTime,
        duration_min: duration,
        status: 'pending',
        created_at: new Date(),
        member_name: selectedMember.name,
        project_ids: projectIds,
        project_names: selectedProjects.map((p) => p.name),
      })

      navigate('/appointment/success', { state: { bookingCode, memberName: selectedMember.name } })
    } catch (err) {
      alert('预约失败：' + err.message)
    } finally {
      setSaving(false)
    }
  }

  // eslint-disable-next-line no-unused-vars
  const calendarDays = useMemo(() => {
    const days = []
    for (let i = 0; i <= maxDaysAhead; i++) {
      days.push(dayjs(today).add(i, 'day').format('YYYY-MM-DD'))
    }
    return days
  }, [today, maxDaysAhead])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部 */}
      <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => navigate('/')} className="text-gray-500">← 返回</button>
        <h1 className="text-lg font-bold text-gray-800">新建预约</h1>
        {isShared && operatorName && (
          <button onClick={() => setShowOperatorSwitch(true)} className="flex items-center gap-0.5 text-base font-semibold text-[#0F6B5C]">
            {operatorName}<span className="text-xs text-[#0F6B5C]/70">▾</span>
          </button>
        )}
      </div>

      <div className="p-4 flex flex-col lg:flex-row gap-4">
        {/* 左侧表单 */}
        <div className="bg-white rounded-xl p-4 shadow-sm lg:w-72 shrink-0 space-y-4">

          {/* 日期 */}
          <div>
            <label className="block text-sm text-gray-500 mb-1">日期</label>
            <button
              onClick={() => setShowCalendar(true)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-left text-sm"
            >
              {selectedDate === today ? <span className="text-red-500 font-medium">{selectedDate} （今天）</span> : selectedDate}
            </button>
          </div>

          {/* 会员 */}
          <div>
            <label className="block text-sm text-gray-500 mb-1">会员</label>
            {selectedMember ? (
              <div className="flex items-center justify-between border border-gray-300 rounded-lg px-3 py-2">
                <span className="text-sm">{selectedMember.name} {selectedMember.phone}</span>
                <button onClick={() => { setSelectedMember(null); setMemberSearch('') }}
                  className="text-gray-400 text-xs">✕</button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text" value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  placeholder="搜索姓名或手机号"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                />
                {memberResults.length > 0 && (
                  <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-y-auto">
                    {memberResults.map((m) => (
                      <button key={m._id} onClick={() => { setSelectedMember(m); setMemberSearch(''); setMemberResults([]) }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                        {m.name} <span className="text-gray-400">{m.phone}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 美容师 */}
          <div>
            <label className="block text-sm text-gray-500 mb-1">美容师</label>
            <select value={therapistId} onChange={(e) => setTherapistId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">请选择</option>
              {activeStaff().filter(s => s.role !== 'owner').map((s) => (
                <option key={s._id} value={s._id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* 开始时间 */}
          <div>
            <label className="block text-sm text-gray-500 mb-1">开始时间</label>
            <input
              type="time" value={startTime}
              onChange={(e) => handleTimeInput(e.target.value)}
              step={300}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
            />
          </div>

          {/* 预约项目 */}
          <div>
            <label className="block text-sm text-gray-500 mb-1">预约项目</label>
            {!selectedMember ? (
              <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400">请先选择会员</div>
            ) : loadingProjects ? (
              <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400">加载中...</div>
            ) : memberAvailableProjects.length === 0 ? (
              <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400">该会员暂无可预约项目</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {memberAvailableProjects.map((p) => {
                  const isSelected = projectIds.includes(p._id)
                  return (
                    <button
                      key={p._id}
                      type="button"
                      onClick={() => toggleProject(p._id)}
                      className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                        isSelected
                          ? 'bg-green-500 text-white border-green-500'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-green-400'
                      }`}
                    >
                      {p.name}（{p.duration_min}分钟）
                    </button>
                  )
                })}
              </div>
            )}
            {projectIds.length > 0 && (
              <div className="text-xs text-gray-400 mt-1.5">
                已选 {projectIds.length} 个项目{maxProjects > 0 ? ` / 上限 ${maxProjects}` : ''} · 预计时长 {duration} 分钟
              </div>
            )}
          </div>

          <button
            onClick={handleSubmit} disabled={saving}
            className="w-full py-3 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white rounded-xl font-medium"
          >
            {saving ? '提交中...' : '确认预约'}
          </button>
        </div>

        {/* 右侧栅格 - 所有员工，选中置顶 */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-400 rounded inline-block"></span>已占用</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded inline-block"></span>当前预约</span>
          </div>
          {sortedStaff.map((s) => (
            <div key={s._id} className={`bg-white rounded-xl p-4 shadow-sm ${therapistId === s._id ? 'ring-2 ring-blue-400' : ''}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-gray-700">{s.name}</span>
                {therapistId === s._id && (
                  <span className="text-xs text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full">当前选择</span>
                )}
              </div>
              <TimeGrid
                appointments={appointmentsByStaff[s._id] || []}
                rows={maxRows}
                preview={therapistId === s._id && projectIds.length > 0 ? { startMin, duration } : null}
                onCellClick={(min) => { setTherapistId(s._id); handleCellClick(min) }}
                onAppointmentClick={(appt) => { setSelectedAppt(appt); setConfirmCancel(false) }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* 日历弹窗 */}
      {showCalendar && (
        <CalendarModal
          today={today}
          maxDaysAhead={maxDaysAhead}
          selected={selectedDate}
          onSelect={(d) => { setSelectedDate(d); setShowCalendar(false) }}
          onClose={() => setShowCalendar(false)}
        />
      )}

      {/* 预约详情 / 取消确认弹窗 */}
      {selectedAppt && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          {!confirmCancel ? (
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-lg text-gray-800">预约详情</h3>
                <button onClick={closeApptModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
              </div>
              <div className="space-y-3 text-sm mb-5">
                <div className="flex gap-3">
                  <span className="text-gray-400 w-14 shrink-0">会员</span>
                  <span className="font-medium text-gray-800">{selectedAppt.member_name}</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-gray-400 w-14 shrink-0">开始时间</span>
                  <span className="text-gray-800">{dayjs(selectedAppt.scheduled_time).format('HH:mm')}</span>
                </div>
                <div className="flex gap-3">
                  <span className="text-gray-400 w-14 shrink-0">预约项目</span>
                  <div className="text-gray-800">
                    {selectedAppt.project_names?.length > 0
                      ? <ul className="space-y-0.5">{selectedAppt.project_names.map((n) => <li key={n}>· {n}</li>)}</ul>
                      : '—'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setConfirmCancel(true)}
                className="w-full py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl text-sm font-medium transition-colors"
              >
                取消预约
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
              <p className="text-gray-800 text-base font-medium mb-6">
                是否取消「{selectedAppt.member_name}」在「{dayjs(selectedAppt.scheduled_time).format('HH:mm')}」的预约？
              </p>
              <div className="flex gap-3">
                <button
                  onClick={closeApptModal}
                  className="flex-1 py-2.5 border border-gray-200 rounded-xl text-gray-600 text-sm hover:bg-gray-50"
                >
                  否
                </button>
                <button
                  onClick={handleCancelAppt}
                  disabled={cancelling}
                  className="flex-1 py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-red-300 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  {cancelling ? '取消中...' : '是'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showOperatorSwitch && (
        <OperatorSelector
          onSelect={(s) => { setActiveStaff(s); setShowOperatorSwitch(false) }}
          onCancel={() => setShowOperatorSwitch(false)}
        />
      )}
    </div>
  )
}

function CalendarModal({ today, maxDaysAhead, selected, onSelect, onClose }) {
  const [viewMonth, setViewMonth] = useState(dayjs(today).startOf('month'))
  const maxDate = dayjs(today).add(maxDaysAhead, 'day')

  const daysInMonth = viewMonth.daysInMonth()
  const firstDayOfWeek = viewMonth.startOf('month').day() // 0=Sun
  const weeks = ['日', '一', '二', '三', '四', '五', '六']

  const cells = []
  for (let i = 0; i < firstDayOfWeek; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(viewMonth.date(d).format('YYYY-MM-DD'))
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-2xl p-5 w-80 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => setViewMonth(viewMonth.subtract(1, 'month'))}
            className="text-gray-400 hover:text-gray-600 px-2">‹</button>
          <span className="font-medium">{viewMonth.format('YYYY年M月')}</span>
          <button onClick={() => setViewMonth(viewMonth.add(1, 'month'))}
            className="text-gray-400 hover:text-gray-600 px-2">›</button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-2">
          {weeks.map((w) => (
            <div key={w} className="text-center text-xs text-gray-400">{w}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {cells.map((d, i) => {
            if (!d) return <div key={i} />
            const isToday = d === today
            const isSelected = d === selected
            const isPast = d < today
            const isTooFar = dayjs(d).isAfter(maxDate)
            const disabled = isPast || isTooFar

            return (
              <button
                key={d}
                disabled={disabled}
                onClick={() => onSelect(d)}
                className={`w-full aspect-square rounded-full text-sm flex items-center justify-center transition-colors
                  ${isSelected ? 'bg-red-500 text-white' : ''}
                  ${isToday && !isSelected ? 'ring-2 ring-red-400 text-red-500' : ''}
                  ${disabled ? 'text-gray-200 cursor-not-allowed' : (!isSelected ? 'hover:bg-gray-100' : '')}
                `}
              >
                {dayjs(d).date()}
              </button>
            )
          })}
        </div>

        <button onClick={onClose}
          className="mt-4 w-full py-2 border border-gray-200 rounded-lg text-gray-500 text-sm">
          取消
        </button>
      </div>
    </div>
  )
}

