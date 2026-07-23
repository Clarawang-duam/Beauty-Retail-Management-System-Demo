import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../../lib/cloudbase'
import { COLLECTIONS } from '../../lib/collections'
import useCacheStore from '../../store/cacheStore'
import useAuthStore from '../../store/authStore'
import { useOperator } from '../../hooks/useOperator'
import OperatorSelector from '../../components/OperatorSelector'
import { toArray } from '../../utils/array'
import { computePromoSubtotal, computePromoDiscount } from '../../domain/promo'
import { computeDeductions, roundPayable } from '../../domain/payment'
import { checkAvailable } from '../../services/inventoryService'
import { checkout } from '../../services/salesService'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { writeLog } from '../../utils/operationLog'
import { calcChange } from '../../utils/paymentMethods'
import { findDuplicateMember } from '../../utils/memberDuplicate'

export default function SalesPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const { products, projects, getSetting, members, refreshCache } = useCacheStore()
  const { operatorId, operatorName, isShared, needsOperator, setActiveStaff } = useOperator()
  const [showOperatorSwitch, setShowOperatorSwitch] = useState(false)

  const [memberSearch, setMemberSearch] = useState('')
  const [memberResults, setMemberResults] = useState([])
  const [selectedMember, setSelectedMember] = useState(null)

  const [searchInput, setSearchInput] = useState('')
  const [searchResults, setSearchResults] = useState(null)  // null = 未搜索，[] = 无结果
  const [searchError, setSearchError] = useState('')
  const [cartItems, setCartItems] = useState([])   // { product, discount, amount }
  const [showPayment, setShowPayment] = useState(false)
  const [saving, setSaving] = useState(false)
  const [presaleWarnings, setPresaleWarnings] = useState([])
  const [presaleProductIds, setPresaleProductIds] = useState(new Set())
  const [selectedPromo, setSelectedPromo] = useState(null)
  const [showScanner, setShowScanner] = useState(false)
  const [scanToast, setScanToast] = useState(null)
  const [pointsInput, setPointsInput] = useState('')
  const [showAddMember, setShowAddMember] = useState(false)
  const [addMemberSaving, setAddMemberSaving] = useState(false)
  const [duplicateMember, setDuplicateMember] = useState(null)
  const EMPTY_ADD_FORM = { name: '', phone: '', points: 0, birthday: '', gender: '', skin_type: '', allergy: '', notes: '' }
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM)
  const [supplement, setSupplement] = useState('')
  const [balanceInput, setBalanceInput] = useState('')
  const [payBalance, setPayBalance] = useState(false)
  const [payCash, setPayCash] = useState(false)
  const [payScan, setPayScan] = useState(false)
  const [cashInput, setCashInput] = useState('')
  const [cashTendered, setCashTendered] = useState('')
  const [scanTendered, setScanTendered] = useState('')
  const [showTopup, setShowTopup] = useState(false)
  const [topupAmount, setTopupAmount] = useState('')
  const [topupSaving, setTopupSaving] = useState(false)
  const [topupPayCash, setTopupPayCash] = useState(false)
  const [topupPayScan, setTopupPayScan] = useState(false)
  const [topupCashInput, setTopupCashInput] = useState('')
  const [giftMaterials, setGiftMaterials] = useState([])
  const [selectedGift, setSelectedGift] = useState(null) // gift_materials record
  const [giftQty, setGiftQty] = useState(1)
  const [giftReason, setGiftReason] = useState('满额赠品')
  const videoRef = useRef(null)
  const scannerControlsRef = useRef(null)
  const lastScanTimeRef = useRef(0)
  const WALK_IN_PROJECT = { _id: 'WALK_IN', name: '散客' }
  const TAKE_AWAY_PROJECT = { _id: 'TAKE_AWAY', name: '拿走' }

  const enabledPromos = toArray(getSetting('promotions', [])).filter(Boolean).filter((p) => p.enabled)
  const pointsEnabled = getSetting('points_enabled', false)
  const pointsEarnRate = Number(getSetting('points_earn_rate', 1)) || 1
  const pointsRedeemRate = Number(getSetting('points_redeem_rate', 100)) || 100
  const balanceEnabled = getSetting('balance_enabled', false)
  const balanceTiers = toArray(getSetting('balance_topup_tiers', []))
  const memberBalance = selectedMember?.balance ?? 0

  const computeTopupBonus = (amount) => {
    const sorted = [...balanceTiers].filter(t => t && Number(t.min_amount) > 0).sort((a, b) => b.min_amount - a.min_amount)
    const matched = sorted.find(t => amount >= Number(t.min_amount))
    return matched ? Math.round(amount * Number(matched.bonus_rate)) / 100 : 0
  }

  const stopScanner = () => {
    if (scannerControlsRef.current) {
      scannerControlsRef.current.stop()
      scannerControlsRef.current = null
    }
    setShowScanner(false)
  }

  useEffect(() => {
    if (!showScanner) return
    let active = true
    const start = async () => {
      try {
        const codeReader = new BrowserMultiFormatReader()
        const video = videoRef.current
        if (!video) return
        const controls = await codeReader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          video,
          (result, err) => {
            if (!active) return
            if (!result) return
            const now = Date.now()
            if (now - lastScanTimeRef.current < 1500) return
            lastScanTimeRef.current = now
            const barcode = result.getText()
            const prod = products.find((p) => String(p.barcode) === barcode)
            if (prod) {
              setScanToast({ message: '扫码成功', type: 'success' })
              addToCart(prod)
              setTimeout(() => setScanToast(null), 500)
            } else {
              setScanToast({ message: '没有该商品', type: 'error' })
              setTimeout(() => {
                setScanToast(null)
                stopScanner()
              }, 500)
            }
          }
        )
        if (active) scannerControlsRef.current = controls
        else controls.stop()
      } catch (err) {
        if (active) {
          alert('无法启动摄像头：' + err.message)
          setShowScanner(false)
        }
      }
    }
    start()
    return () => {
      active = false
      if (scannerControlsRef.current) {
        scannerControlsRef.current.stop()
        scannerControlsRef.current = null
      }
    }
  }, [showScanner])

  useEffect(() => {
    if (!selectedMember) { setGiftMaterials([]); setSelectedGift(null); return }
    db.collection(COLLECTIONS.GIFT_MATERIALS).limit(100).get()
      .then(res => {
        const filtered = (res.data || [])
          .filter(m => m.stock > 0)
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        setGiftMaterials(filtered)
      })
      .catch(() => setGiftMaterials([]))
  }, [selectedMember])

  const handleSelectPromo = (promo) => {
    const next = selectedPromo?.id === promo.id ? null : promo
    const isAffected = (p, item) =>
      p && (p.scope === 'global' || toArray(p.product_ids).includes(item.product._id))
    setCartItems((prev) =>
      prev.map((item) => {
        if (isAffected(selectedPromo, item) || isAffected(next, item)) {
          return { ...item, discount: 10 }
        }
        return item
      })
    )
    setSelectedPromo(next)
  }

  const getRelatedProjects = (productId) =>
    projects.filter((p) => toArray(p.related_products).includes(productId))

  const toggleLink = (idx, proj) => {
    setCartItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item
      return { ...item, linkedProject: item.linkedProject?._id === proj._id ? null : proj }
    }))
  }

  // 会员搜索
  const searchMember = async (val) => {
    setMemberSearch(val)
    if (!val) { setMemberResults([]); return }
    const isDigits = /^\d+$/.test(val)
    if (isDigits && val.length < 4) { setMemberResults([]); return }
    const res = await db.collection(COLLECTIONS.MEMBERS)
      .where(db.command.or([
        { name: db.RegExp({ regexp: val, options: 'i' }) },
        { phone: db.RegExp({ regexp: val, options: 'i' }) },
      ]))
      .limit(8).get()
    setMemberResults(res.data)
  }

  const memberFields = getSetting('member_fields', {
    birthday: true, gender: true, skin_type: true, allergy: true, notes: true,
  })

  const resetAddMemberForm = () => {
    setAddForm(EMPTY_ADD_FORM)
    setShowAddMember(false)
  }

  const selectExistingMember = (member) => {
    setSelectedMember(member)
    setMemberSearch('')
    setMemberResults([])
    setPointsInput('')
    setDuplicateMember(null)
    resetAddMemberForm()
  }

  const handleAddNewMember = async () => {
    const name = addForm.name?.trim()
    const phone = addForm.phone?.trim()
    if (!name || !phone) { alert('姓名和手机号为必填项'); return }

    setAddMemberSaving(true)
    try {
      let memberList = members
      if (memberList.length === 0) {
        await refreshCache('members')
        memberList = useCacheStore.getState().members
      }
      const dup = findDuplicateMember(name, phone, memberList)
      if (dup) {
        setDuplicateMember(dup)
        return
      }
      const data = { ...addForm, name, phone, points: Number(addForm.points) || 0 }
      const res = await db.collection(COLLECTIONS.MEMBERS).add({ ...data, created_at: new Date() })
      await writeLog(user, '会员库', `新增会员「${name}」`)
      await refreshCache('members')
      setSelectedMember({ _id: res.id, ...data, created_at: new Date() })
      resetAddMemberForm()
      setMemberSearch('')
      setMemberResults([])
      setPointsInput('')
    } finally {
      setAddMemberSaving(false)
    }
  }

  // 商品名称/条形码搜索
  const handleSearch = () => {
    const val = searchInput.trim()
    if (!val) return
    // 优先精确匹配条形码 → 直接加购
    const byBarcode = products.find((p) => String(p.barcode) === val)
    if (byBarcode) {
      addToCart(byBarcode)
      setSearchInput('')
      setSearchResults(null)
      setSearchError('')
      return
    }
    // 按名称或条形码模糊过滤
    const results = products.filter((p) =>
      p.name.toLowerCase().includes(val.toLowerCase()) ||
      String(p.barcode).includes(val)
    )
    setSearchResults(results)
    setSearchError(results.length === 0 ? '没有匹配的商品' : '')
  }

  const addToCart = (prod) => {
    setCartItems((prev) => [
      ...prev,
      {
        product: prod,
        discount: 10,
        linkedProject: null,
        is_gift: false,
        get amount() { return +(this.product.sale_price * this.discount / 10).toFixed(2) },
      },
    ])
  }

  const updateDiscount = (idx, val) => {
    setCartItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item
      // 编辑时允许为空/中间态，不强制回填，否则删不掉最后一位
      if (val === '') return { ...item, discount: '' }
      const n = Number(val)
      if (isNaN(n)) return item
      return { ...item, discount: Math.min(10, Math.max(0, n)) }
    }))
  }

  // 折扣失焦：空值归位为默认 10 折
  const normalizeDiscount = (idx) => {
    setCartItems((prev) => prev.map((item, i) =>
      i === idx && (item.discount === '' || isNaN(Number(item.discount)))
        ? { ...item, discount: 10 } : item
    ))
  }

  const toggleGift = (idx) => {
    setCartItems((prev) => prev.map((item, i) => {
      if (i !== idx) return item
      return { ...item, is_gift: !item.is_gift, discount: 10 }
    }))
  }

  const removeItem = (idx) => setCartItems((prev) => prev.filter((_, i) => i !== idx))

  // 买一送一：同促销生效范围内、同名商品成对，价格低的那条免费
  const bogoFreeIdxs = (() => {
    if (!selectedPromo || selectedPromo.type !== 'bogo') return new Set()
    const freeSet = new Set()
    const groups = {}
    cartItems.forEach((item, idx) => {
      const inScope =
        selectedPromo.scope === 'global' ||
        toArray(selectedPromo.product_ids).includes(item.product._id)
      if (!inScope) return
      const key = item.product.name
      if (!groups[key]) groups[key] = []
      groups[key].push({ idx, amount: +(item.product.sale_price * item.discount / 10).toFixed(2) })
    })
    Object.values(groups).forEach((group) => {
      if (group.length < 2) return
      const pairs = Math.floor(group.length / 2)
      const sorted = [...group].sort((a, b) => a.amount - b.amount)
      for (let i = 0; i < pairs; i++) freeSet.add(sorted[i].idx)
    })
    return freeSet
  })()

  // 参与满减合计（10折非赠品）
  const promoSubtotal = computePromoSubtotal(cartItems, bogoFreeIdxs)

  // 不参与满减：有手动折扣且非赠品，直接按折后价计算
  const discSubtotal = cartItems.reduce((sum, item, idx) => {
    if (bogoFreeIdxs.has(idx)) return sum
    if (item.is_gift) return sum
    if (item.discount === 10) return sum
    return sum + +(item.product.sale_price * item.discount / 10).toFixed(2)
  }, 0)

  const promoDiscount = computePromoDiscount({ promoSubtotal, promo: selectedPromo })

  const {
    pointsToRedeem, pointsDiscount,
    balanceDiscount, supplementAmount, totalNum,
  } = computeDeductions({
    discSubtotal,
    promoSubtotal,
    promoDiscount,
    pointsInput,
    memberPoints: selectedMember?.points ?? 0,
    pointsRedeemRate,
    balanceInput,
    memberBalance,
    supplement,
    pointsEarnRate,
    hasMember: !!selectedMember,
  })
  // ── 抹零：向下抹到角，应收以抹零后为准 ──
  const autoRound = getSetting('auto_round_enabled', true)
  const payableTotal = roundPayable(totalNum, autoRound)
  const roundoff = +(totalNum - payableTotal).toFixed(2)   // 抹掉的零头（让利）
  const total = payableTotal.toFixed(2)

  // ── 付款方式（付款弹窗）──
  // 储值卡与「余额抵扣 / 积分抵扣」互斥（同动用余额 / 不重复让利）
  const balanceSelectable = !!selectedMember && balanceEnabled && memberBalance > 0
    && pointsDiscount === 0 && balanceDiscount === 0
  const payBalanceEffective = payBalance && balanceSelectable
  const balancePayAmt = payBalanceEffective ? +Math.min(payableTotal, memberBalance).toFixed(2) : 0
  const payRemainder = +(payableTotal - balancePayAmt).toFixed(2)
  let cashPayAmt = 0, scanPayAmt = 0
  if (payCash && payScan) {
    cashPayAmt = +Math.min(Math.max(parseFloat(cashInput) || 0, 0), payRemainder).toFixed(2)
    scanPayAmt = +(payRemainder - cashPayAmt).toFixed(2)
  } else if (payCash) {
    cashPayAmt = payRemainder
  } else if (payScan) {
    scanPayAmt = payRemainder
  }
  const paidSum = +(balancePayAmt + cashPayAmt + scanPayAmt).toFixed(2)
  const cashChange = payCash ? calcChange(cashTendered, cashPayAmt) : 0
  const scanChange = payScan ? calcChange(scanTendered, scanPayAmt) : 0
  const cashTenderedInvalid = payCash && cashTendered !== ''
    && !Number.isNaN(Number(cashTendered)) && Number(cashTendered) < cashPayAmt - 0.005
  const scanTenderedInvalid = payScan && scanTendered !== ''
    && !Number.isNaN(Number(scanTendered)) && Number(scanTendered) < scanPayAmt - 0.005
  const anyMethod = payBalanceEffective || payCash || payScan
  const paymentValid = payableTotal < 0.005 ? true : (
    anyMethod
    && Math.abs(paidSum - payableTotal) < 0.005
    && !cashTenderedInvalid
    && !scanTenderedInvalid
  )

  // 积分获取：仅按现金+扫码部分（储值卡支付部分不计，维持现状）
  const pointsEarned = (selectedMember && pointsEnabled)
    ? Math.floor(Math.max(0, payableTotal - balancePayAmt) * pointsEarnRate)
    : 0

  const resetPayMethods = () => {
    setPayBalance(false); setPayCash(false); setPayScan(false)
    setCashInput(''); setCashTendered(''); setScanTendered('')
  }

  // ── 充值付款方式（仅现金 / 扫码，付的是充值金额）──
  const topupAmt = parseFloat(topupAmount) || 0
  let topupCashAmt = 0, topupScanAmt = 0
  if (topupPayCash && topupPayScan) {
    topupCashAmt = +Math.min(Math.max(parseFloat(topupCashInput) || 0, 0), topupAmt).toFixed(2)
    topupScanAmt = +(topupAmt - topupCashAmt).toFixed(2)
  } else if (topupPayCash) {
    topupCashAmt = topupAmt
  } else if (topupPayScan) {
    topupScanAmt = topupAmt
  }
  const topupPaidSum = +(topupCashAmt + topupScanAmt).toFixed(2)
  const topupAnyMethod = topupPayCash || topupPayScan
  const topupPaymentValid = topupAmt > 0 && topupAnyMethod && Math.abs(topupPaidSum - topupAmt) < 0.005

  const resetTopupMethods = () => {
    setTopupPayCash(false); setTopupPayScan(false); setTopupCashInput('')
  }

  const hasUnlinkedItems = cartItems.some((item) => {
    if (!selectedMember) return !item.linkedProject
    const relatedProjs = getRelatedProjects(item.product._id)
    return relatedProjs.length > 0 && !item.linkedProject
  })

  const handleTopup = async () => {
    const amount = parseFloat(topupAmount)
    if (!amount || amount <= 0) { alert('请输入充值金额'); return }
    if (!topupPaymentValid) { alert('请选择付款方式，且各方式金额合计需等于充值金额'); return }
    setTopupSaving(true)
    try {
      const bonus = computeTopupBonus(amount)
      const credited = +(amount + bonus).toFixed(2)
      const now = new Date()
      const paymentMethods = []
      if (topupCashAmt > 0) paymentMethods.push({ method: 'cash', amount: topupCashAmt })
      if (topupScanAmt > 0) paymentMethods.push({ method: 'scan', amount: topupScanAmt })
      await db.collection(COLLECTIONS.BALANCE_RECORDS).add({
        member_id: selectedMember._id,
        type: 'topup',
        amount: credited,
        bonus_amount: bonus,
        note: bonus > 0 ? `充值 ¥${amount}，赠送 ¥${bonus.toFixed(2)}` : `充值 ¥${amount}`,
        staff_id: operatorId,
        payment_methods: paymentMethods,
        created_at: now,
      })
      const newBalance = +(memberBalance + credited).toFixed(2)
      await db.collection(COLLECTIONS.MEMBERS).doc(selectedMember._id).update({ balance: newBalance })
      setSelectedMember({ ...selectedMember, balance: newBalance })
      setShowTopup(false)
      setTopupAmount('')
      resetTopupMethods()
      alert(`充值成功！到账 ¥${credited.toFixed(2)}${bonus > 0 ? `（含赠 ¥${bonus.toFixed(2)}）` : ''}`)
    } catch (err) {
      alert('充值失败：' + err.message)
    } finally {
      setTopupSaving(false)
    }
  }

  const handleConfirmPayment = async () => {
    if (needsOperator) { alert('请先返回首页选择操作人'); return }
    if (cartItems.length === 0) { alert('请先添加商品'); return }
    if (!paymentValid) { alert('请选择付款方式，且各方式金额合计需等于应收'); return }
    setSaving(true)
    try {
      const paymentMethods = []
      if (balancePayAmt > 0) paymentMethods.push({ method: 'balance', amount: balancePayAmt })
      if (cashPayAmt > 0) paymentMethods.push({ method: 'cash', amount: cashPayAmt, change: cashChange })
      if (scanPayAmt > 0) paymentMethods.push({ method: 'scan', amount: scanPayAmt, change: scanChange })
      await checkout({
        cartItems, selectedMember, operatorId, user, products,
        selectedPromo, promoDiscount, promoSubtotal, bogoFreeIdxs, presaleProductIds,
        pointsEnabled, pointsToRedeem, pointsEarned, pointsDiscount,
        balanceEnabled, balanceDiscount: +(balanceDiscount + balancePayAmt).toFixed(2),
        supplementAmount, totalNum: payableTotal, roundoff, paymentMethods,
        selectedGift, giftQty, giftReason,
      })
      setPresaleWarnings([])
      setPresaleProductIds(new Set())
      setPointsInput('')
      setBalanceInput('')
      setSupplement('')
      setSelectedGift(null)
      resetPayMethods()
      setActiveStaff(null)
      navigate('/sales/success', { state: { total, memberName: selectedMember?.name } })
    } catch (err) {
      alert('收款失败：' + err.message)
    } finally {
      setSaving(false)
      setShowPayment(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <button onClick={() => navigate('/')} className="text-gray-500">← 返回</button>
        <h1 className="text-lg font-bold text-gray-800">销售收款</h1>
        {isShared && operatorName && (
          <button onClick={() => setShowOperatorSwitch(true)} className="flex items-center gap-0.5 text-base font-semibold text-[#0F6B5C]">
            {operatorName}<span className="text-xs text-[#0F6B5C]/70">▾</span>
          </button>
        )}
      </div>

      <div className="p-4 max-w-5xl mx-auto">
        <div className="flex flex-col gap-4 md:grid md:grid-cols-[3fr_2fr] md:items-start">

          {/* ── 左列：会员 / 添加商品 / 购物车 ── */}
          <div className="space-y-4">
            {/* 会员搜索 */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="text-base text-gray-500 mb-2">会员（可选，匿名销售留空）</div>
              {selectedMember ? (
                <div className="border border-gray-200 rounded-lg px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-medium">{selectedMember.name} <span className="text-gray-400">{selectedMember.phone}</span></span>
                    <button onClick={() => { setSelectedMember(null); setMemberSearch(''); setPointsInput(''); setBalanceInput('') }}
                      className="text-gray-400 text-sm">✕</button>
                  </div>
                  {balanceEnabled && (
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-sm text-teal-600">余额 ¥{memberBalance.toFixed(2)}</span>
                      <button onClick={() => { setTopupAmount(''); resetTopupMethods(); setShowTopup(true) }}
                        className="text-xs px-2 py-0.5 rounded border border-teal-300 text-teal-600 hover:bg-teal-50">
                        充值
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="relative">
                  <div className="flex gap-2">
                    <input type="text" value={memberSearch}
                      onChange={(e) => setMemberSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && searchMember(memberSearch)}
                      placeholder="搜索姓名或手机号"
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-base focus:outline-none" />
                    <button
                      onClick={() => searchMember(memberSearch)}
                      className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-base rounded-lg whitespace-nowrap"
                    >
                      搜索
                    </button>
                    <button
                      onClick={() => setShowAddMember(true)}
                      className="px-4 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-base rounded-lg whitespace-nowrap"
                    >
                      新增
                    </button>
                  </div>
                  {memberResults.length > 0 && (
                    <div className="absolute z-20 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-48 overflow-y-auto">
                      {memberResults.map((m) => (
                        <button key={m._id}
                          onClick={() => { setSelectedMember(m); setMemberSearch(''); setMemberResults([]); setPointsInput('') }}
                          className="w-full text-left px-3 py-2.5 text-base hover:bg-gray-50">
                          {m.is_key && <span className="text-amber-400 mr-0.5">★</span>}{m.name} <span className="text-gray-400">{m.phone}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 添加商品 */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between mb-2">
                <div className="text-base text-gray-500">添加商品</div>
                <button
                  onClick={() => setShowScanner(true)}
                  className="px-3 py-1.5 bg-orange-500 text-white text-sm rounded-lg hover:bg-orange-600 flex items-center gap-1"
                >
                  📷 扫码
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => { setSearchInput(e.target.value); if (!e.target.value) { setSearchResults(null); setSearchError('') } }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="商品名称或条形码"
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
                <button onClick={handleSearch}
                  className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-base rounded-lg whitespace-nowrap">
                  搜索
                </button>
                {searchInput && (
                  <button onClick={() => { setSearchInput(''); setSearchResults(null); setSearchError('') }}
                    className="px-2 text-gray-400 hover:text-gray-600 text-base">✕</button>
                )}
              </div>
              {searchError && <div className="text-red-500 text-sm mt-1">{searchError}</div>}
              {searchResults !== null && (
                <div className="mt-2 flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                  {searchResults.map((p) => (
                    <button key={p._id} onClick={() => addToCart(p)}
                      className="px-3 py-1.5 text-sm bg-orange-50 border border-orange-200 text-orange-700 rounded-lg hover:bg-orange-100 whitespace-nowrap">
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 购物车表格 */}
            {cartItems.length > 0 && (
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <table className="w-full text-sm">
                  <thead className="text-gray-400 border-b">
                    <tr>
                      <th className="text-left pb-2">品名</th>
                      <th className="text-left pb-2">关联项目</th>
                      <th className="text-right pb-2 w-16">原价</th>
                      <th className="text-right pb-2 w-16">折扣</th>
                      <th className="text-right pb-2 w-16">金额</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cartItems.map((item, idx) => {
                      const isFree = bogoFreeIdxs.has(idx)
                      const isGift = item.is_gift
                      const amount = isFree || isGift ? 0 : +(item.product.sale_price * item.discount / 10).toFixed(2)
                      const relatedProjs = selectedMember ? getRelatedProjects(item.product._id) : []
                      const linkedProject = item.linkedProject
                      return (
                        <tr key={idx} className="border-b last:border-0">
                          <td className="py-2.5">
                            <div className="font-medium text-base">{item.product.name}</div>
                            <div className="text-gray-400 text-sm">{item.product.spec}</div>
                          </td>
                          <td className="py-2.5 px-2">
                            <select
                                value={linkedProject?._id || ''}
                                onChange={(e) => {
                                  const projId = e.target.value
                                  const proj = projId === 'WALK_IN'
                                    ? WALK_IN_PROJECT
                                    : projId === 'TAKE_AWAY'
                                    ? TAKE_AWAY_PROJECT
                                    : projects.find((p) => p._id === projId) || null
                                  setCartItems((prev) => prev.map((it, i) =>
                                    i !== idx ? it : { ...it, linkedProject: proj }
                                  ))
                                }}
                                className={`text-sm border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-300 ${
                                  !linkedProject ? 'border-orange-300 text-gray-400' : 'border-gray-200 text-gray-700'
                                }`}
                              >
                                <option value="">请选择项目</option>
                                {(selectedMember
                                  ? [...relatedProjs, TAKE_AWAY_PROJECT]
                                  : [WALK_IN_PROJECT]
                                ).map((proj) => (
                                  <option key={proj._id} value={proj._id}>{proj.name}</option>
                                ))}
                              </select>
                          </td>
                          <td className="py-2.5 text-right text-gray-400">¥{item.product.sale_price}</td>
                          <td className="py-2.5 text-right">
                            {isFree || isGift ? (
                              <span className="text-sm text-green-600 font-medium">赠品</span>
                            ) : (
                              <>
                                <input
                                  type="number" min="0" max="10" step="0.1"
                                  value={item.discount}
                                  onChange={(e) => updateDiscount(idx, e.target.value)}
                                  onBlur={() => normalizeDiscount(idx)}
                                  className="w-14 text-right border border-gray-200 rounded px-1 py-0.5 text-sm focus:outline-none"
                                />
                                <span className="text-sm text-gray-400 ml-0.5">折</span>
                              </>
                            )}
                          </td>
                          <td className={`py-2.5 text-right font-medium ${isFree || isGift ? 'text-green-500' : 'text-orange-600'}`}>
                            ¥{amount}
                          </td>
                          <td className="py-2.5 text-center">
                            <div className="flex items-center justify-end gap-1.5">
                              {!isFree && (
                                <button
                                  onClick={() => toggleGift(idx)}
                                  className={`text-xs px-1.5 py-0.5 rounded border ${
                                    isGift
                                      ? 'text-green-600 bg-green-50 border-green-300'
                                      : 'text-gray-400 border-gray-200 hover:text-green-500 hover:border-green-300'
                                  }`}
                                  title={isGift ? '取消赠送' : '标记为赠品'}
                                >
                                  赠
                                </button>
                              )}
                              <button onClick={() => removeItem(idx)} className="text-gray-300 hover:text-red-400 text-base">✕</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── 右列：促销 / 补差价 / 汇总 / 收款 ── */}
          <div className="space-y-4 md:sticky md:top-4">
            {/* 促销活动 */}
            {enabledPromos.length > 0 && (
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <div className="text-base text-gray-500 mb-2">促销活动（单选）</div>
                <div className="flex flex-wrap gap-2">
                  {enabledPromos.map((promo) => (
                    <button
                      key={promo.id}
                      onClick={() => handleSelectPromo(promo)}
                      className={`px-3 py-1.5 text-base rounded-lg border transition-colors ${
                        selectedPromo?.id === promo.id
                          ? 'bg-pink-500 text-white border-pink-500'
                          : 'bg-pink-50 text-pink-700 border-pink-200 hover:bg-pink-100'
                      }`}
                    >
                      {promo.name}
                      <span className="text-sm ml-1 opacity-75">
                        {promo.type === 'spend_threshold'
                          ? `满${promo.threshold}减${promo.discount}`
                          : '买一送一'}
                      </span>
                    </button>
                  ))}
                </div>
                {selectedPromo?.type === 'spend_threshold' && promoSubtotal < selectedPromo.threshold && (
                  <div className="text-sm text-gray-400 mt-1.5">
                    还差 ¥{(selectedPromo.threshold - promoSubtotal).toFixed(2)} 满足优惠条件
                  </div>
                )}
              </div>
            )}

            {/* 赠品物料 */}
            {selectedMember && giftMaterials.length > 0 && (
              <div className="bg-white rounded-xl p-4 shadow-sm">
                <div className="text-base text-gray-500 mb-2">赠品物料</div>
                <div className="flex flex-wrap gap-2">
                  {giftMaterials.map(m => (
                    <button
                      key={m._id}
                      onClick={() => {
                        if (selectedGift?._id === m._id) { setSelectedGift(null) }
                        else { setSelectedGift(m); setGiftQty(1) }
                      }}
                      className={`px-3 py-1.5 text-base rounded-lg border transition-colors ${
                        selectedGift?._id === m._id
                          ? 'bg-yellow-500 text-white border-yellow-500'
                          : 'bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-100'
                      }`}
                    >
                      {m.name}
                      {m.spec && <span className="text-sm ml-1 opacity-75">({m.spec})</span>}
                      <span className="text-sm ml-1 opacity-75">剩余{m.stock}件</span>
                    </button>
                  ))}
                </div>
                {selectedGift && (
                  <div className="flex items-center gap-3 mt-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-500">数量</span>
                      <input
                        type="number"
                        min="1"
                        max={selectedGift.stock}
                        value={giftQty}
                        onChange={e => {
                          const v = e.target.value
                          if (v === '') { setGiftQty(''); return }
                          const n = parseInt(v)
                          if (!isNaN(n)) setGiftQty(Math.max(1, Math.min(selectedGift.stock, n)))
                        }}
                        onBlur={() => setGiftQty(q => {
                          const n = parseInt(q)
                          return isNaN(n) ? 1 : Math.max(1, Math.min(selectedGift.stock, n))
                        })}
                        className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-yellow-300"
                      />
                    </div>
                    <select
                      value={giftReason}
                      onChange={e => setGiftReason(e.target.value)}
                      className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-yellow-300"
                    >
                      {['满额赠品', '指定商品赠品', '活动赠品', '其他'].map(r => (
                        <option key={r} value={r}>{r}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            )}

            {/* 补差价 */}
            <div className="bg-white rounded-xl p-4 shadow-sm">
              <div className="flex justify-between items-center">
                <span className="text-base text-gray-500">补差价</span>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400 text-base">¥</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={supplement}
                    onChange={(e) => setSupplement(e.target.value)}
                    placeholder="0"
                    className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-base text-right focus:outline-none focus:ring-2 focus:ring-orange-300"
                  />
                </div>
              </div>
            </div>

            {/* 汇总 */}
            {(cartItems.length > 0 || supplementAmount > 0) && (
              <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
                {promoDiscount > 0 && (
                  <div className="flex justify-between items-center text-base text-green-600">
                    <span>优惠（{selectedPromo.name}）</span>
                    <span>-¥{promoDiscount}</span>
                  </div>
                )}
                {selectedMember && pointsEnabled && (selectedMember.points ?? 0) > 0 && (
                  <div className="flex justify-between items-center text-base">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-amber-600">积分抵扣</span>
                      <span className="text-gray-400 text-sm">（余 {selectedMember.points} 分，{pointsRedeemRate}分=¥1）</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <input
                        type="number" min="0" max={selectedMember.points} step={pointsRedeemRate}
                        value={pointsInput}
                        onChange={(e) => setPointsInput(e.target.value)}
                        placeholder="0"
                        className="w-20 border border-amber-300 rounded px-2 py-0.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-amber-400"
                      />
                      <span className="text-gray-400 text-sm">分</span>
                      {pointsDiscount > 0 && (
                        <span className="text-amber-600 text-base font-medium ml-1">-¥{pointsDiscount}</span>
                      )}
                    </div>
                  </div>
                )}
                {selectedMember && balanceEnabled && memberBalance > 0 && (
                  <div className="flex justify-between items-center text-base">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-teal-600">余额抵扣</span>
                      <span className="text-gray-400 text-sm">（余 ¥{memberBalance.toFixed(2)}）</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-gray-400 text-sm">¥</span>
                      <input
                        type="number" min="0" max={memberBalance} step="0.01"
                        value={balanceInput}
                        onChange={(e) => setBalanceInput(e.target.value)}
                        placeholder="0"
                        className="w-24 border border-teal-300 rounded px-2 py-0.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-teal-400"
                      />
                      {balanceDiscount > 0 && (
                        <span className="text-teal-600 text-base font-medium ml-1">-¥{balanceDiscount.toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                )}
                {supplementAmount > 0 && (
                  <div className="flex justify-between items-center text-base text-orange-500">
                    <span>补差价</span>
                    <span>+¥{supplementAmount.toFixed(2)}</span>
                  </div>
                )}
                {roundoff > 0 && (
                  <div className="flex justify-between items-center text-base text-green-600">
                    <span>抹零</span>
                    <span>-¥{roundoff.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="text-gray-600 font-medium text-base">合计</span>
                  <span className="text-3xl font-bold text-orange-600">¥{total}</span>
                </div>
              </div>
            )}

            {cartItems.length > 0 && hasUnlinkedItems && (
              <div className="text-center text-orange-500 text-base">
                {selectedMember ? '请为每件商品选择关联项目' : '请为每件商品选择关联项目或「散客」'}
              </div>
            )}

            <button
              onClick={async () => {
                if (cartItems.length === 0 && supplementAmount === 0) return
                const { warnings, presaleProductIds: ids } = await checkAvailable(cartItems)
                setPresaleWarnings(warnings)
                setPresaleProductIds(ids)
                resetPayMethods()
                setShowPayment(true)
              }}
              disabled={(cartItems.length === 0 && supplementAmount === 0) || (cartItems.length > 0 && hasUnlinkedItems)}
              className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold rounded-xl text-xl"
            >
              收款 ¥{total}
            </button>
          </div>

        </div>
      </div>

      {/* 收款确认弹窗 */}
      {showPayment && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-8 w-80 text-center shadow-xl">
            <div className="text-4xl mb-3">💳</div>
            <div className="text-gray-500 text-sm mb-2">应收金额</div>
            <div className="text-4xl font-bold text-orange-600 mb-1">¥{total}</div>
            {(promoDiscount > 0 || pointsDiscount > 0 || balanceDiscount > 0 || supplementAmount > 0 || roundoff > 0) && (
              <div className="text-xs mb-1 space-y-0.5">
                {promoDiscount > 0 && <div className="text-green-600">已优惠 ¥{promoDiscount}（{selectedPromo.name}）</div>}
                {pointsDiscount > 0 && <div className="text-green-600">积分抵扣 ¥{pointsDiscount}（用 {pointsToRedeem} 分）</div>}
                {balanceDiscount > 0 && <div className="text-teal-600">余额抵扣 ¥{balanceDiscount.toFixed(2)}</div>}
                {supplementAmount > 0 && <div className="text-orange-500">含补差价 ¥{supplementAmount.toFixed(2)}</div>}
                {roundoff > 0 && <div className="text-green-600">已抹零 ¥{roundoff.toFixed(2)}</div>}
              </div>
            )}
            {selectedMember && pointsEnabled && (pointsEarned > 0 || pointsToRedeem > 0) && (
              <div className="mt-2 mb-1 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 text-left text-xs">
                {pointsToRedeem > 0 && (
                  <div className="text-amber-700">- 消耗 {pointsToRedeem} 积分</div>
                )}
                {pointsEarned > 0 && (
                  <div className="text-amber-700">+ 获得 {pointsEarned} 积分</div>
                )}
                <div className="text-gray-500 mt-0.5">
                  收款后余 {Math.max(0, (selectedMember.points ?? 0) + pointsEarned - pointsToRedeem)} 分
                </div>
              </div>
            )}
            {totalNum >= 0.005 && (
              <div className="mt-4 text-left">
                <div className="text-sm text-gray-500 mb-2">付款方式</div>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    disabled={!balanceSelectable}
                    onClick={() => setPayBalance(v => !v)}
                    className={`py-2 rounded-lg text-sm border transition-colors ${
                      !balanceSelectable
                        ? 'bg-gray-100 text-gray-300 border-gray-200 cursor-not-allowed'
                        : payBalance
                        ? 'bg-teal-500 text-white border-teal-500'
                        : 'bg-white text-gray-600 border-gray-300 hover:border-teal-400'
                    }`}
                  >
                    储值卡
                    {selectedMember && balanceEnabled && (
                      <span className="block text-[10px] opacity-80">¥{memberBalance.toFixed(2)}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => { if (payCash) setCashTendered(''); setPayCash(v => !v) }}
                    className={`py-2 rounded-lg text-sm border transition-colors ${
                      payCash ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:border-orange-400'
                    }`}
                  >现金</button>
                  <button
                    type="button"
                    onClick={() => { if (payScan) setScanTendered(''); setPayScan(v => !v) }}
                    className={`py-2 rounded-lg text-sm border transition-colors ${
                      payScan ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-300 hover:border-orange-400'
                    }`}
                  >扫码</button>
                </div>
                {payBalanceEffective && (
                  <div className="flex justify-between text-sm mt-2">
                    <span className="text-teal-600">储值卡</span><span>¥{balancePayAmt.toFixed(2)}</span>
                  </div>
                )}
                {payCash && payScan ? (
                  <>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-sm text-gray-600">现金支付金额</span>
                      <div className="flex items-center gap-1">
                        <span className="text-gray-400 text-sm">¥</span>
                        <input
                          type="number" min="0" max={payRemainder} step="0.01"
                          value={cashInput}
                          onChange={(e) => setCashInput(e.target.value)}
                          placeholder="0"
                          className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-orange-300"
                        />
                      </div>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-gray-600">扫码金额</span><span>¥{scanPayAmt.toFixed(2)}</span>
                    </div>
                  </>
                ) : payCash ? (
                  <div className="flex justify-between text-sm mt-2"><span className="text-gray-600">现金</span><span>¥{cashPayAmt.toFixed(2)}</span></div>
                ) : payScan ? (
                  <div className="flex justify-between text-sm mt-2"><span className="text-gray-600">扫码</span><span>¥{scanPayAmt.toFixed(2)}</span></div>
                ) : null}
                {((payCash && cashPayAmt > 0.005) || (payScan && scanPayAmt > 0.005)) && (
                  <div className="mt-3 pt-2 border-t border-gray-100 space-y-2">
                    {payCash && cashPayAmt > 0.005 && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">实收现金</span>
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400 text-sm">¥</span>
                            <input
                              type="number" min="0" step="0.01"
                              value={cashTendered}
                              onChange={(e) => setCashTendered(e.target.value)}
                              placeholder="选填"
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-orange-300"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">找零</span>
                          <span className={cashChange > 0 ? 'text-orange-600 font-semibold' : 'text-gray-400'}>
                            {cashTendered === '' ? '—' : `¥${cashChange.toFixed(2)}`}
                          </span>
                        </div>
                      </>
                    )}
                    {payScan && scanPayAmt > 0.005 && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-gray-600">实收扫码</span>
                          <div className="flex items-center gap-1">
                            <span className="text-gray-400 text-sm">¥</span>
                            <input
                              type="number" min="0" step="0.01"
                              value={scanTendered}
                              onChange={(e) => setScanTendered(e.target.value)}
                              placeholder="选填"
                              className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-orange-300"
                            />
                          </div>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-500">找零</span>
                          <span className={scanChange > 0 ? 'text-orange-600 font-semibold' : 'text-gray-400'}>
                            {scanTendered === '' ? '—' : `¥${scanChange.toFixed(2)}`}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {!anyMethod && (
                  <div className="text-xs text-gray-400 mt-1.5">请选择付款方式</div>
                )}
                {anyMethod && !paymentValid && (
                  <div className="text-xs text-red-500 mt-1.5">
                    {cashTenderedInvalid
                      ? `实收现金不能小于应收 ¥${cashPayAmt.toFixed(2)}`
                      : scanTenderedInvalid
                      ? `实收扫码不能小于应收 ¥${scanPayAmt.toFixed(2)}`
                      : `各方式金额合计需等于应收 ¥${total}`}
                  </div>
                )}
              </div>
            )}
            {presaleWarnings.length > 0 && (
              <div className="mt-3 mb-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-left">
                <div className="text-amber-700 text-xs font-semibold mb-1.5">⚠ 以下商品库存不足，将生成预售</div>
                {presaleWarnings.map((w) => (
                  <div key={w.name} className="text-amber-600 text-xs">
                    {w.name}：现有 {w.available} 件，欠 {w.shortage} 件
                  </div>
                ))}
              </div>
            )}
            {isShared && operatorName && (
              <div className="text-[#0F6B5C] text-sm font-medium mt-3">操作人：{operatorName}</div>
            )}
            <div className="text-gray-400 text-xs mb-6 mt-1">请确认客户已完成支付</div>
            <div className="flex gap-3">
              <button onClick={() => setShowPayment(false)}
                className="flex-1 py-3 border border-gray-200 rounded-xl text-gray-600">
                取消
              </button>
              <button onClick={handleConfirmPayment} disabled={saving || !paymentValid}
                className="flex-1 py-3 bg-orange-500 text-white rounded-xl font-medium disabled:bg-orange-300 disabled:text-white/80">
                {saving ? '处理中...' : '已收款'}
              </button>
            </div>
          </div>
        </div>
      )}
      {showOperatorSwitch && (
        <OperatorSelector
          onSelect={(s) => { setActiveStaff(s); setShowOperatorSwitch(false) }}
          onCancel={() => setShowOperatorSwitch(false)}
        />
      )}

      {showTopup && selectedMember && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 w-80 shadow-xl">
            <h3 className="font-bold text-base mb-1">储值充值</h3>
            <div className="text-sm text-gray-500 mb-4">会员：{selectedMember.name}　当前余额 ¥{memberBalance.toFixed(2)}</div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">充值金额</label>
                <div className="flex items-center gap-1">
                  <span className="text-gray-400">¥</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={topupAmount}
                    onChange={(e) => setTopupAmount(e.target.value)}
                    placeholder="请输入金额"
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300"
                  />
                </div>
              </div>
              {(() => {
                const amt = parseFloat(topupAmount) || 0
                const bonus = amt > 0 ? computeTopupBonus(amt) : 0
                const credited = amt + bonus
                return amt > 0 ? (
                  <div className="bg-teal-50 border border-teal-200 rounded-xl px-4 py-2.5 text-sm">
                    {bonus > 0 ? (
                      <>
                        <div className="text-teal-700">充值 ¥{amt.toFixed(2)} + 赠送 ¥{bonus.toFixed(2)}</div>
                        <div className="text-teal-600 font-semibold mt-0.5">到账 ¥{credited.toFixed(2)}</div>
                      </>
                    ) : (
                      <div className="text-teal-700">到账 ¥{credited.toFixed(2)}</div>
                    )}
                    <div className="text-gray-400 text-xs mt-0.5">充值后余额 ¥{(memberBalance + credited).toFixed(2)}</div>
                  </div>
                ) : null
              })()}
              {balanceTiers.filter(t => t && Number(t.min_amount) > 0).length > 0 && (
                <div className="text-xs text-gray-400">
                  档位：{balanceTiers.filter(t => t && Number(t.min_amount) > 0)
                    .sort((a, b) => a.min_amount - b.min_amount)
                    .map(t => `充 ≥¥${t.min_amount} 赠 ${t.bonus_rate}%`).join('　')}
                </div>
              )}
              {topupAmt > 0 && (
                <div>
                  <div className="text-sm text-gray-600 mb-2">付款方式</div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTopupPayCash(v => !v)}
                      className={`py-2 rounded-lg text-sm border transition-colors ${
                        topupPayCash ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-600 border-gray-300 hover:border-teal-400'
                      }`}
                    >现金</button>
                    <button
                      type="button"
                      onClick={() => setTopupPayScan(v => !v)}
                      className={`py-2 rounded-lg text-sm border transition-colors ${
                        topupPayScan ? 'bg-teal-500 text-white border-teal-500' : 'bg-white text-gray-600 border-gray-300 hover:border-teal-400'
                      }`}
                    >扫码</button>
                  </div>
                  {topupPayCash && topupPayScan ? (
                    <>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm text-gray-600">现金支付金额</span>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-400 text-sm">¥</span>
                          <input
                            type="number" min="0" max={topupAmt} step="0.01"
                            value={topupCashInput}
                            onChange={(e) => setTopupCashInput(e.target.value)}
                            placeholder="0"
                            className="w-24 border border-gray-300 rounded px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-teal-300"
                          />
                        </div>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-gray-600">扫码金额</span><span>¥{topupScanAmt.toFixed(2)}</span>
                      </div>
                    </>
                  ) : null}
                  {!topupAnyMethod && (
                    <div className="text-xs text-gray-400 mt-1.5">请选择付款方式</div>
                  )}
                  {topupAnyMethod && !topupPaymentValid && (
                    <div className="text-xs text-red-500 mt-1.5">各方式金额合计需等于充值金额 ¥{topupAmt.toFixed(2)}</div>
                  )}
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowTopup(false); setTopupAmount(''); resetTopupMethods() }}
                className="flex-1 py-2 border border-gray-200 rounded-xl text-gray-600 text-sm">取消</button>
              <button onClick={handleTopup} disabled={topupSaving || !topupPaymentValid}
                className="flex-1 py-2 bg-teal-500 text-white rounded-xl text-sm font-medium disabled:bg-teal-300">
                {topupSaving ? '处理中...' : '确认充值'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddMember && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
            <h3 className="font-bold text-lg mb-4">新增会员</h3>
            <div className="space-y-3">
              {[
                { key: 'name', label: '姓名', required: true },
                { key: 'phone', label: '手机号', required: true },
                { key: 'points', label: '积分', type: 'number' },
                ...(memberFields.birthday ? [{ key: 'birthday', label: '生日' }] : []),
                ...(memberFields.gender ? [{ key: 'gender', label: '性别' }] : []),
                ...(memberFields.skin_type ? [{ key: 'skin_type', label: '肤质' }] : []),
                ...(memberFields.allergy ? [{ key: 'allergy', label: '过敏史' }] : []),
                ...(memberFields.notes ? [{ key: 'notes', label: '备注' }] : []),
              ].map(({ key, label, required, type = 'text' }) => (
                <div key={key}>
                  <label className="block text-sm text-gray-600 mb-1">
                    {label}{required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={type}
                    value={addForm[key]}
                    onChange={(e) => setAddForm({ ...addForm, [key]: type === 'number' ? Number(e.target.value) : e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                type="button"
                disabled={addMemberSaving}
                onClick={resetAddMemberForm}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                取消
              </button>
              <button
                type="button"
                disabled={addMemberSaving}
                onClick={handleAddNewMember}
                className="flex-1 py-2 bg-pink-500 text-white rounded-lg text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addMemberSaving ? '新增中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {duplicateMember && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
            <h3 className="font-bold text-lg mb-2">会员已存在</h3>
            <p className="text-sm text-gray-600 mb-1">
              {duplicateMember.reason === 'both'
                ? '姓名与手机号均与已有会员相同，无法重复新增。'
                : '该手机号已被其他会员使用，无法重复新增。'}
            </p>
            <p className="text-sm text-gray-800 mb-5">
              已有会员：<span className="font-medium">{duplicateMember.member.name}</span>
              {duplicateMember.member.phone ? `（${duplicateMember.member.phone}）` : ''}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDuplicateMember(null)}
                className="flex-1 py-2 border border-gray-300 rounded-lg text-gray-600 text-sm"
              >
                知道了
              </button>
              <button
                type="button"
                onClick={() => selectExistingMember(duplicateMember.member)}
                className="flex-1 py-2 bg-pink-500 text-white rounded-lg text-sm"
              >
                选用该会员
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 扫码overlay */}
      {showScanner && (
        <div className="fixed inset-0 bg-black z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/80">
            <span className="text-white font-medium">对准商品条形码</span>
            <button onClick={stopScanner} className="text-white text-2xl leading-none">✕</button>
          </div>
          <div className="flex-1 relative overflow-hidden">
            <video ref={videoRef} className="w-full h-full object-cover" />
            {scanToast && (
              <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-8 py-4 rounded-2xl text-white font-bold text-xl shadow-xl ${
                scanToast.type === 'success' ? 'bg-green-500/90' : 'bg-red-500/90'
              }`}>
                {scanToast.message}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
