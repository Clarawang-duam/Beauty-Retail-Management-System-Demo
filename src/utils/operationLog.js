import { db } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'

export async function writeLog(user, module, detail) {
  if (!user) return
  try {
    await db.collection(COLLECTIONS.OPERATION_LOGS).add({
      staff_id: user.uid,
      staff_name: user.name,
      module,
      detail,
      created_at: new Date(),
    })
  } catch (_) {}
}
