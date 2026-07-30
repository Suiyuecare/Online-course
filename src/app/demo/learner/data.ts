export type LearnerDemoCourse = {
  slug: string;
  title: string;
  category: string;
  image: string;
  imageAlt: string;
  delivery: "錄播課" | "直播課" | "混合課";
  duration: string;
  credit: string;
  price: number;
};

export const continueLearningCourse: LearnerDemoCourse = {
  slug: "dementia-compassionate-care",
  title: "失智症照護：從理解行為到安心陪伴",
  category: "失智、身障與特殊需求",
  image: "/images/suiyue-original/course-dementia-care.jpg",
  imageAlt: "照護工作者陪伴失智長者進行記憶卡活動",
  delivery: "錄播課",
  duration: "95 分鐘",
  credit: "積分資格待正式核定",
  price: 680,
};

export const learnerDemoRecommendations: LearnerDemoCourse[] = [
  {
    slug: "swallowing-and-mealtime-safety",
    title: "高齡吞嚥與進食安全：從觀察到正確協助",
    category: "日常照護與專業技能",
    image: "/images/suiyue-original/course-swallowing-safety.jpg",
    imageAlt: "專業人員示範高齡進食與吞嚥安全協助",
    delivery: "混合課",
    duration: "105 分鐘",
    credit: "專業課程",
    price: 920,
  },
  {
    slug: "stroke-spasticity-home-rehab",
    title: "中風後痙攣照護與居家復健",
    category: "復能、居家醫療與善終",
    image: "/images/suiyue-original/course-stroke-rehab.jpg",
    imageAlt: "治療人員陪伴中風長者進行居家復能活動",
    delivery: "錄播課",
    duration: "80 分鐘",
    credit: "專業課程",
    price: 590,
  },
  {
    slug: "long-term-care-infection-control",
    title: "長照機構手部衛生與感染管制",
    category: "品質、安全與感染管制",
    image: "/images/suiyue-original/course-infection-control.jpg",
    imageAlt: "長照工作者依正確步驟進行手部衛生",
    delivery: "錄播課",
    duration: "120 分鐘",
    credit: "專業品質",
    price: 760,
  },
];

export const learnerDemoPurchasedCourses = [
  {
    ...continueLearningCourse,
    status: "學習中",
    progress: 68,
    watched: "64 / 95 分鐘",
    nextAction: "從第 5 單元繼續",
  },
  {
    slug: "icope-integrated-assessment",
    title: "長者六力與整合式健康評估",
    category: "入門、資格與職涯進階",
    image: "/images/suiyue-original/course-icope-assessment.jpg",
    imageAlt: "照護團隊陪伴長者進行起身與健康評估",
    delivery: "直播課" as const,
    duration: "120 分鐘",
    credit: "積分資格待正式核定",
    price: 880,
    status: "等待開課",
    progress: 0,
    watched: "尚未開始",
    nextAction: "2026/08/03 09:00 開課",
  },
  {
    slug: "long-term-care-policy-intro",
    title: "長照政策與服務資源入門",
    category: "政策法規與職場權益",
    image: "/images/suiyue-original/course-long-term-care-policy.jpg",
    imageAlt: "社區照顧人員向長者說明長照服務資源",
    delivery: "錄播課" as const,
    duration: "65 分鐘",
    credit: "專業法規",
    price: 480,
    status: "已完成",
    progress: 100,
    watched: "有效觀看 68 分鐘",
    nextAction: "證明已核發",
  },
];

export const learnerDemoOrders = [
  {
    number: "SY260727-0186",
    placedAt: "2026/07/27 14:32",
    item: "失智症照護：從理解行為到安心陪伴",
    amount: 680,
    status: "已確認匯款",
  },
  {
    number: "SY260715-0092",
    placedAt: "2026/07/15 09:18",
    item: "長照政策與服務資源入門",
    amount: 480,
    status: "已完成",
  },
];

export const learnerDemoCertificate = {
  number: "SY-CERT-DEMO-000128",
  course: "長照政策與服務資源入門",
  completedAt: "2026/07/22",
  learner: "林美華",
  duration: "有效觀看 68 分鐘",
  score: "課後測驗 92 分",
  note: "本頁為合成資料示範，不具正式積分或證明效力。",
};
