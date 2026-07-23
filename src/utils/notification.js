import { db } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'

export async function writeNotification(content, type = 'inventory') {
  await db.collection(COLLECTIONS.NOTIFICATIONS).add({ type, content, created_at: new Date() })
  try {
    const res = await db.collection(COLLECTIONS.NOTIFICATIONS)
      .orderBy('created_at', 'desc')
      .limit(100)
      .get()
    if (res.data.length > 50) {
      await Promise.all(
        res.data.slice(50).map((d) => db.collection(COLLECTIONS.NOTIFICATIONS).doc(d._id).remove())
      )
    }
  } catch (_) {}
}
