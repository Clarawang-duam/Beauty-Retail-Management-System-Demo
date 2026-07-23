import * as XLSX from 'xlsx'

/**
 * 从 Excel 文件解析数据，返回对象数组
 * @param {File} file
 * @returns {Promise<Array>}
 */
export function parseExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result)
        const workbook = XLSX.read(data, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        resolve(rows)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

/**
 * 生成 Excel 模板并下载
 * @param {string[]} headers - 列头
 * @param {string} filename
 */
export function downloadTemplate(headers, filename) {
  const ws = XLSX.utils.aoa_to_sheet([headers])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}

/**
 * 导出数据为 Excel
 * @param {Array<Object>} data
 * @param {string[]} headers - 表头（顺序固定）
 * @param {string[]} keys - 对应数据字段名
 * @param {string} filename
 */
export function exportToExcel(data, headers, keys, filename) {
  const rows = data.map((item) => keys.map((k) => item[k] ?? ''))
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}
