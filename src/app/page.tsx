'use client'

import { useState, useEffect } from 'react'
import FileTree from '@/components/FileTree'
import SpecEditor from '@/components/SpecEditor'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children?: FileNode[]
}

export default function Home() {
  const [files, setFiles] = useState<FileNode[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileContent, setFileContent] = useState<string>('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchFiles()
  }, [])

  async function fetchFiles() {
    try {
      const res = await fetch('/api/files')
      const data = await res.json()
      setFiles(data.files)
      setLoading(false)
    } catch (error) {
      console.error('Error fetching files:', error)
      setLoading(false)
    }
  }

  async function handleFileSelect(path: string) {
    setSelectedFile(path)
    try {
      const res = await fetch(`/api/files?path=${encodeURIComponent(path)}`)
      const data = await res.json()
      setFileContent(data.content)
    } catch (error) {
      console.error('Error fetching file:', error)
    }
  }

  async function handleContentSave(newContent: string) {
    if (!selectedFile) return
    try {
      await fetch('/api/files', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedFile, content: newContent })
      })
      setFileContent(newContent)
    } catch (error) {
      console.error('Error saving file:', error)
    }
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <div className="w-[400px] min-w-[400px] h-full border-r border-white/10 flex flex-col">
        <div className="p-6 border-b border-white/10">
          <h1 className="text-2xl font-bold">
            Context <span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">Machine</span>
          </h1>
          <p className="text-white/40 text-sm mt-1">AI Advantage Campaign Intelligence</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-white/50 text-sm">Loading files...</div>
          ) : (
            <FileTree
              files={files}
              selectedFile={selectedFile}
              onSelect={handleFileSelect}
            />
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 h-full overflow-hidden">
        {selectedFile ? (
          <SpecEditor
            filePath={selectedFile}
            content={fileContent}
            onSave={handleContentSave}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-white/30">
            <div className="text-center">
              <div className="text-5xl mb-4">📂</div>
              <p>Select a file to edit</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
