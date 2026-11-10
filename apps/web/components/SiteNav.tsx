'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'สร้างใบเสนอราคา' },
  { href: '/catalog', label: 'Catalog' },
  { href: '/settings', label: 'ตั้งค่าบริษัท' },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-40 border-b bg-paper/90 backdrop-blur">
      <nav aria-label="เมนูหลัก" className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span aria-hidden="true" className="grid size-8 place-items-center rounded-lg bg-seal font-bold text-white">
            ใบ
          </span>
          <span className="leading-tight">
            <span className="block font-semibold">Thai Quotation Copilot</span>
            <span className="block text-[11px] text-muted-foreground">ใบเสนอราคาจากแชทลูกค้า</span>
          </span>
        </Link>
        <ul className="ml-auto flex gap-1 text-sm">
          {LINKS.map(({ href, label }) => {
            const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'block rounded-md border px-3 py-1.5 transition-colors',
                    isActive ? 'border-border bg-card font-medium shadow-sm' : 'border-transparent text-muted-foreground hover:bg-card',
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
        <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs text-amber-800">
          เดโม · ข้อมูลสังเคราะห์
        </span>
      </nav>
    </header>
  );
}
