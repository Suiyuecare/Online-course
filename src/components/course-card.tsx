import Link from "next/link";
import { CirclePlay, Clock3, HeartHandshake, ShieldCheck } from "lucide-react";
import type { Course } from "@/lib/data";
import { formatPrice } from "@/lib/data";

export function CourseVisual({
  course,
  compact = false,
}: {
  course: Course;
  compact?: boolean;
}) {
  const Icon = course.icon === "shield" ? ShieldCheck : HeartHandshake;
  return (
    <div
      className={`course-visual course-visual-${course.color} ${compact ? "h-48" : "h-52"}`}
    >
      <span className="course-orb course-orb-one" />
      <span className="course-orb course-orb-two" />
      <span className="relative grid size-20 place-items-center rounded-3xl border border-white/25 bg-white/15 text-white backdrop-blur">
        <Icon className="size-10" />
      </span>
      <div className="relative max-w-48 text-white">
        <p className="text-xs font-black tracking-[.12em] text-white/75">
          歲悅學苑
        </p>
        <p className="mt-2 text-xl font-black leading-tight">
          {course.category}
        </p>
      </div>
    </div>
  );
}

export function CourseCard({ course }: { course: Course }) {
  const available = course.status === "published";
  return (
    <article className="overflow-hidden rounded-2xl border border-[#EADFCF] bg-white shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
      <CourseVisual course={course} />
      <div className="p-5">
        <div className="flex items-center gap-2 text-xs font-black text-[#A34F00]">
          <span>
            {available
              ? course.delivery === "live"
                ? "同步直播課"
                : course.accredited
                  ? "正式積分課"
                  : "線上錄播課"
              : "下一階段"}
          </span>
          <span>・</span>
          <span>{course.category}</span>
        </div>
        <h3 className="mt-3 text-lg font-black leading-snug text-[#302318]">
          {course.title}
        </h3>
        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">
          {course.subtitle}
        </p>
        <div className="mt-4 flex items-center gap-4 text-xs font-bold text-slate-500">
          <span className="inline-flex items-center gap-1">
            <Clock3 className="size-4" />
            {course.duration}
          </span>
          <span className="inline-flex items-center gap-1">
            <CirclePlay className="size-4" />
            {course.lessons} {course.delivery === "live" ? "場可選" : "單元"}
          </span>
        </div>
        <div className="mt-5 flex items-center justify-between border-t border-[#F0E7DB] pt-4">
          <p className="text-xl font-black text-[#302318]">
            {available ? formatPrice(course.price) : "敬請期待"}
          </p>
          <Link
            className="text-link inline-flex"
            href={available ? `/courses/${course.slug}` : "/courses"}
          >
            {available ? "查看課程" : "功能預告"}
          </Link>
        </div>
      </div>
    </article>
  );
}
