import app from '../lib/cloudbase'

// Upload a File object to CloudBase Storage, return { fileID, previewUrl }
export async function uploadImage(file, folder) {
  const ext = file.name.split('.').pop().toLowerCase() || 'jpg'
  const cloudPath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`
  const { fileID } = await app.uploadFile({ cloudPath, filePath: file })
  const { fileList } = await app.getTempFileURL({ fileList: [fileID] })
  return { fileID, previewUrl: fileList[0]?.tempFileURL || '' }
}

// Batch convert fileIDs to temp URLs: returns { [fileID]: url }
export async function batchGetUrls(fileIDs) {
  const ids = fileIDs.filter(Boolean)
  if (!ids.length) return {}
  const { fileList } = await app.getTempFileURL({ fileList: ids })
  const map = {}
  fileList.forEach(f => { map[f.fileID] = f.tempFileURL || '' })
  return map
}
