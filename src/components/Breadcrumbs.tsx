import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export interface BreadcrumbItem {
  label: string
  href?: string
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  return (
    <nav
      className="flex items-center space-x-1.5 text-sm text-muted-foreground mb-1"
      aria-label="Breadcrumb"
    >
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          <div key={index} className="flex items-center">
            {index > 0 && (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mx-1 shrink-0" />
            )}
            {item.href && !isLast ? (
              <Link to={item.href} className="hover:text-primary transition-colors">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? 'font-medium text-foreground' : ''}>{item.label}</span>
            )}
          </div>
        )
      })}
    </nav>
  )
}
