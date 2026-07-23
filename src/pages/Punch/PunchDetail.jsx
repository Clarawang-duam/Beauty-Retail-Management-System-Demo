import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import dayjs from 'dayjs'
import app, { db, _, isDemoMode } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import useAuthStore from '../../store/authStore'
import useCacheStore from '../../store/cacheStore'
import { useOperator } from '../../hooks/useOperator'
import { inferAttendance } from '../../utils/attendance'

const TYPE_LABELS = { 上班: '上班打卡', 下班: '下班打卡', 学习: '学习打卡' }

export default function PunchDetail() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const type      = location.state?.type

  const user       = useAuthStore((s) => s.user)
  const { getSetting } = useCacheStore()
  const { operatorId, operatorName, isShared, needsOperator, setActiveStaff } = useOperator()

  const isStudy = type === '学习'

  const [photo,          setPhoto]          = useState(null)
  const [photoPreview,   setPhotoPreview]   = useState(null)
  const [locationText,   setLocationText]   = useState('定位获取中...')
  // 'pending' | 'ok' | 'out_of_range' | 'denied' | 'failed'
  const [locationStatus, setLocationStatus] = useState('pending')
  const [locationData,   setLocationData]   = useState(null)
  const [alreadyPunched, setAlreadyPunched] = useState(false)
  const [saving,         setSaving]         = useState(false)
  const fileInputRef = useRef(null)

  // 若直接访问此路由无 state，回到首页
  useEffect(() => {
    if (!type) navigate('/', { replace: true })
  }, [type])

  // 学习打卡：检查今天是否已打过
  useEffect(() => {
    if (!isStudy || !operatorId) return
    const date = dayjs().format('YYYY-MM-DD')
    db.collection(COLLECTIONS.PUNCH_RECORDS)
      .where({ staff_id: operatorId, type: '学习', date })
      .get()
      .then((res) => { if (res.data.length > 0) setAlreadyPunched(true) })
      .catch(console.error)
  }, [isStudy])

  // 非学习类型：进入页面自动获取定位并校验距离
  useEffect(() => {
    if (isStudy) return

    // 演示模式：直接使用假定位，不调 GPS / 高德
    if (isDemoMode) {
      const storeLat = parseFloat(getSetting('store_lat')) || 31.2304
      const storeLng = parseFloat(getSetting('store_lng')) || 121.4737
      const fake = {
        lat: storeLat,
        lng: storeLng,
        address: '演示门店（模拟定位）',
        distance: 12,
      }
      setLocationData(fake)
      setLocationText(`${fake.address}（距门店 ${fake.distance}m）`)
      setLocationStatus('ok')
      return
    }

    if (!navigator.geolocation) {
      setLocationStatus('failed')
      setLocationText('设备不支持定位，无法打卡')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords
        const amapKey = getSetting('amap_web_key')
        const storeLat = parseFloat(getSetting('store_lat'))
        const storeLng = parseFloat(getSetting('store_lng'))
        const radius = Number(getSetting('checkin_radius')) || 200

        // 逆地理编码（高德 REST API）
        let address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`
        if (amapKey) {
          try {
            const res = await fetch(
              `https://restapi.amap.com/v3/geocode/regeo?location=${lng},${lat}&key=${amapKey}&radius=500&extensions=base&output=JSON`
            )
            const json = await res.json()
            if (json.status === '1' && json.regeocode?.formatted_address) {
              address = json.regeocode.formatted_address
            }
          } catch {
            // 逆地理失败不阻塞打卡，继续用坐标
          }
        }

        // 距离校验（门店坐标未配置则跳过）
        if (!storeLat || !storeLng) {
          setLocationData({ lat, lng, address, distance: null })
          setLocationText(address)
          setLocationStatus('ok')
          return
        }

        const distance = Math.round(haversineDistance(lat, lng, storeLat, storeLng))
        setLocationData({ lat, lng, address, distance })

        if (distance <= radius) {
          setLocationText(`${address}（距门店 ${distance}m）`)
          setLocationStatus('ok')
        } else {
          setLocationText(`距门店 ${distance}m，超出打卡范围（${radius}m）`)
          setLocationStatus('out_of_range')
        }
      },
      (err) => {
        const msg = err.code === 1 ? '已拒绝定位授权，无法打卡' : '获取定位失败，无法打卡'
        setLocationText(msg)
        setLocationStatus(err.code === 1 ? 'denied' : 'failed')
      },
      { timeout: 10000, enableHighAccuracy: true }
    )
  }, [isStudy])

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhoto(file)
    const reader = new FileReader()
    reader.onload = (ev) => setPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  const useDemoPhoto = () => {
    // 1×1 JPEG 占位，满足「已拍照」校验
    const bin = atob(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z'
    )
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const file = new File([bytes], 'demo-punch.jpg', { type: 'image/jpeg' })
    setPhoto(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const handleConfirm = async () => {
    if (needsOperator) { alert('请先返回首页选择操作人'); return }
    if (!isStudy && !photo && !isDemoMode) { alert('请先拍照'); return }
    if (!isStudy && locationStatus !== 'ok') { alert('定位未通过校验，无法打卡'); return }
    setSaving(true)
    try {
      const date = dayjs().format('YYYY-MM-DD')
      const now  = new Date()
      let photoFileId = null

      let photoFile = photo
      if (!isStudy && !photoFile && isDemoMode) {
        const bin = atob(
          '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z'
        )
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        photoFile = new File([bytes], 'demo-punch.jpg', { type: 'image/jpeg' })
      }

      if (!isStudy) {
        const cloudPath = `punch_photos/${user.uid}/${Date.now()}.jpg`
        const uploadRes = await app.uploadFile({ cloudPath, filePath: photoFile })
        photoFileId = uploadRes.fileID
      }

      // 2. 写入打卡记录
      await db.collection(COLLECTIONS.PUNCH_RECORDS).add({
        staff_id:      operatorId,
        type,
        punched_at:    now,
        ...(photoFileId ? { photo_file_id: photoFileId } : {}),
        ...(isStudy ? {} : { location: locationData, location_status: locationStatus }),
        date,
        created_at:    now,
      })

      // 3. 控制照片上限 30 张（仅有照片的打卡类型）
      if (!isStudy) await enforcePhotoLimit(operatorId)

      // 4. 上班/下班打卡 → 更新考勤记录；学习打卡 → 写入 study_punched_at
      if (isStudy) {
        await updateStudyAttendance(operatorId, date, now)
      } else {
        await updateAttendance(operatorId, date, getSetting, locationData, locationStatus)
      }

      alert('打卡成功')
      setActiveStaff(null)
      navigate('/')
    } catch (err) {
      console.error(err)
      alert('打卡失败：' + err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!type) return null

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => navigate('/')} className="text-gray-500">← 返回</button>
        <h1 className="text-lg font-bold text-gray-800">{TYPE_LABELS[type]}</h1>
        {isShared && operatorName && (
          <span className="text-base font-semibold text-[#0F6B5C]">{operatorName}</span>
        )}
      </div>

      <div className="p-6 max-w-md mx-auto space-y-5 pt-8">
        {isStudy ? (
          /* 学习打卡：仅确认按钮 */
          <>
            {alreadyPunched ? (
              <div className="text-center py-12 space-y-2">
                <div className="text-4xl">✅</div>
                <p className="text-gray-600 font-medium">今日已完成学习打卡</p>
              </div>
            ) : (
              <div className="text-center py-12 text-gray-400 text-sm">点击下方按钮完成今日学习打卡</div>
            )}
            <button
              onClick={handleConfirm}
              disabled={alreadyPunched || saving}
              className="w-full py-3.5 bg-blue-500 hover:bg-blue-600 disabled:bg-blue-200 text-white rounded-xl font-medium text-base transition-colors"
            >
              {saving ? '打卡中...' : alreadyPunched ? '今日已打卡' : '确认打卡'}
            </button>
          </>
        ) : (
          /* 上班 / 下班打卡 */
          <>
            {isDemoMode && (
              <div className="rounded-xl bg-sky-50 border border-sky-100 px-3 py-2 text-sky-700 text-xs text-center">
                演示模式：已模拟门店定位；可不拍照，确认时自动使用演示照片
              </div>
            )}
            <p className="text-red-500 text-sm text-center font-medium">
              照片要求包含本人全脸及店铺背景
            </p>

            <div
              onClick={() => fileInputRef.current?.click()}
              className="w-full aspect-[4/3] bg-gray-100 rounded-2xl flex items-center justify-center cursor-pointer overflow-hidden border-2 border-dashed border-gray-300 hover:border-pink-400 transition-colors"
            >
              {photoPreview ? (
                <img src={photoPreview} alt="punch" className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-gray-400">
                  <span className="text-5xl">📷</span>
                  <span className="text-sm">点击拍照</span>
                </div>
              )}
            </div>

            <input
              type="file"
              accept="image/*"
              capture="environment"
              ref={fileInputRef}
              onChange={handlePhotoSelect}
              className="hidden"
            />

            {isDemoMode && !photoPreview && (
              <button
                type="button"
                onClick={useDemoPhoto}
                className="w-full py-2 text-sm text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-xl border border-sky-100"
              >
                使用演示照片
              </button>
            )}

            <div className="bg-white rounded-xl p-4 shadow-sm flex items-start gap-3">
              <span className="text-xl mt-0.5">📍</span>
              <div>
                <div className="text-xs text-gray-400 mb-0.5">当前位置</div>
                <div className={`text-sm break-all ${
                  locationStatus === 'ok'      ? 'text-green-600' :
                  locationStatus === 'pending' ? 'text-gray-400'  : 'text-red-500'
                }`}>{locationText}</div>
              </div>
            </div>

            <button
              onClick={handleConfirm}
              disabled={(!photo && !isDemoMode) || saving || locationStatus !== 'ok'}
              className="w-full py-3.5 bg-pink-500 hover:bg-pink-600 disabled:bg-pink-200 text-white rounded-xl font-medium text-base transition-colors"
            >
              {saving ? '打卡中...' : '确认打卡'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

// ——— 辅助函数 ———

async function enforcePhotoLimit(staffId) {
  try {
    const res = await db.collection(COLLECTIONS.PUNCH_RECORDS)
      .where({ staff_id: staffId })
      .orderBy('punched_at', 'asc')
      .limit(200)
      .get()

    const withPhotos = res.data.filter((r) => r.photo_file_id)
    if (withPhotos.length <= 30) return

    const toDelete = withPhotos.slice(0, withPhotos.length - 30)
    const fileIds  = toDelete.map((r) => r.photo_file_id).filter(Boolean)

    if (fileIds.length) await app.deleteFile({ fileList: fileIds })

    for (const r of toDelete) {
      await db.collection(COLLECTIONS.PUNCH_RECORDS).doc(r._id).update({ photo_file_id: null })
    }
  } catch (err) {
    console.error('enforcePhotoLimit:', err)
  }
}

async function getScheduledShift(staffId, date) {
  try {
    const schRes = await db.collection(COLLECTIONS.SHIFT_SCHEDULES)
      .where({ staff_id: staffId, date })
      .get()
    if (schRes.data.length > 0) return schRes.data[0].shift

    const rotRes = await db.collection(COLLECTIONS.SHIFT_ROTATIONS)
      .where({ staff_id: staffId })
      .get()
    if (!rotRes.data.length) return null

    const rot = rotRes.data[0]
    if (!rot.start_date || !rot.cycle_days || !rot.pattern?.length) return null
    const diff = dayjs(date).diff(dayjs(rot.start_date), 'day')
    if (diff < 0) return null
    return rot.pattern[diff % rot.cycle_days] || null
  } catch {
    return null
  }
}

async function updateStudyAttendance(staffId, date, now) {
  const existing = await db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
    .where({ staff_id: staffId, date })
    .get()

  if (existing.data.length > 0) {
    await db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
      .doc(existing.data[0]._id)
      .update({ study_punched_at: now })
  } else {
    await db.collection(COLLECTIONS.ATTENDANCE_RECORDS).add({
      staff_id: staffId,
      date,
      study_punched_at: now,
      created_at: now,
    })
  }
}

async function updateAttendance(staffId, date, getSetting, locationData, locationStatus) {
  const [punchRes, scheduledShift] = await Promise.all([
    db.collection(COLLECTIONS.PUNCH_RECORDS)
      .where({ staff_id: staffId, date, type: _.in(['上班', '下班']) })
      .get(),
    getScheduledShift(staffId, date),
  ])

  const sorted   = punchRes.data.filter(p => !p.is_pending).sort((a, b) => new Date(a.punched_at) - new Date(b.punched_at))
  const clockIn  = sorted.find(p => p.type === '上班')?.punched_at || null
  const clockOut = [...sorted].reverse().find(p => p.type === '下班')?.punched_at || null

  const { actual_shift, status } = inferAttendance(clockIn, clockOut, getSetting, scheduledShift)

  const existing = await db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
    .where({ staff_id: staffId, date })
    .get()

  const payload = {
    clock_in: clockIn, clock_out: clockOut, planned_shift: scheduledShift, actual_shift, status,
    ...(locationData ? { location: locationData, location_status: locationStatus } : {}),
  }

  if (existing.data.length > 0) {
    await db.collection(COLLECTIONS.ATTENDANCE_RECORDS)
      .doc(existing.data[0]._id)
      .update(payload)
  } else {
    await db.collection(COLLECTIONS.ATTENDANCE_RECORDS).add({
      ...payload,
      staff_id:   staffId,
      date,
      created_at: new Date(),
    })
  }
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
