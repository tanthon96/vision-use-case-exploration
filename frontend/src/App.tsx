import { useEffect, useMemo, useState } from 'react'
import { Loader2, Image as ImageIcon, PanelRightClose } from 'lucide-react'
import { clsx } from 'clsx'
import { Sidebar, type SidebarTab } from './components/Layout/Sidebar'
import { Header } from './components/Layout/Header'
import { ChatInterface } from './components/Chat/ChatInterface'
import { SkillsPanel } from './components/Skills/SkillsPanel'
import { SettingsPanel } from './components/Settings/SettingsPanel'
import { ImagePanel } from './components/ImagePanel/ImagePanel'
import { ChatHistoryPanel } from './components/ChatHistory/ChatHistoryPanel'
import { LoginPage } from './components/Auth/LoginPage'
import { AcceptInvitePage } from './components/Auth/AcceptInvitePage'
import { useAuthStore } from './stores/authStore'
import { useWorkspaceStore } from './stores/workspaceStore'
import { useChatHistoryStore } from './stores/chatHistoryStore'
import { useSkillsStore } from './stores/skillsStore'
import { useImagePanelStore } from './stores/imagePanelStore'
import { api } from './api/client'
import type { ImageInput } from './types'

const NARROW_BREAKPOINT = 1100

export default function App() {
  const authStatus = useAuthStore((s) => s.status)
  const hydrate = useAuthStore((s) => s.hydrate)

  useEffect(() => { hydrate() }, [hydrate])

  const inviteToken = useMemo(() => {
    if (typeof window === 'undefined') return null
    const url = new URL(window.location.href)
    if (url.pathname.startsWith('/accept-invite')) {
      return url.searchParams.get('token')
    }
    return null
  }, [])

  if (inviteToken !== null) return <AcceptInvitePage token={inviteToken} />
  if (authStatus === 'loading') return <FullPageSpinner />
  if (authStatus === 'anonymous') return <LoginPage />
  return <AuthedApp />
}


function FullPageSpinner() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background text-muted-foreground">
      <Loader2 size={20} className="animate-spin" />
    </div>
  )
}


function AuthedApp() {
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chats')
  const [isNarrow, setIsNarrow] = useState(
    typeof window !== 'undefined' && window.innerWidth < NARROW_BREAKPOINT
  )
  // The canvas is the collapsible panel now (conversation is the primary,
  // flexible panel), so hiding the canvas lets the conversation fill the width.
  const [canvasOpen, setCanvasOpen] = useState(true)

  // Canvas width is user-resizable via the drag handle between the two panels;
  // the conversation (flex-1) takes whatever is left. Persisted across reloads.
  const [canvasWidth, setCanvasWidth] = useState(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('canvasWidth') : null
    const n = saved ? parseInt(saved, 10) : NaN
    return Number.isFinite(n) ? n : 440
  })

  useEffect(() => {
    window.localStorage.setItem('canvasWidth', String(canvasWidth))
  }, [canvasWidth])

  const startCanvasResize = (e: React.MouseEvent) => {
    e.preventDefault()
    const onMove = (ev: MouseEvent) => {
      // Canvas is anchored to the right edge, so its width grows as the cursor
      // moves left. Clamp so both the canvas and conversation stay usable.
      const next = window.innerWidth - ev.clientX
      const max = Math.max(320, window.innerWidth - 632) // leave room for left panels + conversation
      setCanvasWidth(Math.min(Math.max(next, 320), max))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // Hydrate the workspace list once, and keep dependent stores in sync.
  const hydrateWorkspaces = useWorkspaceStore((s) => s.hydrate)
  const currentWorkspaceId = useWorkspaceStore((s) => s.currentId)
  const setChatHistoryWorkspace = useChatHistoryStore((s) => s.setWorkspaceId)
  const setSkillsWorkspace = useSkillsStore((s) => s.setWorkspaceId)
  const setImages = useImagePanelStore((s) => s.setImages)

  useEffect(() => { hydrateWorkspaces() }, [hydrateWorkspaces])

  useEffect(() => {
    setChatHistoryWorkspace(currentWorkspaceId)
    setSkillsWorkspace(currentWorkspaceId)
  }, [currentWorkspaceId, setChatHistoryWorkspace, setSkillsWorkspace])

  // Re-hydrate the image panel whenever the workspace changes (including on
  // first load). Images are stored in S3 + Postgres; the panel store is
  // in-memory only, so we must reload from the server each session.
  useEffect(() => {
    if (!currentWorkspaceId) {
      setImages([])
      return
    }
    let cancelled = false
    api.images.list(currentWorkspaceId).then((imgs) => {
      if (cancelled) return
      setImages(
        imgs.map((img): ImageInput => ({
          id: img.id,
          data: '',
          name: img.original_name,
          preview: img.presigned_url,
          source: (img.source === 'webcam' || img.source === 'screen')
            ? img.source : 'upload',
          sha256: img.sha256,
        }))
      )
    }).catch(() => {
      // Silently ignore — panel stays empty rather than crashing.
    })
    return () => { cancelled = true }
  }, [currentWorkspaceId, setImages])

  useEffect(() => {
    const onResize = () => {
      const narrow = window.innerWidth < NARROW_BREAKPOINT
      setIsNarrow(narrow)
      if (narrow) setCanvasOpen(false)
    }
    window.addEventListener('resize', onResize)
    onResize()
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <Header
        chatToggle={
          <button
            onClick={() => setCanvasOpen(!canvasOpen)}
            className={clsx(
              'h-7 w-7 rounded-soft inline-flex items-center justify-center transition-colors',
              canvasOpen
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            )}
            title={canvasOpen ? 'Hide canvas' : 'Show canvas'}
          >
            {canvasOpen ? <PanelRightClose size={13} /> : <ImageIcon size={13} />}
          </button>
        }
      />

      <div className="flex flex-1 min-h-0 relative">
        <Sidebar activeTab={sidebarTab} onTabChange={setSidebarTab} />

        <div className="w-56 border-r border-border bg-surface overflow-hidden flex flex-col shrink-0">
          {sidebarTab === 'chats' && <ChatHistoryPanel />}
          {sidebarTab === 'skills' && <SkillsPanel />}
          {sidebarTab === 'settings' && <SettingsPanel />}
        </div>

        {/* Conversation — primary, flexible panel (3rd from the left) */}
        <div className="flex-1 min-w-0 border-r border-border">
          <ChatInterface />
        </div>

        {/* Drag handle to resize the conversation / canvas split (wide only) */}
        {canvasOpen && !isNarrow && (
          <div
            onMouseDown={startCanvasResize}
            role="separator"
            aria-orientation="vertical"
            title="Drag to resize"
            className="w-1 shrink-0 cursor-col-resize bg-border hover:bg-primary/50 active:bg-primary transition-colors"
          />
        )}

        {/* Canvas — last panel, collapsible so the conversation can expand */}
        {canvasOpen && (
          <div
            style={isNarrow ? undefined : { width: canvasWidth }}
            className={clsx(
              isNarrow
                ? 'absolute right-0 top-0 bottom-0 z-30 w-[min(100%,520px)] shadow-raised bg-background'
                : 'shrink-0'
            )}
          >
            <ImagePanel />
          </div>
        )}

        {!canvasOpen && (
          <button
            onClick={() => setCanvasOpen(true)}
            className="absolute right-3 bottom-3 z-20 h-10 w-10 rounded-cushion bg-primary text-primary-foreground shadow-raised inline-flex items-center justify-center hover:opacity-90"
            title="Open canvas"
          >
            <ImageIcon size={16} />
          </button>
        )}
      </div>
    </div>
  )
}
