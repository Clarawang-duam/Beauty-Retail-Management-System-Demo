import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import useAuthStore from '../../store/authStore'
import { usePermission } from '../../hooks/usePermission'
import { useOperator } from '../../hooks/useOperator'
import { db } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import useCacheStore from '../../store/cacheStore'
import NotificationPanel from '../../components/NotificationPanel'
import OperatorSelector from '../../components/OperatorSelector'
import { runDailyRecallScan } from '../../services/recallService'
import { isDemoMode } from '../../lib/cloudbase'

function parseBirthdayMD(birthday) {
  if (!birthday) return null
  const s = String(birthday).trim()
  let m = s.match(/\d{4}[-/.年](\d{1,2})[-/.月](\d{1,2})/)
  if (m) return { month: +m[1], day: +m[2] }
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/)
  if (m) return { month: +m[1], day: +m[2] }
  m = s.match(/(\d{1,2})月(\d{1,2})/)
  if (m) return { month: +m[1], day: +m[2] }
  return null
}

const ENTRY_CARDS = [
  { path: '/appointment', title: '预约', image: '/entry-appointment.png' },
  { path: '/checkout', title: '手工', image: '/entry-checkout.png' },
  { path: '/sales', title: '销售', image: '/entry-sales.png' },
]

const PUNCH_TYPES = [
  { type: '上班', label: '上班打卡' },
  { type: '下班', label: '下班打卡' },
  { type: '学习', label: '学习打卡' },
]

