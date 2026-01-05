import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const BASE_PATH = '/Users/ryanodonnell/projects/DG_27_AI_Frontend'
const COMMENTS_FILE = path.join(BASE_PATH, 'context-machine', '.comments.json')

interface Comment {
  id: string
  filePath: string
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
  createdAt: string
}

interface CommentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

async function loadComments(): Promise<Comment[]> {
  try {
    const data = await fs.readFile(COMMENTS_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return []
  }
}

async function saveComments(comments: Comment[]): Promise<void> {
  await fs.writeFile(COMMENTS_FILE, JSON.stringify(comments, null, 2))
}

// POST - Accept or reject diff
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { action } = body // 'accept' or 'reject'

    const comments = await loadComments()
    const commentIndex = comments.findIndex(c => c.id === id)

    if (commentIndex === -1) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    const comment = comments[commentIndex]

    if (!comment.proposedDiff) {
      return NextResponse.json({ error: 'No diff to process' }, { status: 400 })
    }

    if (action === 'accept') {
      // Read the file
      const filePath = path.join(BASE_PATH, comment.filePath)
      let content = await fs.readFile(filePath, 'utf-8')

      const { original, replacement } = comment.proposedDiff

      // Apply the diff
      if (!content.includes(original)) {
        return NextResponse.json({
          error: 'Original text not found in file. The file may have changed.',
        }, { status: 400 })
      }

      content = content.replace(original, replacement)

      // Save the file
      await fs.writeFile(filePath, content, 'utf-8')

      // Calculate position shift for other comments
      const positionShift = replacement.length - original.length
      const editEnd = comment.selectionEnd

      // Update positions of comments that come after this edit
      for (let i = 0; i < comments.length; i++) {
        if (i === commentIndex) continue
        if (comments[i].filePath !== comment.filePath) continue

        if (comments[i].selectionStart > editEnd) {
          comments[i].selectionStart += positionShift
          comments[i].selectionEnd += positionShift
        }
      }

      // Mark comment as resolved
      comment.status = 'resolved'
      delete comment.proposedDiff

      // Add system message
      comment.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: '✓ Change accepted and applied.',
        createdAt: new Date().toISOString()
      })

      comments[commentIndex] = comment
      await saveComments(comments)

      return NextResponse.json({
        comment,
        newContent: content
      })
    } else if (action === 'reject') {
      // Clear the diff
      delete comment.proposedDiff

      // Add message
      comment.messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: 'Understood. What would you like me to suggest instead?',
        createdAt: new Date().toISOString()
      })

      comments[commentIndex] = comment
      await saveComments(comments)

      return NextResponse.json({ comment })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('Error handling diff:', error)
    return NextResponse.json({ error: 'Failed to handle diff' }, { status: 500 })
  }
}
