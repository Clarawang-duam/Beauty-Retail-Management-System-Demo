import { useState, useEffect, useCallback } from 'react'
import { db } from '../lib/cloudbase'
import { COLLECTIONS } from '../lib/collections'

/**
 * 会员详情页数据：项目快照 / 积分 / 余额 / 核销手工费记录。
 * 进入时一次性拉取；mutation 后调 refetchProjects 刷新项目列表。
 */
export function useMemberData(memberId) {
  const [memberProjects, setMemberProjects] = useState([])
  const [pointsRecords, setPointsRecords] = useState([])
  const [balanceRecords, setBalanceRecords] = useState([])
  const [checkoutTxns, setCheckoutTxns] = useState([])

  const fetchMemberProjects = useCallback(async () => {
    const res = await db.collection(COLLECTIONS.MEMBER_PROJECTS)
      .where({ member_id: memberId })
      .orderBy('purchased_at', 'desc')
      .get()
    setMemberProjects(res.data)
  }, [memberId])

  const fetchPointsRecords = useCallback(async () => {
    const res = await db.collection(COLLECTIONS.POINTS_RECORDS)
      .where({ member_id: memberId })
      .orderBy('created_at', 'desc')
      .limit(50)
      .get()
    setPointsRecords(res.data)
  }, [memberId])

  const fetchBalanceRecords = useCallback(async () => {
    const res = await db.collection(COLLECTIONS.BALANCE_RECORDS)
      .where({ member_id: memberId })
      .orderBy('created_at', 'desc')
      .limit(50)
      .get()
    setBalanceRecords(res.data)
  }, [memberId])

  const fetchCheckoutTxns = useCallback(async () => {
    const res = await db.collection(COLLECTIONS.TRANSACTIONS)
      .where({ member_id: memberId, is_fee: true, type: 'checkout' })
      .orderBy('operated_at', 'desc')
      .limit(100)
      .get()
    setCheckoutTxns(res.data)
  }, [memberId])

  useEffect(() => {
    fetchMemberProjects()
    fetchPointsRecords()
    fetchBalanceRecords()
    fetchCheckoutTxns()
  }, [fetchMemberProjects, fetchPointsRecords, fetchBalanceRecords, fetchCheckoutTxns])

  return {
    memberProjects,
    pointsRecords,
    balanceRecords,
    checkoutTxns,
    refetchProjects: fetchMemberProjects,
  }
}
