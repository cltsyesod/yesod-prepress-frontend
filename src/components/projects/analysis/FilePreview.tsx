import { useState, useEffect, useRef } from 'react'
import { ZoomIn, ZoomOut, Maximize, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { AnalysisProblem } from '@/types'

interface FilePreviewProps {
  problems: AnalysisProblem[]
  selectedProblemId: string | null
  viewRequest: { page: number; key: number } | null
  onMarkingClick: (problemId: string) => void
  onPageChange?: (page: number) => void
}

const TOTAL_PAGES = 3

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500/40 border-red-600 hover:bg-red-500/60',
  warning: 'bg-amber-500/40 border-amber-600 hover:bg-amber-500/60',
  info: 'bg-blue-500/40 border-blue-600 hover:bg-blue-500/60',
}

export function FilePreview({
  problems,
  selectedProblemId,
  viewRequest,
  onMarkingClick,
  onPageChange,
}: FilePreviewProps) {
  const [zoom, setZoom] = useState(0.7)
  const [page, setPage] = useState(1)
  const [showMarkings, setShowMarkings] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (viewRequest) {
      setPage(viewRequest.page)
      onPageChange?.(viewRequest.page)
    }
  }, [viewRequest?.key])

  const pageProblems = problems.filter((p) => p.page === page)

  const changePage = (newPage: number) => {
    const clamped = Math.min(TOTAL_PAGES, Math.max(1, newPage))
    setPage(clamped)
    onPageChange?.(clamped)
  }

  const fitToScreen = () => {
    if (!containerRef.current) return
    const containerWidth = containerRef.current.clientWidth - 32
    setZoom(Math.min(1, Math.max(0.4, containerWidth / 595)))
  }

  return (
    <div className="flex flex-col h-full bg-card border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-muted/50">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}
            className="h-7 w-7 p-0"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground w-9 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom((z) => Math.min(2, z + 0.15))}
            className="h-7 w-7 p-0"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={fitToScreen} className="h-7 w-7 p-0">
            <Maximize className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowMarkings((v) => !v)}
            className="h-7 px-2 text-xs gap-1 text-muted-foreground hover:text-foreground"
          >
            {showMarkings ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            {showMarkings ? 'Ocultar' : 'Mostrar'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={page <= 1}
            onClick={() => changePage(page - 1)}
            className="h-7 w-7 p-0"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground">
            {page}/{TOTAL_PAGES}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={page >= TOTAL_PAGES}
            onClick={() => changePage(page + 1)}
            className="h-7 w-7 p-0"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-muted flex justify-center p-4"
        style={{ minHeight: '420px' }}
      >
        <div style={{ width: 595 * zoom, height: 842 * zoom }}>
          <div
            className="bg-white shadow-lg relative"
            style={{
              width: 595,
              height: 842,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
            }}
          >
            <div className="w-full h-full p-12 flex flex-col gap-4">
              <div className="h-8 bg-slate-200 rounded w-3/4" />
              <div className="h-3 bg-slate-100 rounded w-full" />
              <div className="h-3 bg-slate-100 rounded w-5/6" />
              <div className="h-32 bg-slate-100 rounded w-full mt-2" />
              <div className="h-3 bg-slate-100 rounded w-full" />
              <div className="h-3 bg-slate-100 rounded w-4/5" />
              <div className="h-24 bg-slate-100 rounded w-2/3" />
            </div>
            {showMarkings &&
              pageProblems.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onMarkingClick(p.id)}
                  className={cn(
                    'absolute border-2 rounded transition-all cursor-pointer',
                    SEVERITY_COLORS[p.severity] || SEVERITY_COLORS.info,
                    selectedProblemId === p.id && 'ring-2 ring-offset-1 ring-primary z-10',
                  )}
                  style={{
                    left: `${p.marking.x}%`,
                    top: `${p.marking.y}%`,
                    width: `${p.marking.w}%`,
                    height: `${p.marking.h}%`,
                  }}
                  title={p.name}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  )
}
