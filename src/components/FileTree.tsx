'use client'

import { useState } from 'react'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FileNode[]
}

interface FileTreeProps {
  files: FileNode[]
  selectedFile: string | null
  onSelect: (path: string) => void
}

const folderIcons: Record<string, string> = {
  campaigns: '🎯',
  testimonials: '⭐',
  research: '🔬',
  'swipe-files': '📚',
  'source-material': '🎬',
  notes: '💡',
}

const folderColors: Record<string, string> = {
  campaigns: 'from-blue-500 to-blue-700',
  testimonials: 'from-amber-500 to-amber-700',
  research: 'from-cyan-500 to-cyan-700',
  'swipe-files': 'from-red-500 to-red-700',
  'source-material': 'from-emerald-500 to-emerald-700',
  notes: 'from-purple-500 to-purple-700',
}

function FolderItem({
  node,
  depth = 0,
  selectedFile,
  onSelect
}: {
  node: FileNode
  depth?: number
  selectedFile: string | null
  onSelect: (path: string) => void
}) {
  const [isOpen, setIsOpen] = useState(true)

  const isTopLevel = depth === 0
  const icon = isTopLevel ? folderIcons[node.name] || '📁' : '📁'
  const colorClass = isTopLevel ? folderColors[node.name] || 'from-gray-500 to-gray-700' : ''

  return (
    <div>
      <div
        className={`flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-all hover:bg-purple-500/10 ${
          depth > 0 ? 'ml-4' : ''
        }`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={`text-white/30 text-xs transition-transform ${isOpen ? 'rotate-90' : ''}`}>
          ▶
        </span>
        {isTopLevel ? (
          <div className={`w-6 h-6 rounded-md bg-gradient-to-br ${colorClass} flex items-center justify-center text-xs`}>
            {icon}
          </div>
        ) : (
          <span className="text-sm">📁</span>
        )}
        <span className={`${isTopLevel ? 'font-semibold text-white/90' : 'text-white/70'} text-sm`}>
          {node.name}
        </span>
      </div>

      {isOpen && node.children && (
        <div className={`${depth > 0 ? 'ml-4 border-l border-white/5' : ''}`}>
          {node.children.map((child) =>
            child.type === 'folder' ? (
              <FolderItem
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedFile={selectedFile}
                onSelect={onSelect}
              />
            ) : (
              <FileItem
                key={child.path}
                node={child}
                depth={depth + 1}
                isSelected={selectedFile === child.path}
                onSelect={onSelect}
              />
            )
          )}
        </div>
      )}
    </div>
  )
}

function FileItem({
  node,
  depth,
  isSelected,
  onSelect
}: {
  node: FileNode
  depth: number
  isSelected: boolean
  onSelect: (path: string) => void
}) {
  const ext = node.name.split('.').pop()
  const icon = ext === 'json' ? '📊' : '📄'

  return (
    <div
      className={`flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-all ml-4 ${
        isSelected
          ? 'bg-purple-500/20 border border-purple-500/30'
          : 'hover:bg-purple-500/10'
      }`}
      onClick={() => onSelect(node.path)}
    >
      <span className="text-sm">{icon}</span>
      <span className="text-white/70 text-sm flex-1 truncate">{node.name}</span>
      <span className="text-white/30 text-xs px-1.5 py-0.5 bg-white/5 rounded">
        {ext}
      </span>
    </div>
  )
}

export default function FileTree({ files, selectedFile, onSelect }: FileTreeProps) {
  return (
    <div className="space-y-1">
      {files.map((node) =>
        node.type === 'folder' ? (
          <FolderItem
            key={node.path}
            node={node}
            selectedFile={selectedFile}
            onSelect={onSelect}
          />
        ) : (
          <FileItem
            key={node.path}
            node={node}
            depth={0}
            isSelected={selectedFile === node.path}
            onSelect={onSelect}
          />
        )
      )}
    </div>
  )
}
