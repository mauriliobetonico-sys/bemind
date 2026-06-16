import { cn } from '@/lib/utils'

interface Props { className?: string; size?: 'sm' | 'md' | 'lg' }

export function LoadingSpinner({ className, size = 'md' }: Props) {
  const sz = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }[size]
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <div className={cn('animate-spin rounded-full border-b-2 border-primary', sz)} />
    </div>
  )
}

export function PageLoading() {
  return (
    <div className="flex h-64 items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  )
}
