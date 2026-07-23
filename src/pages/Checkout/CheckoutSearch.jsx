import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import dayjs from 'dayjs'
import { useOperator } from '../../hooks/useOperator'
import OperatorSelector from '../../components/OperatorSelector'

export default function CheckoutSearch() {
  const navigate = useNavigate()
  const { isShared, operatorName, setActiveStaff } = useOperator()
  const [showOperatorSwitch, setShowOperatorSwitch] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleChange = async (val) => {
    const v = val.replace(/\D/g, '').slice(0, 5)
    setCode(v)
    setError('')
    if (v.length === 4 || v.length === 5) {
      await lookup(v)
    }
  }

  const lookup = async (bookingCode) => {
    setLoading(true)
    try {
      // 查当日预约
      const dayStart = dayjs().startOf('day').toDate()
      const dayEnd = dayjs().endOf('day').toDate()
      const res = await db.collection(COLLECTIONS.APPOINTMENTS)
        .where({
          booking_code: bookingCode,
          scheduled_time: db.command.gte(dayStart).and(db.command.lte(dayEnd)),
          status: db.command.neq('cancelled'),
        })
        .get()

      if (res.data.length === 0) {
        setError('预约号不存在')
        return
      }

      const appt = res.data[0]
      // 拉会员和美容师信息
      const [mRes, sRes] = await Promise.all([
        db.collection(COLLECTIONS.MEMBERS).doc(appt.member_id).get(),
        db.collection(COLLECTIONS.STAFF).doc(appt.therapist_id).get(),
      ])

      navigate('/checkout/detail', {
        state: {
          appointment: appt,
          member: mRes.data?.[0] || null,
          therapist: sRes.data?.[0] || null,
        },
      })
    } catch (err) {
      setError('查询失败：' + err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="br-checkout">
      <div className="br-checkout-layer">
      <div className="px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate('/')} className="text-gray-500">← 返回</button>
        <h1 className="text-lg font-bold text-gray-800">手工核销</h1>
        {isShared && operatorName && (
          <button onClick={() => setShowOperatorSwitch(true)} className="flex items-center gap-0.5 text-base font-semibold text-[#0F6B5C]">
            {operatorName}<span className="text-xs text-[#0F6B5C]/70">▾</span>
          </button>
        )}
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg p-8 w-full max-w-sm text-center">
          <div className="text-gray-500 text-sm mb-6">输入预约号（4位或5位）</div>

          <input
            type="tel"
            value={code}
            onChange={(e) => handleChange(e.target.value)}
            maxLength={5}
            placeholder="请输入预约号"
            className="w-full text-center text-4xl font-bold tracking-widest border-b-2 border-gray-300 focus:border-blue-500 outline-none py-3 mb-4 bg-transparent"
            autoFocus
          />

          {loading && <div className="text-gray-400 text-sm">查询中...</div>}
          {error && <div className="text-red-500 text-sm mt-2">{error}</div>}

          {!loading && !error && code.length > 0 && code.length < 4 && (
            <div className="text-gray-300 text-sm">还需 {4 - code.length} 位</div>
          )}
        </div>
      </div>
      </div>

      {showOperatorSwitch && (
        <OperatorSelector
          onSelect={(s) => { setActiveStaff(s); setShowOperatorSwitch(false) }}
          onCancel={() => setShowOperatorSwitch(false)}
        />
      )}
    </div>
  )
}
