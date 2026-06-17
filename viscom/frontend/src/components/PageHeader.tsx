import { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  description?: string
  children?: ReactNode
}

export function PageHeader({ title, subtitle, description, children }: Props) {
  const sub = subtitle ?? description
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="text-muted-foreground mt-1">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  )
}
