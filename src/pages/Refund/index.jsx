import { useNavigate } from 'react-router-dom'
import TransactionManagement from '../Settings/TransactionManagement/index'

export default function RefundPage() {
  const navigate = useNavigate()
  return <TransactionManagement onBack={() => navigate('/')} />
}
