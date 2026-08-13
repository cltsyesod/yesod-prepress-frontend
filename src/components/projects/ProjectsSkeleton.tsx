import { Skeleton } from '@/components/ui/skeleton'

export function ProjectsSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-7 w-32 bg-slate-200 rounded" />
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
        <Skeleton className="h-8 w-full mb-2" />
        <Skeleton className="h-8 w-full mb-2" />
        <Skeleton className="h-8 w-full mb-2" />
        <Skeleton className="h-8 w-full mb-2" />
        <Skeleton className="h-8 w-full" />
      </div>
    </div>
  )
}
