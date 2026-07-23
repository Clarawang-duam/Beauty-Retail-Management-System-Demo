import dayjs from 'dayjs'

// 生成唯一流水号：日期+时间戳后6位+2位随机数
export function generateSerialNumber() {
  const date = dayjs().format('YYYYMMDD')
  const ts = String(Date.now()).slice(-6)
  const rand = String(Math.floor(Math.random() * 100)).padStart(2, '0')
  return `${date}${ts}${rand}`
}
