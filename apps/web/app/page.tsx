import { InquiryForm } from '@/components/InquiryForm';
import { PageHeader } from '@/components/PageHeader';

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
      <PageHeader
        centered
        eyebrow="ขั้นที่ 1 จาก 3"
        title="วางข้อความลูกค้า ได้ร่างใบเสนอราคาทันที"
        description={
          <>
            <p>
              AI จับคู่รายการกับ catalog ของคุณ ราคาคำนวณจาก catalog เท่านั้น คุณตรวจแก้ได้ทุกบรรทัดก่อนออกเอกสาร
            </p>
            <p className="mt-1 text-sm">ใช้ข้อมูลสังเคราะห์เท่านั้น (ห้ามวางข้อมูลลูกค้าจริงในเดโมนี้)</p>
          </>
        }
      />
      <InquiryForm />
    </main>
  );
}
