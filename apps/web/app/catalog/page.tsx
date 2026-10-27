import { CatalogUpload } from '@/components/catalog/CatalogUpload';

export const metadata = { title: 'Catalog สินค้า · Thai Quotation Copilot' };

export default function CatalogPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-6 py-8">
      <h1 className="text-2xl font-bold">Catalog สินค้าและราคา</h1>
      <p className="text-sm text-zinc-600">
        อัปโหลดไฟล์ CSV รายการสินค้าและราคา ข้อมูลเก็บไว้ในเบราว์เซอร์นี้เท่านั้น (เดโมใช้ข้อมูลสังเคราะห์)
      </p>
      <CatalogUpload />
    </main>
  );
}
