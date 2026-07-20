export type Course = {
  slug: string;
  title: string;
  subtitle: string;
  id?: string;
  delivery: "recorded" | "live";
  category: string;
  instructor: string;
  instructorRole: string;
  price: number;
  duration: string;
  durationSeconds: number;
  lessons: number;
  credits: number;
  level: string;
  color: "orange" | "cream";
  icon: "heart" | "shield";
  accredited: boolean;
  accreditationStatus?: string;
  accreditationNumber?: string | null;
  accreditationPoints?: number;
  accreditationAuthority?: string | null;
  passScore?: number;
  completionPercent?: number;
  status: "published" | "coming_soon";
  description: string;
  outcomes: string[];
  chapters: {
    id?: string;
    title: string;
    duration: string;
    durationSeconds?: number;
    preview?: boolean;
  }[];
  liveSessions?: {
    id: string;
    title: string;
    instructorName: string;
    startsAt: string;
    endsAt: string;
    capacity: number;
    sold: number;
    status: string;
  }[];
};

export const pilotCourse: Course = {
  slug: "dementia-care-pilot",
  delivery: "recorded",
  title: "失智照護入門：看見行為背後的需要",
  subtitle: "用 6 分鐘理解失智者的日常感受，練習更安心、更有尊嚴的陪伴方式",
  category: "失智照護",
  instructor: "歲悅照護團隊",
  instructorRole: "封閉試營運測試課程",
  price: 100,
  duration: "6 分鐘",
  durationSeconds: 360,
  lessons: 1,
  credits: 0,
  level: "入門",
  color: "orange",
  icon: "heart",
  accredited: false,
  passScore: 80,
  completionPercent: 90,
  status: "published",
  description:
    "本課使用既有中文字幕影片測試歲悅學苑的完整學習流程，包括測試付款、續播、在席確認、課後測驗、滿意度與完課證明。這是一堂非積分技術測試課，不會申報長照積分。",
  outcomes: [
    "理解失智者常見行為可能傳達的需要",
    "用同理語句取代直接糾正與爭辯",
    "完成 80 分課後測驗與滿意度調查",
    "取得可公開驗證的歲悅學苑完課證明",
  ],
  chapters: [
    {
      id: "b1111111-1111-4111-8111-111111111111",
      title: "從心感受失智者的日常",
      duration: "06:00",
      durationSeconds: 360,
      preview: false,
    },
  ],
};

export const comingSoonCourses: Course[] = [
  {
    ...pilotCourse,
    slug: "infection-control-coming-soon",
    title: "照護現場感染管制必修課",
    subtitle: "標準防護、手部衛生與群聚事件的第一時間處置",
    category: "專業照護",
    price: 0,
    duration: "規劃中",
    durationSeconds: 0,
    lessons: 0,
    color: "cream",
    icon: "shield",
    status: "coming_soon",
    description: "第二階段正式課程。",
    outcomes: [],
    chapters: [],
  },
];

export const courses = [pilotCourse];
export const featuredCourse = pilotCourse;

export const learnerCourses = [
  {
    course: pilotCourse,
    progress: 0,
    nextLesson: "從心感受失智者的日常",
    lastStudied: "尚未開始",
  },
];

export const formatPrice = (value: number) =>
  new Intl.NumberFormat("zh-TW", {
    style: "currency",
    currency: "TWD",
    maximumFractionDigits: 0,
  }).format(value);

export const getCourse = (slug: string) =>
  courses.find((course) => course.slug === slug);
