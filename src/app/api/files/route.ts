import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs/promises'
import path from 'path'

const BASE_PATH = '/Users/ryanodonnell/projects/DG_27_AI_Frontend'
const EXCLUDED_DIRS = ['node_modules', '.git', 'visualization', 'context-machine']

interface FileNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FileNode[]
}

async function buildFileTree(dirPath: string, relativePath: string = ''): Promise<FileNode[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (EXCLUDED_DIRS.includes(entry.name)) continue
    if (entry.name.startsWith('.')) continue

    const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name

    if (entry.isDirectory()) {
      const children = await buildFileTree(
        path.join(dirPath, entry.name),
        entryRelativePath
      )
      if (children.length > 0) {
        nodes.push({
          name: entry.name,
          path: entryRelativePath,
          type: 'folder',
          children
        })
      }
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.json')) {
      nodes.push({
        name: entry.name,
        path: entryRelativePath,
        type: 'file'
      })
    }
  }

  // Sort: folders first, then files, alphabetically
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const filePath = searchParams.get('path')

  try {
    if (filePath) {
      // Read specific file
      const fullPath = path.join(BASE_PATH, filePath)
      const content = await fs.readFile(fullPath, 'utf-8')
      return NextResponse.json({ content })
    } else {
      // Get file tree
      const files = await buildFileTree(BASE_PATH)
      return NextResponse.json({ files })
    }
  } catch (error) {
    console.error('Error:', error)
    return NextResponse.json({ error: 'Failed to read' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { path: filePath, content } = await request.json()
    const fullPath = path.join(BASE_PATH, filePath)

    await fs.writeFile(fullPath, content, 'utf-8')

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error saving file:', error)
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  }
}
