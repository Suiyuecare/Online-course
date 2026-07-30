export type DemoEmployee = {
  id: string;
  name: string;
  maskedPhone: string;
  employeeNumber: string;
  department: string;
  invitationStatus: "已加入" | "待接受";
  courseStatus: "進行中" | "已完成" | "待開課" | "尚未指派";
  courseTitle: string | null;
  progress: number | null;
  learningMinutes: number;
  quizScore: number | null;
  certificate: "已取得" | "待完成" | "尚未產生";
};

export type DemoCourse = {
  id: string;
  title: string;
  delivery: "錄播" | "直播" | "混合";
  points: number;
  duration: string;
  availableSeats?: number;
};

export type DemoLiveSession = {
  id: string;
  title: string;
  date: string;
  time: string;
  instructor: string;
  seats: string;
};

export const demoOrganization = {
  name: "新北市私立歲悅居家長照機構",
  taxId: "統編 8312••••",
  role: "培訓管理員",
  availablePoints: 142_800,
  reservedPoints: 9_600,
  consumedPoints: 47_600,
  totalPurchasedPoints: 200_000,
  expiringPoints: 0,
  activeMembers: 36,
  invitedMembers: 4,
  assignedLearners: 28,
  completedLearners: 19,
};

export const demoEmployees: DemoEmployee[] = [
  {
    id: "emp-001",
    name: "王怡婷",
    maskedPhone: "0912•••168",
    employeeNumber: "HC-021",
    department: "板橋 A 組",
    invitationStatus: "已加入",
    courseStatus: "進行中",
    courseTitle: "失智照護溝通與行為支持",
    progress: 72,
    learningMinutes: 108,
    quizScore: null,
    certificate: "待完成",
  },
  {
    id: "emp-002",
    name: "陳美玲",
    maskedPhone: "0928•••520",
    employeeNumber: "HC-034",
    department: "新莊 B 組",
    invitationStatus: "已加入",
    courseStatus: "已完成",
    courseTitle: "感染管制與居家照護安全",
    progress: 100,
    learningMinutes: 120,
    quizScore: 90,
    certificate: "已取得",
  },
  {
    id: "emp-003",
    name: "林淑芬",
    maskedPhone: "0987•••403",
    employeeNumber: "HC-048",
    department: "板橋 A 組",
    invitationStatus: "已加入",
    courseStatus: "待開課",
    courseTitle: "居家緊急應變實務",
    progress: 0,
    learningMinutes: 0,
    quizScore: null,
    certificate: "尚未產生",
  },
  {
    id: "emp-004",
    name: "張雅雯",
    maskedPhone: "0966•••875",
    employeeNumber: "HC-052",
    department: "三重 C 組",
    invitationStatus: "已加入",
    courseStatus: "進行中",
    courseTitle: "失智照護溝通與行為支持",
    progress: 43,
    learningMinutes: 64,
    quizScore: null,
    certificate: "待完成",
  },
  {
    id: "emp-005",
    name: "李秋香",
    maskedPhone: "0933•••619",
    employeeNumber: "HC-061",
    department: "新莊 B 組",
    invitationStatus: "待接受",
    courseStatus: "尚未指派",
    courseTitle: null,
    progress: null,
    learningMinutes: 0,
    quizScore: null,
    certificate: "尚未產生",
  },
  {
    id: "emp-006",
    name: "黃秀蘭",
    maskedPhone: "0975•••221",
    employeeNumber: "HC-067",
    department: "三重 C 組",
    invitationStatus: "已加入",
    courseStatus: "已完成",
    courseTitle: "感染管制與居家照護安全",
    progress: 100,
    learningMinutes: 124,
    quizScore: 100,
    certificate: "已取得",
  },
];

export const demoCourses: DemoCourse[] = [
  {
    id: "course-dementia",
    title: "失智照護溝通與行為支持",
    delivery: "錄播",
    points: 1_200,
    duration: "2 小時",
  },
  {
    id: "course-infection",
    title: "感染管制與居家照護安全",
    delivery: "混合",
    points: 1_500,
    duration: "2.5 小時",
  },
  {
    id: "course-emergency",
    title: "居家緊急應變實務",
    delivery: "直播",
    points: 1_800,
    duration: "3 小時",
    availableSeats: 18,
  },
];

export const demoLiveSessions: DemoLiveSession[] = [
  {
    id: "live-aug-03",
    title: "居家緊急應變實務",
    date: "2026/08/03（一）",
    time: "09:00–12:00",
    instructor: "蔡佳穎 護理師",
    seats: "32 / 50 人",
  },
  {
    id: "live-aug-10",
    title: "居家緊急應變實務",
    date: "2026/08/10（一）",
    time: "13:30–16:30",
    instructor: "蔡佳穎 護理師",
    seats: "21 / 50 人",
  },
];

export const demoPointEvents = [
  {
    date: "2026/07/26",
    label: "匯款購點入帳",
    reference: "PT-20260726-018",
    delta: 100_000,
  },
  {
    date: "2026/07/28",
    label: "批次指派・失智照護溝通與行為支持",
    reference: "12 位員工",
    delta: -14_400,
  },
  {
    date: "2026/07/29",
    label: "直播名額保留・居家緊急應變實務",
    reference: "6 位員工",
    delta: -10_800,
  },
] as const;
