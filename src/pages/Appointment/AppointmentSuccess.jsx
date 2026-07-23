import { useNavigate, useLocation } from 'react-router-dom'

export default function AppointmentSuccess() {
  const navigate = useNavigate()
  const { state } = useLocation()
  const { bookingCode, memberName } = state || {}

  return (
    <div className="min-h-screen bg-blue-50 flex flex-col items-center justify-center px-6">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">✅</div>
        <div className="text-gray-500 text-sm mb-2">预约成功</div>
        {memberName && (
          <div className="text-gray-600 text-sm mb-4">{memberName}</div>
        )}
        <div className="text-gray-400 text-sm mb-2">预约号</div>
        <div className="text-6xl font-bold text-blue-600 tracking-widest mb-8">
          {bookingCode || '----'}
        </div>
        <button
          onClick={() => navigate('/')}
          className="w-full py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-medium"
        >
          回到首页
        </button>
      </div>
    </div>
  )
}
