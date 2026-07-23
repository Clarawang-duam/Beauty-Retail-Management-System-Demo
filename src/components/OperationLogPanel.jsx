import { useState, useEffect } from 'react'
import dayjs from 'dayjs'
import { db, _ } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'

export default function OperationLogPanel({ module, refreshTrigger }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const since = dayjs().subtract(30, 'day').toDate()
      const res = await db.collection(COLLECTIONS.OPERATION_LOGS)
        .where({ module, created_at: _.gte(since) })
        .orderBy('created_at', 'desc')
        .limit(200)
        .get()
        .catch(() => ({ data: [] }))
      setLogs(res.data)
      setLoading(false)
    }
    load()
  }, [module, refreshTrigger])

  return (
    <div className="bg-white rounded-xl shadow-sm p-4 sticky top-4">
      <h3 className="font-semibold text-gray-700 text-sm mb-3">操作记录（近30天）</h3>
      {loading ? (
        <div className="text-gray-400 text-xs py-4 text-center">加载中...</div>
      ) : logs.length === 0 ? (
        <div className="text-gray-400 text-xs py-4 text-center">暂无记录</div>
      ) : (
        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          {logs.map((log) => (
            <div key={log._id} className="text-xs border-b border-gray-100 pb-2 last:border-0">
              <div className="text-gray-400">{dayjs(log.created_at).format('MM-DD HH:mm')}</div>
              <div className="text-gray-700 mt-0.5">
                <span className="font-medium text-gray-800">{log.staff_name}</span>
                {' '}{log.detail}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
