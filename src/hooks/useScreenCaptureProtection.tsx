import { useEffect, useCallback, useState } from 'react'

const SCREENSHOT_NOTIFICATION_KEY = 'vanish_last_screenshot'

interface ScreenCaptureOptions {
  onScreenshot?: () => void
}

export function useScreenCaptureProtection(options: ScreenCaptureOptions = {}) {
  const { onScreenshot } = options
  const [isSecure, setIsSecure] = useState(true)

  const handleVisibilityChange = useCallback(() => {
    if (document.hidden) {
      onScreenshot?.()
      setIsSecure(false)
    } else {
      setIsSecure(true)
    }
  }, [onScreenshot])

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const isScreenshotCombo = 
      ((e.metaKey || e.ctrlKey) && 
      (e.shiftKey || e.key === '3' || e.key === '4' || e.key === '5')) ||
      e.key === 'PrintScreen'

    if (isScreenshotCombo) {
      e.preventDefault()
      e.stopPropagation()
      onScreenshot?.()
    }
  }, [onScreenshot])

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        onScreenshot?.()
        return
      }
    }
  }, [onScreenshot])

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange)
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('keyup', handleKeyDown, true)
    document.addEventListener('paste', handlePaste, false)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('keyup', handleKeyDown, true)
      document.removeEventListener('paste', handlePaste, false)
    }
  }, [handleVisibilityChange, handleKeyDown, handlePaste])

  return isSecure
}

export function useSecureContent(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return

    const style = document.createElement('style')
    style.id = 'screen-capture-protection'
    style.textContent = `
      @media print {
        * {
          display: none !important;
        }
        body::after {
          content: 'Printing disabled by VanishText';
          display: block !important;
          padding: 2rem;
          font-size: 18px;
          color: #666;
        }
      }
      
      html.screenshot-attempt * {
        visibility: hidden !important;
      }
      
      html.screenshot-attempt::after {
        content: 'Screen capture blocked';
        position: fixed;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #000;
        color: #fff;
        font-size: 24px;
        z-index: 999999;
        visibility: visible !important;
      }
    `
    document.head.appendChild(style)

    const handleScreenshot = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && /[345]/.test(e.key)) {
        document.documentElement.classList.add('screenshot-attempt')
        setTimeout(() => {
          document.documentElement.classList.remove('screenshot-attempt')
        }, 100)
      }
    }

    document.addEventListener('keydown', handleScreenshot, true)

    return () => {
      document.head.removeChild(style)
      document.removeEventListener('keydown', handleScreenshot, true)
    }
  }, [enabled])
}

export default useScreenCaptureProtection