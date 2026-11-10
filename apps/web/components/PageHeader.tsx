import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  /** Small line above the title, e.g. "ขั้นที่ 1 จาก 3". */
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  /** Shown on the right of the title on wide screens (status chips, actions). */
  aside?: ReactNode;
  /** Centre the block (landing-style pages). */
  centered?: boolean;
}

/** The title block every page starts with. */
export function PageHeader({ eyebrow, title, description, aside, centered = false }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-end gap-4', centered ? 'justify-center text-center' : 'justify-between')}>
      <div className={cn('max-w-2xl', centered && 'mx-auto')}>
        {eyebrow !== undefined && <p className="mb-2 text-sm font-medium text-seal">{eyebrow}</p>}
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {description !== undefined && <div className="mt-3 text-muted-foreground">{description}</div>}
      </div>
      {aside}
    </div>
  );
}
