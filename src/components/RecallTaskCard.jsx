import { useState } from 'react'
import {
  generateTaskScript,
  markTaskContacted,
  markTaskDismissed,
  loadRecallTask,
} from '../services/recallService'
import useCacheStore from '../store/cacheStore'
import useAuthStore from '../store/authStore'
import { useOperator } from '../hooks/useOperator'

function relativeTime(date) {
  if (!date) return ''
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins}分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}小时前`
  return `${Math.floor(hours / 24)}天前`
}

export default function RecallTaskCard({ item, onUpdate }) {
  const user = useAuthStore((s) => s.user)
  const { getSetting } = useCacheStore()
  const { operatorId, operatorName } = useOperator()

  const [expanded, setExpanded] = useState(false)
  const [script, setScript] = useState('')
  const [loadingScript, setLoadingScript] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [copied, setCopied] = useState(false)

  const taskStatus = item.task_status || 'pending'
  const isDone = taskStatus === 'contacted' || taskStatus === 'dismissed' || taskStatus === 'converted'

  const handleViewScript = async () => {
    if (expanded && script) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    if (script) return

    setLoadingScript(true)
    try {
      const task = await loadRecallTask(item.recall_task_id)
      if (!task) {
        setScript('任务不存在或已删除')
        return
      }
      const text = await generateTaskScript(task, getSetting)
      setScript(text)
    } catch (err) {
      setScript('话术生成失败：' + err.message)
    } finally {
      setLoadingScript(false)
    }
  }

  const handleCopy = async () => {
    if (!script) return
    try {
      await navigator.clipboard.writeText(script)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      alert('复制失败，请手动选择文本复制')
    }
  }

  const handleContacted = async () => {
    setProcessing(true)
    try {
      await markTaskContacted({
        taskId: item.recall_task_id,
        user,
        operatorId,
        operatorName,
      })
      onUpdate(item._id, { task_status: 'contacted' })
    } catch (err) {
      alert('操作失败：' + err.message)
    } finally {
      setProcessing(false)
    }
  }

  const handleDismiss = async () => {
    setProcessing(true)
    try {
      await markTaskDismissed({ taskId: item.recall_task_id, user })
      onUpdate(item._id, { task_status: 'dismissed' })
    } catch (err) {
      alert('操作失败：' + err.message)
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50">
      <div className="flex items-start gap-2">
        <span className="text-base mt-0.5 shrink-0">📣</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-700 leading-relaxed">{item.content}</p>
          <p className="text-xs text-gray-400 mt-1">{relativeTime(item.created_at)}</p>

          {isDone ? (
            <span className={`inline-block mt-2 text-xs font-medium ${
              taskStatus === 'contacted' || taskStatus === 'converted' ? 'text-green-600' : 'text-gray-400'
            }`}>
              {taskStatus === 'contacted' && '✓ 已联系'}
              {taskStatus === 'converted' && '✓ 已召回成功'}
              {taskStatus === 'dismissed' && '已忽略'}
            </span>
          ) : (
            <div className="mt-2 space-y-2">
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleViewScript}
                  disabled={loadingScript}
                  className="px-3 py-1.5 bg-pink-500 hover:bg-pink-600 disabled:bg-pink-200 text-white text-xs rounded-lg font-medium"
                >
                  {loadingScript ? '生成中...' : expanded ? '收起话术' : '查看话术'}
                </button>
                <button
                  onClick={handleContacted}
                  disabled={processing}
                  className="px-3 py-1.5 bg-green-500 hover:bg-green-600 disabled:bg-green-200 text-white text-xs rounded-lg font-medium"
                >
                  已联系
                </button>
                <button
                  onClick={handleDismiss}
                  disabled={processing}
                  className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-600 text-xs rounded-lg font-medium"
                >
                  暂不理会
                </button>
              </div>

              {expanded && (
                <div className="bg-pink-50 border border-pink-100 rounded-lg p-3">
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{script || '加载中...'}</p>
                  {script && (
                    <button
                      onClick={handleCopy}
                      className="mt-2 text-xs text-pink-600 hover:text-pink-800 font-medium"
                    >
                      {copied ? '已复制' : '复制话术'}
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
