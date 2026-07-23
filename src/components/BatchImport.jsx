import { useState, useRef } from 'react'
import { parseExcel, downloadTemplate } from '../utils/excelImport'

/**
 * 通用批量导入组件
 *
 * Props:
 *   headers: string[]          Excel 列头
 *   validate: (row, context) => string[]   校验函数，返回错误数组
 *   onImport: (validRows) => Promise<void>  写入数据库
 *   templateFilename: string
 *   context: any               传给 validate 的上下文（已有条形码/手机号集合等）
 */
export default function BatchImport({ headers, validate, onImport, templateFilename, context }) {
  const [results, setResults] = useState([])   // { row, rowIndex, errors, status }
  const [importing, setImporting] = useState(false)
  const [done, setDone] = useState(false)
  const fileRef = useRef(null)

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setDone(false)
    setResults([])

    try {
      const rows = await parseExcel(file)
      const batchPhones = new Set()
      const batchNamePhones = new Set()
      const parsed = rows.map((row, i) => {
        const ctx = context instanceof Set
          ? context
          : { ...context, batchPhones, batchNamePhones }
        const errors = validate(row, ctx)
        if (errors.length === 0 && !(context instanceof Set)) {
          const phone = String(row['手机号'] || '').trim()
          const name = String(row['姓名'] || '').trim()
          if (phone) batchPhones.add(phone)
          if (name && phone) batchNamePhones.add(`${name}\0${phone}`)
        }
        return { row, rowIndex: i + 2, errors, status: errors.length === 0 ? 'ok' : 'error' }
      })
      setResults(parsed)
    } catch (err) {
      alert('文件解析失败：' + err.message)
    }
    e.target.value = ''
  }

  const handleImport = async () => {
    const validRows = results.filter((r) => r.status === 'ok').map((r) => r.row)
    if (validRows.length === 0) return
    setImporting(true)
    try {
      await onImport(validRows)
      setDone(true)
    } catch (err) {
      alert('导入失败：' + err.message)
    } finally {
      setImporting(false)
    }
  }

  const okCount = results.filter((r) => r.status === 'ok').length
  const errCount = results.filter((r) => r.status === 'error').length

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-center">
        <button
          onClick={() => downloadTemplate(headers, templateFilename)}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
        >
          下载模板
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white rounded-lg text-sm"
        >
          选择 Excel 文件
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
      </div>

      {results.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 flex items-center justify-between border-b">
            <span className="text-sm text-gray-600">
              共 {results.length} 行 · <span className="text-green-600">{okCount} 行通过</span>
              {errCount > 0 && <span className="text-red-500 ml-1">· {errCount} 行有误</span>}
            </span>
            {okCount > 0 && !done && (
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-4 py-1.5 bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white rounded text-sm"
              >
                {importing ? '导入中...' : `导入 ${okCount} 行`}
              </button>
            )}
            {done && <span className="text-green-600 text-sm font-medium">✓ 导入完成</span>}
          </div>

          <div className="max-h-64 overflow-y-auto">
            {results.map((r) => (
              <div
                key={r.rowIndex}
                className={`px-4 py-2 text-sm border-b last:border-0 flex items-start gap-3 ${
                  r.status === 'error' ? 'bg-red-50' : 'bg-white'
                }`}
              >
                <span className="text-gray-400 w-10 shrink-0">第{r.rowIndex}行</span>
                <span className="text-gray-600 flex-1 truncate">
                  {headers.map((h) => r.row[h]).filter(Boolean).join(' / ')}
                </span>
                {r.errors.length > 0 ? (
                  <span className="text-red-500 shrink-0">{r.errors.join('；')}</span>
                ) : (
                  <span className="text-green-500 shrink-0">✓</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
