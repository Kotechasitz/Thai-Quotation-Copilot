import { CompanyForm } from '@/components/settings/CompanyForm';

export const metadata = { title: 'ตั้งค่าบริษัท · Thai Quotation Copilot' };

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 px-6 py-8">
      <h1 className="text-2xl font-bold">ตั้งค่าบริษัท</h1>
      <p className="text-sm text-zinc-600">ข้อมูลนี้จะแสดงบนหัวใบเสนอราคา เก็บไว้ในเบราว์เซอร์นี้เท่านั้น</p>
      <CompanyForm />
    </main>
  );
}
