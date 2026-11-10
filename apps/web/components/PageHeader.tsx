import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Small line above the title, e.g. "ขั้นที่ 1 จาก 3". */
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  /** Shown on the right of the title on wide screens (status chips, actions). */
  aside?: ReactNode;
}

/** The title block every page starts with. */
export function PageHeader({ eyebrow, title, description, aside }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        {eyebrow !== undefined && <p className="mb-2 text-sm font-medium text-seal">{eyebrow}</p>}
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {description !== undefined && <div className="mt-3 text-muted-foreground">{description}</div>}
      </div>
      {aside}
    </div>
  );
}
