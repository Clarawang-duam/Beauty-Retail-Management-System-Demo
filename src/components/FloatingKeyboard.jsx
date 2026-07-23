import { useState, useEffect, useRef, useCallback } from 'react'
import useCacheStore from '../store/cacheStore'

const BTN = 44
const EDGE = 8

export default function FloatingKeyboard() {
  const { getSetting } = useCacheStore()
  const enabled = getSetting('floating_keyboard_enabled', false)

  const [side, setSide] = useState('right')
  const [yPos, setYPos] = useState(() =>
    typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.5) : 300
  )
  const [isOpen, setIsOpen] = useState(false)
  const [targetInput, setTargetInput] = useState(null)

  const btnRef = useRef(null)
  const kbRef = useRef(null)
  const isOpenRef = useRef(false)
  const lastInput = useRef(null)
  const blockFocus = useRef(false)
  const drag = useRef({ active: false, moved: false, ox: 0, oy: 0 })

  const openKb = (show) => {
    isOpenRef.current = show
    setIsOpen(show)
    if (!show) lastInput.current = null
  }

  const injectValue = (input, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, val)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }

  const handleKey = useCallback((key) => {
    if (!targetInput) return
    const cur = String(targetInput.value ?? '')
    let next
    if (key === '⌫') {
      next = cur.slice(0, -1)
    } else if (key === '.') {
      if (cur.includes('.')) return
      next = cur === '' ? '0.' : cur + '.'
    } else {
      next = cur + key
    }
    injectValue(targetInput, next)
  }, [targetInput])

  useEffect(() => {
    if (!enabled) return

    const onPointerDown = (e) => {
      const onBtn = btnRef.current?.contains(e.target)
      const onKb = kbRef.current?.contains(e.target)
      if (onBtn || onKb) return

      const input = e.target.closest('input[type="number"]')

      if (isOpenRef.current) {
        if (input && input === lastInput.current) {
          // 同一输入框第二次点击 → 关闭悬浮键盘，放行系统键盘
          openKb(false)
          return
        }
        // 点击其他区域或不同输入框 → 关闭
        openKb(false)
      }

      if (!input) return

      // 第一次点击数字输入框 → 拦截，唤出悬浮键盘
      e.preventDefault()
      lastInput.current = input
      blockFocus.current = true
      setTargetInput(input)
      isOpenRef.current = true
      setIsOpen(true)
    }

    const onFocus = (e) => {
      if (!blockFocus.current) return
      blockFocus.current = false
      const el = e.target
      if (el.tagName === 'INPUT') requestAnimationFrame(() => el.blur())
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('focus', onFocus, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('focus', onFocus, true)
    }
  }, [enabled])

  // 拖拽：按下
  const onBtnDown = (e) => {
    e.preventDefault()
    drag.current = { active: true, moved: false, ox: e.clientX, oy: e.clientY }
    btnRef.current?.setPointerCapture(e.pointerId)
  }

  // 拖拽：移动（沿屏幕边缘上下滑动）
  const onBtnMove = (e) => {
    if (!drag.current.active) return
    if (!drag.current.moved) {
      const dx = Math.abs(e.clientX - drag.current.ox)
      const dy = Math.abs(e.clientY - drag.current.oy)
      if (dx > 5 || dy > 5) drag.current.moved = true
    }
    if (!drag.current.moved) return
    const newY = e.clientY - BTN / 2
    setYPos(Math.max(0, Math.min(newY, window.innerHeight - BTN)))
  }

  // 拖拽：松手 → 吸附到最近左/右边缘；轻触 → 切换键盘
  const onBtnUp = (e) => {
    if (!drag.current.active) return
    drag.current.active = false
    if (!drag.current.moved) {
      if (isOpenRef.current) {
        openKb(false)
      } else {
        isOpenRef.current = true
        setIsOpen(true)
      }
    } else {
      setSide(e.clientX < window.innerWidth / 2 ? 'left' : 'right')
    }
  }

  if (!enabled) return null

  const kbTop = Math.max(EDGE, Math.min(yPos - 166, window.innerHeight - 342))

  return (
    <>
      {/* 悬浮触发按钮 */}
      <div
        ref={btnRef}
        onPointerDown={onBtnDown}
        onPointerMove={onBtnMove}
        onPointerUp={onBtnUp}
        style={{
          position: 'fixed',
          top: yPos,
          [side]: EDGE,
          width: BTN,
          height: BTN,
          zIndex: 9999,
          touchAction: 'none',
          userSelect: 'none',
        }}
        className="rounded-full bg-white shadow-md border border-gray-200 flex items-center justify-center text-xl cursor-grab active:cursor-grabbing"
      >
        1️⃣
      </div>

      {/* 数字键盘面板 */}
      {isOpen && (
        <div
          ref={kbRef}
          style={{
            position: 'fixed',
            top: kbTop,
            [side === 'right' ? 'right' : 'left']: BTN + EDGE + 8,
            zIndex: 9998,
          }}
          className="bg-white rounded-2xl shadow-2xl border border-gray-100 p-5 select-none"
        >
          {[['7','8','9'],['4','5','6'],['1','2','3'],['.','0','⌫']].map((row, ri) => (
            <div key={ri} className="flex gap-3 mb-3 last:mb-0">
              {row.map((key) => (
                <button
                  key={key}
                  onPointerDown={(e) => { e.preventDefault(); e.stopPropagation() }}
                  onClick={() => handleKey(key)}
                  className={`w-20 h-16 rounded-xl text-2xl font-semibold transition-all active:scale-95 ${
                    key === '⌫'
                      ? 'bg-red-50 text-red-500 active:bg-red-100'
                      : key === '.'
                      ? 'bg-gray-100 text-gray-500 active:bg-gray-200'
                      : 'bg-gray-50 text-gray-800 active:bg-pink-50 active:text-pink-600'
                  }`}
                >
                  {key}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
