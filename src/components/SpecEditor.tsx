'use client'

import { useState, useEffect, useRef } from 'react'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { marked } from 'marked'
import TurndownService from 'turndown'

// Configure turndown for clean markdown output
const turndown = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
})

// Preserve line breaks in paragraphs
turndown.addRule('paragraph', {
  filter: 'p',
  replacement: (content) => `\n${content}\n`
})

// Configure marked for HTML output - disable links
const renderer = new marked.Renderer()
renderer.link = ({ text }) => text // Convert links to plain text
marked.setOptions({
  breaks: true,
  gfm: true,
  renderer,
})

interface Comment {
  id: string
  selectionStart: number
  selectionEnd: number
  selectedText: string
  status: 'open' | 'resolved'
  messages: CommentMessage[]
  proposedDiff?: {
    original: string
    replacement: string
    explanation: string
  }
}

interface CommentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

interface SpecEditorProps {
  filePath: string
  content: string
  onSave: (content: string) => void
}

// Convert markdown to HTML using marked library
function markdownToHtml(markdown: string): string {
  return marked.parse(markdown, { async: false }) as string
}

// Convert HTML to markdown using turndown library
function htmlToMarkdown(html: string): string {
  return turndown.turndown(html)
}

export default function SpecEditor({ filePath, content, onSave }: SpecEditorProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [selectedComment, setSelectedComment] = useState<string | null>(null)
  const [selection, setSelection] = useState<{
    text: string
    rect: { top: number; left: number }
  } | null>(null)
  const [newCommentText, setNewCommentText] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
  const [showCommentModal, setShowCommentModal] = useState(false)
  const [highlights, setHighlights] = useState<Array<{
    commentId: string
    rects: DOMRect[]
  }>>([])

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSavedContent = useRef(content)
  const editorContainerRef = useRef<HTMLDivElement>(null)

  // Store selection positions for new comments
  const pendingSelectionRef = useRef<{ from: number; to: number } | null>(null)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4],
        },
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
    ],
    content: markdownToHtml(content),
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-purple max-w-none focus:outline-none min-h-full p-6',
      },
    },
    onUpdate: ({ editor }) => {
      setHasUnsavedChanges(true)
    },
    onSelectionUpdate: ({ editor }) => {
      handleEditorSelection(editor)
    },
  })

  // Update editor content when file changes
  useEffect(() => {
    if (editor && content !== lastSavedContent.current) {
      editor.commands.setContent(markdownToHtml(content))
      lastSavedContent.current = content
    }
    setSelection(null)
    setHasUnsavedChanges(false)
    loadComments()
  }, [filePath, content, editor])

  // Auto-save with debounce
  useEffect(() => {
    if (hasUnsavedChanges && editor) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
      saveTimeoutRef.current = setTimeout(() => {
        const markdown = htmlToMarkdown(editor.getHTML())
        onSave(markdown)
        lastSavedContent.current = markdown
        setHasUnsavedChanges(false)
      }, 2000)
    }
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
    }
  }, [hasUnsavedChanges, editor, onSave])

  function handleEditorSelection(editor: Editor) {
    const { from, to } = editor.state.selection
    if (from === to) {
      // No selection - clear it after a small delay (allows clicking)
      setTimeout(() => {
        if (editor.state.selection.from === editor.state.selection.to) {
          setSelection(null)
          setShowCommentModal(false)
        }
      }, 200)
      return
    }
    // Just track selection state, don't show modal yet (wait for mouseup)
  }

  // Show modal only after mouse is released (selection complete)
  useEffect(() => {
    if (!editor) return

    const handleMouseUp = () => {
      // Small delay to let selection finalize
      setTimeout(() => {
        const { from, to } = editor.state.selection
        if (from !== to) {
          const text = editor.state.doc.textBetween(from, to, ' ')
          if (text.trim().length >= 3) {
            const coords = editor.view.coordsAtPos(from)
            // Store positions for when comment is created
            pendingSelectionRef.current = { from, to }
            setSelection({
              text: text.trim(),
              rect: {
                top: coords.bottom + window.scrollY,
                left: coords.left + window.scrollX
              }
            })
            setShowCommentModal(true)
          }
        }
      }, 100)
    }

    const editorElement = editor.view.dom
    editorElement.addEventListener('mouseup', handleMouseUp)

    return () => {
      editorElement.removeEventListener('mouseup', handleMouseUp)
    }
  }, [editor])

  // Calculate highlight positions for open comments
  useEffect(() => {
    if (!editor || !editorContainerRef.current) return

    const openCommentsList = comments.filter(c => c.status === 'open')
    const newHighlights: Array<{ commentId: string; rects: DOMRect[] }> = []

    const editorDom = editor.view.dom
    const containerRect = editorContainerRef.current.getBoundingClientRect()

    openCommentsList.forEach(comment => {
      const searchText = comment.selectedText
      if (!searchText || searchText.length < 3) return

      // Find text in DOM using TreeWalker
      const walker = document.createTreeWalker(editorDom, NodeFilter.SHOW_TEXT, null)
      let node: Text | null

      while ((node = walker.nextNode() as Text)) {
        const nodeText = node.textContent || ''
        const index = nodeText.indexOf(searchText)

        if (index !== -1) {
          try {
            const range = document.createRange()
            range.setStart(node, index)
            range.setEnd(node, Math.min(index + searchText.length, nodeText.length))

            const rects = Array.from(range.getClientRects()).map(rect => ({
              ...rect.toJSON(),
              top: rect.top - containerRect.top + editorContainerRef.current!.scrollTop,
              left: rect.left - containerRect.left,
            })) as DOMRect[]

            if (rects.length > 0) {
              newHighlights.push({ commentId: comment.id, rects })
            }
          } catch {
            // Ignore errors
          }
          break
        }
      }
    })

    setHighlights(newHighlights)
  }, [editor, comments])

  async function loadComments() {
    try {
      const res = await fetch(`/api/comments?filePath=${encodeURIComponent(filePath)}`)
      const data = await res.json()
      setComments(data.comments || [])
    } catch (error) {
      console.error('Error loading comments:', error)
    }
  }

  function clearSelection() {
    setSelection(null)
    setNewCommentText('')
    setShowCommentModal(false)
  }

  async function handleCreateComment() {
    if (!selection || !newCommentText.trim()) return

    const positions = pendingSelectionRef.current
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath,
          selectionStart: positions?.from || 0,
          selectionEnd: positions?.to || 0,
          selectedText: selection.text,
          message: newCommentText
        })
      })
      const data = await res.json()

      if (data.comment) {
        setComments(prev => [...prev, data.comment])
        setSelectedComment(data.comment.id)
      }

      pendingSelectionRef.current = null
      clearSelection()
    } catch (error) {
      console.error('Error creating comment:', error)
    }
    setIsSubmitting(false)
  }

  async function handleReply(commentId: string, message: string) {
    if (!message.trim()) return

    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/comments/${commentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message })
      })
      const data = await res.json()

      if (data.comment) {
        setComments(prev => prev.map(c => c.id === commentId ? data.comment : c))
      }
    } catch (error) {
      console.error('Error replying:', error)
    }
    setIsSubmitting(false)
  }

  async function handleDiffAction(commentId: string, action: 'accept' | 'reject') {
    setIsSubmitting(true)
    try {
      const res = await fetch(`/api/comments/${commentId}/diff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      })
      const data = await res.json()

      if (action === 'accept' && data.newContent && editor) {
        editor.commands.setContent(markdownToHtml(data.newContent))
        lastSavedContent.current = data.newContent
      }

      if (data.comment) {
        setComments(prev => prev.map(c => c.id === commentId ? data.comment : c))
      }

      await loadComments()
    } catch (error) {
      console.error('Error handling diff:', error)
    }
    setIsSubmitting(false)
  }

  async function handleResolve(commentId: string) {
    try {
      const res = await fetch(`/api/comments/${commentId}/resolve`, { method: 'POST' })
      const data = await res.json()
      if (data.comment) {
        // Remove resolved comment from view
        setComments(prev => prev.filter(c => c.id !== commentId))
        setSelectedComment(null)
      }
    } catch (error) {
      console.error('Error resolving:', error)
    }
  }

  const openComments = comments.filter(c => c.status === 'open')

  return (
    <div className="flex h-full">
      {/* Main Editor */}
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-white/10 bg-white/[0.02]">
          <div>
            <div className="text-purple-400 text-xs font-mono">{filePath}</div>
            <div className="text-lg font-semibold">{filePath.split('/').pop()}</div>
          </div>
          <div className="flex items-center gap-3 text-xs">
            {hasUnsavedChanges ? (
              <span className="text-amber-400">Saving...</span>
            ) : (
              <span className="text-white/30">Saved</span>
            )}
            {openComments.length > 0 && (
              <span className="text-amber-400 px-2 py-1 bg-amber-500/10 rounded-full">
                {openComments.length} comment{openComments.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* Formatting Toolbar */}
        {editor && (
          <div className="flex items-center gap-1 px-6 py-2 border-b border-white/10 bg-white/[0.01]">
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('heading', { level: 1 }) ? 'bg-purple-600' : 'hover:bg-white/10'}`}
            >
              H1
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('heading', { level: 2 }) ? 'bg-purple-600' : 'hover:bg-white/10'}`}
            >
              H2
            </button>
            <button
              onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('heading', { level: 3 }) ? 'bg-purple-600' : 'hover:bg-white/10'}`}
            >
              H3
            </button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`px-2 py-1 text-xs rounded font-bold ${editor.isActive('bold') ? 'bg-purple-600' : 'hover:bg-white/10'}`}
            >
              B
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`px-2 py-1 text-xs rounded italic ${editor.isActive('italic') ? 'bg-purple-600' : 'hover:bg-white/10'}`}
            >
              I
            </button>
            <button
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={`px-2 py-1 text-xs rounded font-mono ${editor.isActive('code') ? 'bg-purple-600' : 'hover:bg-white/10'}`}
            >
              {'</>'}
            </button>
            <div className="w-px h-4 bg-white/10 mx-1" />
            <button
              onClick={() => editor.chain().focus().toggleBulletList().run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('bulletList') ? 'bg-purple-600' : 'hover:bg-white/10'}`}
            >
              List
            </button>
            <button
              onClick={() => editor.chain().focus().toggleBlockquote().run()}
              className={`px-2 py-1 text-xs rounded ${editor.isActive('blockquote') ? 'bg-purple-600' : 'hover:bg-white/10'}`}
            >
              Quote
            </button>
          </div>
        )}

        {/* TipTap Editor */}
        <div className="flex-1 overflow-y-auto relative" ref={editorContainerRef}>
          {/* Highlight overlays for open comments */}
          {highlights.map(highlight => (
            highlight.rects.map((rect, idx) => (
              <div
                key={`${highlight.commentId}-${idx}`}
                className="absolute bg-yellow-400/30 cursor-pointer hover:bg-yellow-400/50 transition-colors"
                style={{
                  top: rect.top,
                  left: rect.left,
                  width: rect.width,
                  height: rect.height,
                  pointerEvents: 'auto',
                  zIndex: 5,
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedComment(highlight.commentId)
                }}
              />
            ))
          ))}
          <style jsx global>{`
            .ProseMirror {
              min-height: 100%;
              outline: none;
              color: rgba(255, 255, 255, 0.85);
              line-height: 1.7;
            }
            .ProseMirror h1 {
              font-size: 1.875rem;
              font-weight: 700;
              color: white;
              margin-top: 1.5rem;
              margin-bottom: 0.75rem;
              padding-bottom: 0.5rem;
              border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .ProseMirror h2 {
              font-size: 1.5rem;
              font-weight: 600;
              color: #a855f7;
              margin-top: 1.25rem;
              margin-bottom: 0.5rem;
            }
            .ProseMirror h3 {
              font-size: 1.25rem;
              font-weight: 600;
              color: rgba(255, 255, 255, 0.9);
              margin-top: 1rem;
              margin-bottom: 0.5rem;
            }
            .ProseMirror h4 {
              font-size: 1.125rem;
              font-weight: 500;
              color: rgba(255, 255, 255, 0.8);
              margin-top: 0.75rem;
              margin-bottom: 0.25rem;
            }
            .ProseMirror p {
              margin: 0.5rem 0;
            }
            .ProseMirror strong {
              font-weight: 600;
              color: white;
            }
            .ProseMirror em {
              font-style: italic;
            }
            .ProseMirror code {
              background: rgba(168, 85, 247, 0.2);
              color: #c4b5fd;
              padding: 0.125rem 0.25rem;
              border-radius: 0.25rem;
              font-size: 0.875rem;
            }
            .ProseMirror ul, .ProseMirror ol {
              margin-left: 1.5rem;
              margin-top: 0.5rem;
              margin-bottom: 0.5rem;
            }
            .ProseMirror li {
              margin: 0.25rem 0;
            }
            .ProseMirror li::marker {
              color: #a855f7;
            }
            .ProseMirror blockquote {
              border-left: 3px solid #a855f7;
              padding-left: 1rem;
              margin: 0.5rem 0;
              font-style: italic;
              color: rgba(255, 255, 255, 0.7);
            }
            .ProseMirror hr {
              border: none;
              border-top: 1px solid rgba(255, 255, 255, 0.1);
              margin: 1rem 0;
            }
            .ProseMirror a {
              color: #a855f7;
            }
            .ProseMirror a:hover {
              text-decoration: underline;
            }
            .ProseMirror p.is-editor-empty:first-child::before {
              color: rgba(255, 255, 255, 0.3);
              content: attr(data-placeholder);
              float: left;
              height: 0;
              pointer-events: none;
            }
          `}</style>
          <div className="max-w-4xl mx-auto">
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>

      {/* Comments Sidebar */}
      <div className="w-[360px] border-l border-white/10 h-full overflow-y-auto bg-[#0c0c12]">
        <div className="p-4 border-b border-white/10 sticky top-0 bg-[#0c0c12] z-10">
          <h3 className="font-semibold">Comments</h3>
          <p className="text-xs text-white/40 mt-1">Select text to add feedback</p>
        </div>

        <div className="p-3 space-y-3">
          {openComments.length === 0 && (
            <div className="text-white/30 text-sm text-center py-10">
              <div className="text-3xl mb-2">💬</div>
              <p>No comments yet</p>
            </div>
          )}

          {openComments.map((comment) => (
            <CommentCard
              key={comment.id}
              comment={comment}
              isSelected={selectedComment === comment.id}
              onSelect={() => setSelectedComment(comment.id)}
              onReply={(text) => handleReply(comment.id, text)}
              onDiffAction={(action) => handleDiffAction(comment.id, action)}
              onResolve={() => handleResolve(comment.id)}
              isSubmitting={isSubmitting}
            />
          ))}

        </div>
      </div>

      {/* Floating Comment Modal */}
      {showCommentModal && selection && (
        <>
          <div className="fixed inset-0 z-40" onClick={clearSelection} />
          <div
            className="fixed z-50 w-[400px] bg-[#1a1a2e] border border-purple-500/40 rounded-xl shadow-2xl overflow-hidden"
            style={{
              top: Math.min(selection.rect.top + 10, window.innerHeight - 300),
              left: Math.min(Math.max(selection.rect.left - 100, 20), window.innerWidth - 420)
            }}
          >
            <div className="p-4">
              <div className="text-xs text-purple-400 font-medium mb-2">SELECTED TEXT</div>
              <div className="text-sm text-white/80 bg-black/30 p-3 rounded-lg max-h-24 overflow-y-auto border border-white/10 mb-3">
                {selection.text.length > 150 ? selection.text.slice(0, 150) + '...' : selection.text}
              </div>
              <textarea
                value={newCommentText}
                onChange={(e) => setNewCommentText(e.target.value)}
                placeholder="What would you like to change or ask?"
                className="w-full bg-black/30 border border-white/10 rounded-lg p-3 text-sm text-white resize-none focus:outline-none focus:border-purple-500/50"
                rows={3}
                autoFocus
              />
              <div className="flex justify-end gap-2 mt-3">
                <button
                  onClick={clearSelection}
                  className="px-4 py-2 text-sm text-white/60 hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateComment}
                  disabled={!newCommentText.trim() || isSubmitting}
                  className="px-5 py-2 text-sm bg-purple-600 hover:bg-purple-500 rounded-lg font-medium disabled:opacity-50"
                >
                  {isSubmitting ? 'Analyzing...' : 'Get AI Feedback'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Clean up AI response - remove XML tags and format nicely
function cleanAIResponse(content: string): string {
  // Remove the propose_diff XML block entirely
  let cleaned = content.replace(/<propose_diff>[\s\S]*?<\/propose_diff>/g, '').trim()
  // Remove any stray XML-like tags
  cleaned = cleaned.replace(/<\/?(?:original|replacement|explanation)>/g, '')
  return cleaned
}

function CommentCard({
  comment,
  isSelected,
  onSelect,
  onReply,
  onDiffAction,
  onResolve,
  isSubmitting,
  isResolved
}: {
  comment: Comment
  isSelected: boolean
  onSelect: () => void
  onReply: (text: string) => void
  onDiffAction: (action: 'accept' | 'reject') => void
  onResolve: () => void
  isSubmitting: boolean
  isResolved?: boolean
}) {
  const [localReply, setLocalReply] = useState('')
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className={`rounded-lg border transition-all cursor-pointer text-sm ${
        isSelected
          ? 'border-purple-500/50 bg-purple-500/10'
          : isResolved
          ? 'border-white/5 bg-white/[0.02] opacity-50'
          : 'border-white/10 bg-white/[0.02] hover:border-white/20'
      }`}
      onClick={onSelect}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-white/5">
        <span className={`text-xs px-2 py-0.5 rounded-full ${
          isResolved ? 'text-green-400 bg-green-500/20' : 'text-amber-400 bg-amber-500/20'
        }`}>
          {isResolved ? '✓' : '●'}
        </span>
        <div className="text-white/50 text-xs mt-2 line-clamp-2">
          "{comment.selectedText.slice(0, 60)}{comment.selectedText.length > 60 ? '...' : ''}"
        </div>
      </div>

      {/* Messages */}
      <div className="px-3 py-2 space-y-2">
        {comment.messages.map((msg) => {
          const displayContent = msg.role === 'assistant' ? cleanAIResponse(msg.content) : msg.content
          const isLong = displayContent.length > 200
          const showFull = expanded || !isLong

          return (
            <div key={msg.id}>
              <div className={`text-xs mb-0.5 ${msg.role === 'assistant' ? 'text-purple-400' : 'text-white/40'}`}>
                {msg.role === 'user' ? 'You' : 'AI'}
              </div>
              <div className={`text-white/80 text-xs leading-relaxed ${
                msg.role === 'assistant' ? 'pl-2 border-l-2 border-purple-500/50' : ''
              }`}>
                {showFull ? displayContent : displayContent.slice(0, 200) + '...'}
                {isLong && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                    className="text-purple-400 hover:text-purple-300 ml-1"
                  >
                    {expanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Diff */}
      {comment.proposedDiff && isSelected && !isResolved && (
        <div className="mx-2 mb-2 p-2 bg-purple-900/30 border border-purple-700/30 rounded-lg">
          <div className="text-xs text-purple-400 mb-1">Suggested:</div>
          <div className="text-xs space-y-1">
            <div className="text-red-400 line-through bg-red-500/10 p-1 rounded">{comment.proposedDiff.original}</div>
            <div className="text-green-400 bg-green-500/10 p-1 rounded">{comment.proposedDiff.replacement}</div>
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={(e) => { e.stopPropagation(); onDiffAction('accept'); }}
              disabled={isSubmitting}
              className="flex-1 py-1.5 text-xs bg-green-600 hover:bg-green-500 rounded font-medium disabled:opacity-50"
            >
              Accept
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDiffAction('reject'); }}
              disabled={isSubmitting}
              className="flex-1 py-1.5 text-xs bg-white/10 hover:bg-white/20 rounded disabled:opacity-50"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Reply */}
      {isSelected && !isResolved && (
        <div className="px-2 pb-2 pt-1 border-t border-white/5">
          <textarea
            value={localReply}
            onChange={(e) => setLocalReply(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            placeholder="Reply..."
            className="w-full bg-black/30 border border-white/10 rounded p-2 text-xs text-white resize-none focus:outline-none focus:border-purple-500/50"
            rows={2}
          />
          <div className="flex justify-between mt-1">
            <button
              onClick={(e) => { e.stopPropagation(); onResolve(); }}
              className="text-xs text-white/30 hover:text-white"
            >
              Resolve
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (localReply.trim()) {
                  onReply(localReply)
                  setLocalReply('')
                }
              }}
              disabled={!localReply.trim() || isSubmitting}
              className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-500 rounded font-medium disabled:opacity-50"
            >
              Reply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
