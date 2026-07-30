import type { Metadata } from "next";
import { LearnerDemo } from "./learner-demo";

export const metadata: Metadata = {
  title: "個人學員中心操作示範",
  description:
    "以安全合成資料體驗歲悅學苑的上課倒數、繼續學習、結訓證明、購課紀錄、收藏、折扣與購物車。",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default function LearnerDemoPage() {
  return <LearnerDemo />;
}
