import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'
import Anthropic from '@anthropic-ai/sdk'

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

async function getAgentResponse(
  fileContent: string,
  filePath: string,
  selectedText: string,
  messages: CommentMessage[]
): Promise<{ response: string; diff?: { original: string; replacement: string; explanation: string } }> {
  const client = new Anthropic()

  const systemPrompt = `You are a marketing copywriting expert assistant helping review and improve campaign content for Dean Graziosi and Tony Robbins' AI Advantage campaigns.

You're reviewing a file from the campaign context machine. When the user comments on selected text, analyze it and either:
1. Provide feedback/discussion
2. Propose a specific edit using the propose_diff format

IMPORTANT: If you want to suggest an edit, you MUST use this exact format at the END of your response:

<propose_diff>
<original>exact text to replace</original>
<replacement>new text</replacement>
<explanation>why this change improves the copy</explanation>
</propose_diff>

The <original> text MUST exactly match text from the selected portion. Be concise and actionable.`

  const conversationMessages = messages.map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content
  }))

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `File: ${filePath}\n\nSelected text: "${selectedText}"\n\nFull context:\n${fileContent.substring(0, 3000)}...`
        },
        ...conversationMessages
      ]
    })

    const assistantResponse = response.content[0].type === 'text'
      ? response.content[0].text
      : ''

    // Parse for proposed diff
    const diffMatch = assistantResponse.match(
      /<propose_diff>\s*<original>([\s\S]*?)<\/original>\s*<replacement>([\s\S]*?)<\/replacement>\s*<explanation>([\s\S]*?)<\/explanation>\s*<\/propose_diff>/
    )

    let diff: { original: string; replacement: string; explanation: string } | undefined
    let cleanResponse = assistantResponse

    if (diffMatch) {
      diff = {
        original: diffMatch[1].trim(),
        replacement: diffMatch[2].trim(),
        explanation: diffMatch[3].trim()
      }
      cleanResponse = assistantResponse.replace(diffMatch[0], '').trim()
    }

    return { response: cleanResponse, diff }
  } catch (error) {
    console.error('Claude API error:', error)
    return { response: 'Sorry, I encountered an error processing your request.' }
  }
}

// POST - Reply to comment
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { message } = body

    const comments = await loadComments()
    const commentIndex = comments.findIndex(c => c.id === id)

    if (commentIndex === -1) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 })
    }

    const comment = comments[commentIndex]
    const fileContent = await getFileContent(comment.filePath)

    // Add user message
    const userMessage: CommentMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      createdAt: new Date().toISOString()
    }
    comment.messages.push(userMessage)

    // Clear previous diff
    delete comment.proposedDiff

    // Get AI response
    const { response, diff } = await getAgentResponse(
      fileContent,
      comment.filePath,
      comment.selectedText,
      comment.messages
    )

    // Add assistant message
    const assistantMessage: CommentMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: response,
      createdAt: new Date().toISOString()
    }
    comment.messages.push(assistantMessage)

    if (diff) {
      comment.proposedDiff = diff
    }

    comments[commentIndex] = comment
    await saveComments(comments)

    return NextResponse.json({ comment })
  } catch (error) {
    console.error('Error replying to comment:', error)
    return NextResponse.json({ error: 'Failed to reply' }, { status: 500 })
  }
}
