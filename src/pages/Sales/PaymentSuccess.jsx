import { useNavigate, useLocation } from 'react-router-dom'

export default function PaymentSuccess() {
  const navigate = useNavigate()
  const { state } = useLocation()

  return (
    <div className="min-h-screen bg-orange-50 flex flex-col items-center justify-center px-6">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm text-center">
        <div className="text-5xl mb-4">🎉</div>
        <div className="text-2xl font-bold text-orange-600 mb-2">支付成功</div>
        {state?.memberName && (
          <div className="text-gray-500 text-sm mb-4">{state.memberName}</div>
        )}
        <button
          onClick={() => navigate('/')}
          className="mt-6 w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-medium"
        >
          回到首页
        </button>
      </div>
    </div>
  )
}
