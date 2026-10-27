import { InquiryForm } from '@/components/InquiryForm';

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-6 py-10">
      <h1 className="text-3xl font-bold">Thai Quotation Copilot</h1>
      <p className="text-zinc-600">
        วางข้อความสั่งซื้อจากลูกค้า ระบบจะจับคู่กับ catalog ของคุณแล้วสร้างร่างใบเสนอราคาให้ตรวจแก้ก่อนอนุมัติ
        ใช้ข้อมูลสังเคราะห์เท่านั้น (ห้ามวางข้อมูลลูกค้าจริงในเดโมนี้)
      </p>
      <InquiryForm />
    </main>
  );
}
