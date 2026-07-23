/**
 * 商品条形码重复检测。
 * @param {string} excludeId 编辑时排除当前商品 _id
 */
export function findDuplicateProduct(barcode, productList, excludeId = null) {
  const code = String(barcode || '').trim()
  if (!code) return null

  const list = excludeId
    ? productList.filter((p) => p._id !== excludeId)
    : productList

  const existing = list.find((p) => String(p.barcode || '').trim() === code)
  return existing ? { product: existing } : null
}
