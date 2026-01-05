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

// Get list of all available files for context
async function getAvailableFiles(): Promise<string[]> {
  const files: string[] = []

  async function scanDir(dir: string, relativePath: string = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'context-machine' || entry.name === 'visualization') continue

      const fullPath = path.join(dir, entry.name)
      const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        await scanDir(fullPath, relPath)
      } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
        files.push(relPath)
      }
    }
  }

  await scanDir(BASE_PATH)
  return files
}

// Search files for relevant content
async function searchFiles(query: string): Promise<Array<{file: string, excerpt: string}>> {
  const files = await getAvailableFiles()
  const results: Array<{file: string, excerpt: string}> = []
  const queryLower = query.toLowerCase()

  for (const file of files) {
    try {
      const content = await getFileContent(file)
      const contentLower = content.toLowerCase()

      if (contentLower.includes(queryLower)) {
        // Find the matching section
        const idx = contentLower.indexOf(queryLower)
        const start = Math.max(0, idx - 100)
        const end = Math.min(content.length, idx + query.length + 200)
        const excerpt = content.substring(start, end)

        results.push({ file, excerpt: `...${excerpt}...` })

        if (results.length >= 3) break // Limit to 3 results
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return results
}

async function getAgentResponse(
  fileContent: string,
  filePath: string,
  selectedText: string,
  messages: CommentMessage[],
  userMessage: string
): Promise<{ response: string; diff?: { original: string; replacement: string; explanation: string } }> {
  const client = new Anthropic()

  // Get available files for context
  const availableFiles = await getAvailableFiles()

  // Search for related content if user mentions specific topics
  const searchTerms = userMessage.match(/(?:like|similar to|reference|from|in)\s+["']?([^"'\n]+)["']?/i)
  let relatedContent = ''

  if (searchTerms) {
    const results = await searchFiles(searchTerms[1])
    if (results.length > 0) {
      relatedContent = '\n\nRELATED CONTENT FOUND:\n' + results.map(r =>
        `--- ${r.file} ---\n${r.excerpt}`
      ).join('\n\n')
    }
  }

  const systemPrompt = `You are a marketing copywriting expert assistant for Dean Graziosi and Tony Robbins' AI Advantage campaigns.

## YOUR ROLE
You help review and improve campaign content - ads, testimonials, hooks, sales pages, etc. You understand:
- Dean's authentic, direct, emotionally-charged voice
- Tony's transformational, empowering style
- The AI Advantage product: helping entrepreneurs save 15+ hrs/week with AI
- Key pain points: overwhelm, FOMO, time scarcity, scaling challenges

## CONTEXT YOU HAVE ACCESS TO
Current file: ${filePath}
Available files in the project:
${availableFiles.slice(0, 20).map(f => `- ${f}`).join('\n')}
${availableFiles.length > 20 ? `... and ${availableFiles.length - 20} more files` : ''}

## HOW TO RESPOND
1. Analyze the selected text in context of the full document
2. Consider the user's comment/question
3. Provide actionable feedback

## PROPOSING EDITS
If you want to suggest a text change, use this EXACT format at the END of your response:

<propose_diff>
<original>exact text from the DOCUMENT CONTENT above</original>
<replacement>improved text</replacement>
<explanation>brief reason for change</explanation>
</propose_diff>

CRITICAL: The <original> MUST be copied EXACTLY from the "FULL DOCUMENT CONTENT" section - including all markdown syntax, line breaks, and formatting. Do NOT use the "SELECTED TEXT" for <original> because it may have formatting stripped. Find the corresponding section in the full document and copy it exactly.

## GUIDELINES
- Be concise and actionable
- Match the voice/style of the existing content
- Consider the target audience segment
- Reference other content from the project when relevant
- Suggest specific edits, not vague improvements`

  const contextMessage = `## DOCUMENT BEING EDITED
File: ${filePath}

### FULL DOCUMENT CONTENT:
\`\`\`
${fileContent}
\`\`\`

### SELECTED TEXT (what the user highlighted):
"${selectedText}"

### USER'S COMMENT:
${userMessage}
${relatedContent}`

  // Build conversation history
  const conversationHistory: Array<{role: 'user' | 'assistant', content: string}> = [
    { role: 'user', content: contextMessage }
  ]

  // Add previous messages if this is a reply
  for (let i = 0; i < messages.length - 1; i++) {
    const msg = messages[i]
    conversationHistory.push({
      role: msg.role,
      content: msg.content
    })
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: conversationHistory
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
    return { response: 'Sorry, I encountered an error processing your request. Please try again.' }
  }
}

// GET - List comments for a file
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const filePath = searchParams.get('filePath')

  const allComments = await loadComments()
  const comments = filePath
    ? allComments.filter(c => c.filePath === filePath)
    : allComments

  return NextResponse.json({ comments })
}

// POST - Create new comment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { filePath, selectionStart, selectionEnd, selectedText, message } = body

    const comments = await loadComments()
    const fileContent = await getFileContent(filePath)

    // Create user message
    const userMessage: CommentMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      createdAt: new Date().toISOString()
    }

    // Create comment
    const comment: Comment = {
      id: crypto.randomUUID(),
      filePath,
      selectionStart,
      selectionEnd,
      selectedText,
      status: 'open',
      messages: [userMessage],
      createdAt: new Date().toISOString()
    }

    // Get AI response with full context
    const { response, diff } = await getAgentResponse(
      fileContent,
      filePath,
      selectedText,
      comment.messages,
      message
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

    comments.push(comment)
    await saveComments(comments)

    return NextResponse.json({ comment })
  } catch (error) {
    console.error('Error creating comment:', error)
    return NextResponse.json({ error: 'Failed to create comment' }, { status: 500 })
  }
}
