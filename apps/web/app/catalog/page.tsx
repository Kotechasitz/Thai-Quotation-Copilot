import { CatalogUpload } from '@/components/catalog/CatalogUpload';
import { PageHeader } from '@/components/PageHeader';

export const metadata = { title: 'Catalog สินค้า · Thai Quotation Copilot' };

export default function CatalogPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="ข้อมูลสินค้า"
        title="Catalog สินค้าและราคา"
        description="อัปโหลดไฟล์ CSV รายการสินค้าและราคา ข้อมูลเก็บไว้ในเบราว์เซอร์นี้เท่านั้น (เดโมใช้ข้อมูลสังเคราะห์)"
      />
      <CatalogUpload />
    </main>
  );
}
