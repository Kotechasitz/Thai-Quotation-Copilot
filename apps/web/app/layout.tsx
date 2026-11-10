import type { Metadata } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans_Thai } from 'next/font/google';
import localFont from 'next/font/local';
import './globals.css';
import { SiteNav } from '@/components/SiteNav';

// Sarabun (OFL-1.1, see ./fonts/OFL.txt) is self-hosted from ./fonts - nothing is fetched from Google Fonts at runtime.
// The files come from Fontsource, which splits Sarabun into a Thai and a Latin file per weight, so two font instances are chained
// in CSS (Latin first, Thai as the fallback for the glyphs it lacks).
const sarabunLatin = localFont({
  src: [
    { path: './fonts/sarabun-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/sarabun-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/sarabun-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-sarabun-latin',
  display: 'swap',
});

const sarabunThai = localFont({
  src: [
    { path: './fonts/sarabun-thai-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/sarabun-thai-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/sarabun-thai-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-sarabun-thai',
  display: 'swap',
});

// The app UI uses IBM Plex Sans Thai (OFL-1.1) and IBM Plex Mono for figures. next/font downloads them at build
// time and serves them from this app, so the browser never calls Google Fonts.
const plexThai = IBM_Plex_Sans_Thai({
  subsets: ['thai', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-thai',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Thai Quotation Copilot',
  description: 'สร้างใบเสนอราคาจากข้อความสั่งซื้อของลูกค้า (เดโม ใช้ข้อมูลสังเคราะห์เท่านั้น)',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={`${sarabunLatin.variable} ${sarabunThai.variable} ${plexThai.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <SiteNav />
        {children}
      </body>
    </html>
  );
}
