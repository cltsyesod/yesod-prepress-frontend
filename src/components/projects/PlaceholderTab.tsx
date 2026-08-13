import { Construction } from 'lucide-react'

interface PlaceholderTabProps {
  title: string
}

export function PlaceholderTab({ title }: PlaceholderTabProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white border border-slate-200 rounded-lg">
      <div className="p-3 bg-amber-50 rounded-full mb-3 text-amber-500">
        <Construction className="h-8 w-8" />
      </div>
      <h3 className="text-base font-semibold text-slate-800 mb-1">Em desenvolvimento</h3>
      <p className="text-sm text-slate-500 max-w-sm">
        A seção &ldquo;{title}&rdquo; estará disponível em breve.
      </p>
    </div>
  )
}
