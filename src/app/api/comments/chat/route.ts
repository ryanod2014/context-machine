import { NextRequest } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import { streamAgentResponse } from '@/lib/sdk-agent'

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

async function getFileContent(filePath: string): Promise<string> {
  const fullPath = path.join(BASE_PATH, filePath)
  return fs.readFile(fullPath, 'utf-8')
}

// POST - Create comment with streaming response
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { filePath, selectionStart, selectionEnd, selectedText, message } = body

    const comments = await loadComments()
    const fileContent = await getFileContent(filePath)

    // Create comment ID upfront
    const commentId = crypto.randomUUID()

    // Create user message
    const userMessage: CommentMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      createdAt: new Date().toISOString()
    }

    // Create comment (will be saved after streaming completes)
    const comment: Comment = {
      id: commentId,
      filePath,
      selectionStart,
      selectionEnd,
      selectedText,
      status: 'open',
      messages: [userMessage],
      createdAt: new Date().toISOString()
    }

    // Set up SSE streaming
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = ''

        try {
          // Send comment ID first
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'comment_id', id: commentId })}\n\n`))

          // Stream agent response
          for await (const event of streamAgentResponse(message, {
            filePath,
            selectedText,
            fileContent,
          })) {
            if (event.type === 'text') {
              fullResponse += event.content
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'text', content: event.content })}\n\n`))
            } else if (event.type === 'tool_use') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool', name: event.toolName, input: event.toolInput })}\n\n`))
            } else if (event.type === 'error') {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: event.content })}\n\n`))
            }
          }

          // Parse for proposed diff
          const diffMatch = fullResponse.match(
            /<propose_diff>\s*<original>([\s\S]*?)<\/original>\s*<replacement>([\s\S]*?)<\/replacement>\s*<explanation>([\s\S]*?)<\/explanation>\s*<\/propose_diff>/
          )

          let diff: { original: string; replacement: string; explanation: string } | undefined
          let cleanResponse = fullResponse

          if (diffMatch) {
            diff = {
              original: diffMatch[1].trim(),
              replacement: diffMatch[2].trim(),
              explanation: diffMatch[3].trim()
            }
            cleanResponse = fullResponse.replace(diffMatch[0], '').trim()
          }

          // Add assistant message
          const assistantMessage: CommentMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: cleanResponse,
            createdAt: new Date().toISOString()
          }
          comment.messages.push(assistantMessage)

          if (diff) {
            comment.proposedDiff = diff
          }

          // Save comment
          comments.push(comment)
          await saveComments(comments)

          // Send final comment data
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done', comment })}\n\n`))
          controller.close()
        } catch (error) {
          console.error('Stream error:', error)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', content: error instanceof Error ? error.message : 'Unknown error' })}\n\n`))
          controller.close()
        }
      }
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (error) {
    console.error('Error creating comment:', error)
    return new Response(JSON.stringify({ error: 'Failed to create comment' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
