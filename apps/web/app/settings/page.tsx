import { PageHeader } from '@/components/PageHeader';
import { CompanyForm } from '@/components/settings/CompanyForm';

export const metadata = { title: 'ตั้งค่าบริษัท · Thai Quotation Copilot' };

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10 sm:px-6">
      <PageHeader
        eyebrow="ข้อมูลบนหัวเอกสาร"
        title="ตั้งค่าบริษัท"
        description="ข้อมูลนี้จะแสดงบนหัวใบเสนอราคา เก็บไว้ในเบราว์เซอร์นี้เท่านั้น"
      />
      <CompanyForm />
    </main>
  );
}