export default function HomePage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { isOwner, canEditSettings } = usePermission()
  const { isShared, operatorName, needsOperator, setActiveStaff } = useOperator()

  const { members, getSetting, refreshCache, initialized } = useCacheStore()

  const [hasUnread, setHasUnread] = useState(false)
  const [showPanel, setShowPanel] = useState(false)
  const [showOperatorSelector, setShowOperatorSelector] = useState(false)
  const [showPunchMenu, setShowPunchMenu] = useState(false)
  const punchMenuRef = useRef(null)

  useEffect(() => {
    if (needsOperator) setShowOperatorSelector(true)
  }, [needsOperator])

  useEffect(() => {
    if (!showPunchMenu) return
    const onPointerDown = (e) => {
      if (punchMenuRef.current && !punchMenuRef.current.contains(e.target)) {
        setShowPunchMenu(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [showPunchMenu])

  useEffect(() => {
    if (members.length === 0) refreshCache('members')
  }, [])

  // 每日开店扫描：生成召回任务并推送铃铛
  useEffect(() => {
    if (!user?.uid || !initialized) return
    runDailyRecallScan({ getSetting, user, refreshCache })
      .then((res) => {
        if (res?.created > 0) setHasUnread(true)
      })
      .catch((err) => console.error('召回扫描失败', err))
  }, [user?.uid, initialized])

  const birthdayThisWeek = useMemo(() => {
    const birthdayEnabled = getSetting('member_fields', { birthday: true }).birthday
    if (!birthdayEnabled) return []
    const today = dayjs().startOf('day')
    return members
      .filter(m => {
        const bd = parseBirthdayMD(m.birthday)
        if (!bd) return false
        for (let i = 0; i < 7; i++) {
          const d = today.add(i, 'day')
          if (d.month() + 1 === bd.month && d.date() === bd.day) return true
        }
        return false
      })
      .map(m => {
        const bd = parseBirthdayMD(m.birthday)
        let daysUntil = 0
        for (let i = 0; i < 7; i++) {
          const d = today.add(i, 'day')
          if (d.month() + 1 === bd.month && d.date() === bd.day) { daysUntil = i; break }
        }
        return { ...m, daysUntil }
      })
      .sort((a, b) => a.daysUntil - b.daysUntil)
  }, [members])

  useEffect(() => {
    if (!user?.uid) return
    db.collection(COLLECTIONS.NOTIFICATIONS)
      .orderBy('created_at', 'desc')
      .limit(1)
      .get()
      .then((res) => {
        if (!res.data.length) return
        const lastRead = localStorage.getItem('notif_last_read_' + user.uid)
        if (!lastRead || new Date(res.data[0].created_at) > new Date(lastRead)) {
          setHasUnread(true)
        }
      })
      .catch(() => {})
  }, [user?.uid])

  const handleBellClick = () => {
    setShowPanel(true)
    setHasUnread(false)
    localStorage.setItem('notif_last_read_' + user.uid, new Date().toISOString())
  }

  return (
    <div className="br-home">
      <div className="br-home-layer">
      {/* 顶部栏 */}
      <div className="br-home-topbar px-4 py-3 flex items-center justify-between relative sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="relative" ref={punchMenuRef}>
            <button
              type="button"
              onClick={() => setShowPunchMenu((v) => !v)}
              className="br-cta-pill"
              aria-expanded={showPunchMenu}
              aria-haspopup="menu"
            >
              打卡
            </button>
            {showPunchMenu && (
              <div
                role="menu"
                className="absolute left-0 top-full mt-2 z-30 min-w-[11rem] rounded-xl bg-white/95 backdrop-blur-md shadow-lg border border-black/5 py-2 overflow-hidden"
              >
                {PUNCH_TYPES.map(({ type, label }) => (
                  <button
                    key={type}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setShowPunchMenu(false)
                      navigate('/punch/detail', { state: { type } })
                    }}
                    className="w-full text-left px-5 py-3.5 text-base font-semibold text-[var(--br-text)] hover:bg-[#40C8B8]/12 hover:text-[#40C8B8] transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {isShared ? (
            <button
              type="button"
              onClick={() => setShowOperatorSelector(true)}
              className={`font-semibold text-base ${needsOperator ? 'text-amber-600' : 'text-[#0F6B5C]'}`}
            >
              {needsOperator ? '请选择操作人' : operatorName}
            </button>
          ) : (
            <span className="text-[var(--br-text-secondary)] text-sm">{user?.name}</span>
          )}
          {isOwner && (
            <span className="text-xs bg-white/70 text-[var(--br-text-secondary)] border border-black/5 px-2 py-0.5 rounded-full">
              老板
            </span>
          )}
          {isDemoMode && (
            <span className="text-xs bg-sky-50 text-sky-700 border border-sky-200 px-2 py-0.5 rounded-full font-medium">
              演示模式
            </span>
          )}
        </div>

        {/* 铃铛：绝对居中 */}
        <button
          type="button"
          onClick={handleBellClick}
          className="absolute left-1/2 -translate-x-1/2 w-9 h-9 flex items-center justify-center rounded-full hover:bg-black/5 transition-colors"
          aria-label="消息通知"
        >
          <span className="text-xl">🔔</span>
          {hasUnread && (
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white" />
          )}
        </button>

        <div className="flex items-center gap-2">
          {canEditSettings && (
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="br-cta-pill"
            >
              设置
            </button>
          )}
        </div>
      </div>

      {/* 三大功能入口（居中）；生日卡绝对贴左，不挤占主区 */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-6 gap-4 py-4">
        {birthdayThisWeek.length > 0 && (
          <aside className="br-birthday-side" aria-label="本周生日会员">
            <div className="text-sm font-medium text-[var(--br-text-secondary)] mb-2">本周生日会员</div>
            <div className="flex flex-col gap-2 max-h-[min(52vh,28rem)] overflow-y-auto pr-0.5">
              {birthdayThisWeek.map(m => (
                <div
                  key={m._id}
                  className="flex flex-col gap-0.5 bg-white/70 border border-black/5 rounded-xl px-3 py-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {m.daysUntil === 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--br-accent)] shrink-0" />
                    )}
                    <span className="text-sm text-[var(--br-text)] font-medium truncate">{m.name}</span>
                    <span className={`ml-auto shrink-0 text-xs ${m.daysUntil === 0 ? 'text-[var(--br-accent)] font-medium' : 'text-[var(--br-text-muted)]'}`}>
                      {m.daysUntil === 0 ? '今天' : `${m.daysUntil}天后`}
                    </span>
                  </div>
                  {m.phone && (
                    <span className="text-xs text-[var(--br-text-muted)] pl-3.5">{m.phone}</span>
                  )}
                </div>
              ))}
            </div>
          </aside>
        )}

        <div className="grid grid-cols-3 gap-6 w-full max-w-4xl">
          {ENTRY_CARDS.map(({ path, title, image }) => (
            <button
              key={path}
              type="button"
              onClick={() => navigate(path)}
              className="br-stat-card br-stat-card--illust"
              aria-label={title}
            >
              <img src={image} alt="" className="br-stat-illust" draggable={false} />
            </button>
          ))}
        </div>

        <div className={`w-full max-w-4xl mt-4 ${isOwner ? 'grid grid-cols-2' : 'flex justify-center'}`}>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => navigate('/schedule')}
              className="br-text-link"
            >
              员工看板
              <span aria-hidden>→</span>
            </button>
          </div>
          {isOwner && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => navigate('/dashboard')}
                className="br-text-link"
              >
                老板看板
                <span aria-hidden>→</span>
              </button>
            </div>
          )}
        </div>
      </div>
      </div>

      {showPanel && <NotificationPanel onClose={() => setShowPanel(false)} />}
      {showOperatorSelector && (
        <OperatorSelector
          onSelect={(s) => { setActiveStaff(s); setShowOperatorSelector(false) }}
          onCancel={() => setShowOperatorSelector(false)}
        />
      )}
    </div>
  )
}
