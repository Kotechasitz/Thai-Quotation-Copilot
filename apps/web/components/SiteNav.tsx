'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/', label: 'หน้าแรก' },
  { href: '/catalog', label: 'Catalog' },
  { href: '/settings', label: 'ตั้งค่าบริษัท' },
] as const;

export function SiteNav() {
  const pathname = usePathname();
  return (
    <header className="border-b bg-white">
      <nav aria-label="เมนูหลัก" className="mx-auto flex w-full max-w-3xl items-center gap-4 px-6 py-3 text-sm">
        <span className="font-bold">Thai Quotation Copilot</span>
        <ul className="flex gap-3">
          {LINKS.map(({ href, label }) => {
            const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn('hover:underline', isActive && 'font-semibold underline')}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
