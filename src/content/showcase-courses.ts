export type ShowcaseDeliveryType = "recorded" | "live" | "hybrid";

export type ShowcaseCourse = {
  slug: string;
  title: string;
  summary: string;
  category: string;
  deliveryType: ShowcaseDeliveryType;
  durationMinutes: number;
  lessonCount: number;
  displayPriceTwd: number;
  accreditationLabel: string;
  coverImage: string;
  coverAlt: string;
  youtubeId: string;
  youtubeTitle: string;
  youtubePublisher: string;
  instructor: {
    displayName: string;
    role: string;
  };
  audience: string[];
  learningObjectives: string[];
  modules: {
    title: string;
    lessons: string[];
  }[];
};

export const showcaseCategories = [
  "全部課程",
  "失智照護",
  "長照政策",
  "社區照顧",
  "營養吞嚥",
  "復能活動",
  "家屬溝通",
  "健康評估",
  "感染管制",
] as const;

export const showcaseCourses: ShowcaseCourse[] = [
  {
    slug: "dementia-compassionate-care",
    title: "失智症照護：從理解行為到安心陪伴",
    summary:
      "從常見行為、情緒反應到日常陪伴，練習用更安全、更有尊嚴的方式回應失智長輩。",
    category: "失智照護",
    deliveryType: "recorded",
    durationMinutes: 95,
    lessonCount: 7,
    displayPriceTwd: 680,
    accreditationLabel: "積分資格待正式核定",
    coverImage: "/images/suiyue-original/course-dementia-care.jpg",
    coverAlt: "照護工作者陪伴失智長者進行記憶卡活動",
    youtubeId: "qimRv1gJblQ",
    youtubeTitle: "失智的第一堂課：愛的陪伴，失智的溫柔處方",
    youtubePublisher: "中華民國衛生福利部",
    instructor: {
      displayName: "歲悅失智照護教學團隊",
      role: "正式師資與核定資料上線前公告",
    },
    audience: ["照顧服務員", "居服督導", "家庭照顧者"],
    learningObjectives: [
      "辨識失智者常見的溝通與行為需求",
      "用降低衝突的方式回應重複提問與焦慮",
      "建立兼顧安全、尊嚴與生活感的照護安排",
    ],
    modules: [
      {
        title: "第一章｜理解失智者的世界",
        lessons: ["認知變化與常見行為", "從需求看見行為背後的訊息"],
      },
      {
        title: "第二章｜溝通與情緒支持",
        lessons: ["安心對話四步驟", "拒絕、焦慮與重複提問的回應"],
      },
      {
        title: "第三章｜安全生活與案例練習",
        lessons: ["居家風險盤點", "情境題與課後測驗", "滿意度調查"],
      },
    ],
  },
  {
    slug: "caregiver-support-and-resources",
    title: "照顧不孤單：長照資源與家庭支持",
    summary:
      "認識長照服務、喘息安排與家庭分工，協助第一線人員用簡單的話陪家屬找到下一步。",
    category: "家屬溝通",
    deliveryType: "recorded",
    durationMinutes: 70,
    lessonCount: 6,
    displayPriceTwd: 520,
    accreditationLabel: "積分資格待正式核定",
    coverImage: "/images/suiyue-original/course-family-support.jpg",
    coverAlt: "照顧協調員與家庭討論長照支持安排",
    youtubeId: "vGoGa-IZNJg",
    youtubeTitle: "有您真好，讓照顧不必孤軍奮戰",
    youtubePublisher: "中華民國衛生福利部",
    instructor: {
      displayName: "歲悅家庭支持教學團隊",
      role: "正式師資與核定資料上線前公告",
    },
    audience: ["照顧服務員", "個案管理員", "機構行政人員"],
    learningObjectives: [
      "用生活化語言說明常見長照資源",
      "辨識家庭照顧壓力與轉介時機",
      "建立服務交接與家屬溝通紀錄",
    ],
    modules: [
      {
        title: "第一章｜看懂家庭照顧壓力",
        lessons: ["照顧負荷的早期訊號", "第一線可以做的支持"],
      },
      {
        title: "第二章｜資源與服務轉介",
        lessons: ["常見長照服務地圖", "喘息與替代照顧安排"],
      },
      {
        title: "第三章｜溝通演練",
        lessons: ["家屬對話案例", "課後測驗"],
      },
    ],
  },
  {
    slug: "long-term-care-policy-intro",
    title: "長照政策與服務資源入門",
    summary:
      "用生活化方式認識長照服務架構、申請流程與常見資源，協助第一線工作者清楚回應服務對象。",
    category: "長照政策",
    deliveryType: "recorded",
    durationMinutes: 65,
    lessonCount: 6,
    displayPriceTwd: 480,
    accreditationLabel: "積分資格待正式核定",
    coverImage: "/images/suiyue-original/course-long-term-care-policy.jpg",
    coverAlt: "社區照顧人員向長者說明長照服務資源",
    youtubeId: "nL3fz7w42b8",
    youtubeTitle: "【長照政策簡介影片】中文簡版",
    youtubePublisher: "中華民國衛生福利部",
    instructor: {
      displayName: "歲悅長照制度教學團隊",
      role: "正式師資與核定資料上線前公告",
    },
    audience: ["照顧服務員", "居服督導", "機構行政人員"],
    learningObjectives: [
      "說明長照服務的基本架構與使用方式",
      "辨識常見服務資源與轉介方向",
      "用簡單清楚的方式回應服務申請問題",
    ],
    modules: [
      {
        title: "第一章｜認識長照服務",
        lessons: ["誰可以使用長照服務", "常見服務與給付項目"],
      },
      {
        title: "第二章｜申請與轉介",
        lessons: ["申請流程與評估", "資源連結與服務交接"],
      },
      {
        title: "第三章｜案例與評量",
        lessons: ["常見問答演練", "課後測驗"],
      },
    ],
  },
  {
    slug: "community-day-care-and-intergenerational",
    title: "社區日照與老幼共融實務",
    summary:
      "從日間照顧的服務設計出發，認識活動安排、世代互動與安全界線，打造有參與感的社區照顧。",
    category: "社區照顧",
    deliveryType: "hybrid",
    durationMinutes: 90,
    lessonCount: 7,
    displayPriceTwd: 720,
    accreditationLabel: "積分資格待正式核定",
    coverImage: "/images/suiyue-original/course-community-day-care.jpg",
    coverAlt: "長者與孩子在日照中心一起完成共融活動",
    youtubeId: "G_3NbxHjhY0",
    youtubeTitle: "校舍活化轉日照：老幼共融新樂園",
    youtubePublisher: "中華民國衛生福利部",
    instructor: {
      displayName: "歲悅社區照顧教學團隊",
      role: "錄播觀念＋同步直播案例討論",
    },
    audience: ["照顧服務員", "日照中心人員", "活動帶領人員"],
    learningObjectives: [
      "理解社區日照服務的核心目標",
      "設計兼顧參與、安全與尊嚴的活動",
      "辨識老幼共融活動中的支持與風險",
    ],
    modules: [
      {
        title: "第一章｜社區日照的生活設計",
        lessons: ["從照顧到生活參與", "空間與活動安排"],
      },
      {
        title: "第二章｜老幼共融活動",
        lessons: ["世代互動原則", "支持不同能力的參與", "安全界線"],
      },
      {
        title: "第三章｜案例與評量",
        lessons: ["直播案例討論", "課後測驗"],
      },
    ],
  },
  {
    slug: "swallowing-and-mealtime-safety",
    title: "高齡吞嚥與進食安全：從觀察到正確協助",
    summary:
      "認識吞嚥困難警訊、進食姿勢與照護觀察，降低嗆咳與不安全餵食的風險。",
    category: "營養吞嚥",
    deliveryType: "hybrid",
    durationMinutes: 105,
    lessonCount: 8,
    displayPriceTwd: 920,
    accreditationLabel: "積分資格待正式核定",
    coverImage: "/images/suiyue-original/course-swallowing-safety.jpg",
    coverAlt: "專業人員示範高齡進食與吞嚥安全協助",
    youtubeId: "siMWhAyQ5Co",
    youtubeTitle: "吞嚥復健系列 1－認識吞嚥障礙",
    youtubePublisher: "臺大醫院 NTU Hospital",
    instructor: {
      displayName: "歲悅吞嚥照護教學團隊",
      role: "錄播觀念＋同步直播案例討論",
    },
    audience: ["照顧服務員", "機構照護人員", "居家服務員"],
    learningObjectives: [
      "觀察高齡者常見吞嚥困難警訊",
      "建立進食前、中、後的安全檢查習慣",
      "知道何時停止餵食並尋求專業評估",
    ],
    modules: [
      {
        title: "第一章｜認識吞嚥",
        lessons: ["正常吞嚥流程", "吞嚥困難警訊"],
      },
      {
        title: "第二章｜進食安全",
        lessons: ["姿勢與環境", "質地與速度觀察", "嗆咳時的處理原則"],
      },
      {
        title: "第三章｜案例與評量",
        lessons: ["直播案例討論", "課後測驗", "滿意度調查"],
      },
    ],
  },
  {
    slug: "stroke-spasticity-home-rehab",
    title: "中風後痙攣照護與居家復健",
    summary:
      "認識中風後痙攣的照護重點、居家運動與停止警訊，把復健原則安全地帶進每天生活。",
    category: "復能活動",
    deliveryType: "recorded",
    durationMinutes: 80,
    lessonCount: 7,
    displayPriceTwd: 590,
    accreditationLabel: "積分資格待正式核定",
    coverImage: "/images/suiyue-original/course-stroke-rehab.jpg",
    coverAlt: "治療人員陪伴中風長者進行居家復能活動",
    youtubeId: "uOhzqAkW7SI",
    youtubeTitle: "中風後痙攣照護：居家復健運動",
    youtubePublisher: "臺大醫院 NTU Hospital",
    instructor: {
      displayName: "歲悅復能照護教學團隊",
      role: "正式師資與核定資料上線前公告",
    },
    audience: ["照顧服務員", "日照中心人員", "家庭照顧者"],
    learningObjectives: [
      "理解中風後痙攣的常見影響與照護原則",
      "辨識運動過程中應停止並回報的警訊",
      "把日常生活活動轉化為可持續的復能練習",
    ],
    modules: [
      {
        title: "第一章｜認識痙攣與復能",
        lessons: ["痙攣對生活的影響", "活動前觀察"],
      },
      {
        title: "第二章｜居家活動原則",
        lessons: ["上肢活動原則", "下肢活動原則", "常見錯誤"],
      },
      {
        title: "第三章｜生活化帶領",
        lessons: ["日常活動設計", "課後測驗"],
      },
    ],
  },
  {
    slug: "icope-integrated-assessment",
    title: "長者六力與整合式健康評估",
    summary:
      "從認知、行動、營養、視力、聽力與憂鬱六個面向，練習觀察變化並連結後續支持。",
    category: "健康評估",
    deliveryType: "live",
    durationMinutes: 120,
    lessonCount: 5,
    displayPriceTwd: 880,
    accreditationLabel: "積分資格待正式核定",
    coverImage: "/images/suiyue-original/course-icope-assessment.jpg",
    coverAlt: "照護團隊陪伴長者進行起身與健康評估",
    youtubeId: "A4rVWXvP2j4",
    youtubeTitle: "什麼是長者健康整合式評估（ICOPE）",
    youtubePublisher: "國民健康署健康九九",
    instructor: {
      displayName: "歲悅健康評估教學團隊",
      role: "同步直播評估案例討論",
    },
    audience: ["照顧服務員", "居服督導", "社區據點人員"],
    learningObjectives: [
      "說明長者六力評估的核心面向",
      "辨識需要進一步評估或轉介的變化",
      "把觀察結果轉化為清楚的照護紀錄",
    ],
    modules: [
      {
        title: "課前準備｜六力觀察",
        lessons: ["六力概念導讀", "生活觀察紀錄"],
      },
      {
        title: "同步直播｜評估案例",
        lessons: ["案例判讀", "轉介與追蹤討論"],
      },
      {
        title: "課後完成",
        lessons: ["課後測驗"],
      },
    ],
  },
  {
    slug: "long-term-care-infection-control",
    title: "長照機構手部衛生與感染管制",
    summary:
      "從照護現場常見接觸情境出發，建立手部衛生時機、正確步驟與群聚異常回報觀念。",
    category: "感染管制",
    deliveryType: "recorded",
    durationMinutes: 120,
    lessonCount: 8,
    displayPriceTwd: 760,
    accreditationLabel: "積分資格待正式核定",
    coverImage: "/images/suiyue-original/course-infection-control.jpg",
    coverAlt: "長照工作人員一起練習正確手部衛生步驟",
    youtubeId: "Awg6uDbbFvI",
    youtubeTitle: "長期照護機構因應 COVID-19 手部衛生實務介紹",
    youtubePublisher: "衛生福利部疾病管制署",
    instructor: {
      displayName: "歲悅感染管制教學團隊",
      role: "正式師資與核定資料上線前公告",
    },
    audience: ["照顧服務員", "住宿機構照護人員", "日照中心人員"],
    learningObjectives: [
      "辨識照護現場應執行手部衛生的時機",
      "完成正確洗手與乾洗手步驟",
      "發現感染異常時完成回報與初步處置",
    ],
    modules: [
      {
        title: "第一章｜感染鏈與手部衛生",
        lessons: ["長照現場的感染風險", "手部衛生五時機"],
      },
      {
        title: "第二章｜正確操作",
        lessons: ["濕洗手步驟", "乾洗手步驟", "手套使用迷思"],
      },
      {
        title: "第三章｜機構情境與評量",
        lessons: ["環境與照護情境", "異常回報", "課後測驗"],
      },
    ],
  },
];

export function showcaseCourse(slug: string) {
  return showcaseCourses.find((course) => course.slug === slug) ?? null;
}
