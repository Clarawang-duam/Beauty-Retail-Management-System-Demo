/**
 * 批量导入校验规则
 * validate(row) 返回 null（通过）或错误信息字符串
 */

export const PRODUCT_HEADERS = ['商品名称', '供应商', '品类', '规格', '条形码', '进货价', '销售价', '不计入业绩']
export const PRODUCT_KEYS = ['name', 'category', 'type', 'spec', 'barcode', 'purchase_price', 'sale_price', 'exclude_from_sales']

export const PROJECT_HEADERS = ['项目名称', '大类', '单次时长(分钟)', '规定次数', '最多手工次数', '销售价', '促销价', '功效描述']
export const PROJECT_KEYS = ['name', 'category', 'duration_min', 'total_sessions', 'max_sessions', 'price', 'promo_price', 'efficacy']

export const INVENTORY_HEADERS = ['商品名称', '数量', '保质期']
export const INVENTORY_KEYS = ['product_name', 'quantity', 'expiry_date']

export const MEMBER_HEADERS = ['姓名', '手机号', '积分', '生日', '性别', '肤质', '过敏史', '备注']
export const MEMBER_KEYS = ['name', 'phone', 'points', 'birthday', 'gender', 'skin_type', 'allergy', 'notes']

function required(value, fieldName) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return `${fieldName}不能为空`
  }
  return null
}

function isPositiveNumber(value, fieldName) {
  if (isNaN(Number(value)) || Number(value) < 0) {
    return `${fieldName}必须为非负数字`
  }
  return null
}

export function validateProduct(row, existingBarcodes = new Set()) {
  const errors = []
  const e = (msg) => errors.push(msg)

  const nameErr = required(row['商品名称'], '商品名称')
  if (nameErr) e(nameErr)

  const priceErr = required(row['销售价'], '销售价')
  if (priceErr) e(priceErr)
  else {
    const numErr = isPositiveNumber(row['销售价'], '销售价')
    if (numErr) e(numErr)
  }

  const barcode = String(row['条形码'] || '').trim()
  if (!barcode) {
    e('条形码不能为空')
  } else if (existingBarcodes.has(barcode)) {
    e(`条形码 ${barcode} 重复`)
  }

  return errors
}

export function validateProject(row) {
  const errors = []
  const e = (msg) => errors.push(msg)

  for (const field of ['项目名称', '大类', '规定次数', '最多手工次数', '单次时长(分钟)']) {
    const err = required(row[field], field)
    if (err) e(err)
  }

  const total = Number(row['规定次数'])
  const max = Number(row['最多手工次数'])
  if (!isNaN(total) && !isNaN(max) && max < total) {
    e(`最多手工次数(${max})必须 >= 规定次数(${total})`)
  }

  return errors
}

export function validateInventory(row, productNameSet = new Set()) {
  const errors = []
  const e = (msg) => errors.push(msg)

  const nameErr = required(row['商品名称'], '商品名称')
  if (nameErr) e(nameErr)
  else if (!productNameSet.has(String(row['商品名称']).trim())) {
    e(`商品"${row['商品名称']}"不在商品目录中，请先录入商品`)
  }

  const qtyErr = required(row['数量'], '数量')
  if (qtyErr) e(qtyErr)
  else {
    const numErr = isPositiveNumber(row['数量'], '数量')
    if (numErr) e(numErr)
  }

  return errors
}

/**
 * @param {object} ctx
 * @param {Set<string>} [ctx.existingPhones] 库内已有手机号
 * @param {Set<string>} [ctx.batchPhones] 本批文件中已出现的手机号（可变，按行累加）
 * @param {Set<string>} [ctx.batchNamePhones] 本批文件中已出现的「姓名+手机号」（可变）
 */
export function validateMember(row, ctx = {}) {
  const errors = []
  const e = (msg) => errors.push(msg)

  const existingPhones = ctx instanceof Set ? ctx : (ctx.existingPhones || new Set())
  const batchPhones = ctx instanceof Set ? null : ctx.batchPhones
  const batchNamePhones = ctx instanceof Set ? null : ctx.batchNamePhones

  const name = String(row['姓名'] || '').trim()
  const nameErr = required(row['姓名'], '姓名')
  if (nameErr) e(nameErr)

  const phone = String(row['手机号'] || '').trim()
  if (!phone) {
    e('手机号不能为空')
  } else {
    if (existingPhones.has(phone)) {
      e(`手机号 ${phone} 已在会员库中存在`)
    }
    if (batchPhones?.has(phone)) {
      e(`文件中手机号 ${phone} 重复`)
    }
    const namePhoneKey = `${name}\0${phone}`
    if (name && batchNamePhones?.has(namePhoneKey)) {
      e(`文件中姓名与手机号组合重复（${name} / ${phone}）`)
    }
  }

  return errors
}
