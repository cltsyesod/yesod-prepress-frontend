import { Skeleton } from '@/components/ui/skeleton'

export function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-7 w-48 bg-[#2A374A] rounded mb-6" />
      <div className="bg-[#182233] border border-[#2A374A] rounded-lg p-3 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      </div>
      <div className="bg-[#1E293B] rounded-lg p-1 inline-flex gap-1 mb-4">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-[#182233] border border-[#2A374A] rounded-lg p-4 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-[#182233] border border-[#2A374A] rounded-lg p-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
        <div className="bg-[#182233] border border-[#2A374A] rounded-lg p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
