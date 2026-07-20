import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { accreditationQualification } from "@/lib/accreditation";
import {
  decryptAccreditationIdentity,
  isLearnerEncryptionConfigured,
} from "@/lib/accreditation-crypto";
import {
  createSupabaseAdminClient,
  getAuthenticatedUserId,
  isPlatformAdmin,
  isSupabaseConfigured,
} from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (process.env.FEATURE_ACCREDITATION_EXPORT === "false")
    return new Response("Not found", { status: 404 });
  if (!isSupabaseConfigured() || !isLearnerEncryptionConfigured())
    return new Response("Service not configured", { status: 503 });
  if (!(await isPlatformAdmin()))
    return new Response("Forbidden", { status: 403 });
  const admin = createSupabaseAdminClient();
  const actorId = await getAuthenticatedUserId();
  if (!admin || !actorId)
    return new Response("Service not configured", { status: 503 });
  const courseId = new URL(request.url).searchParams.get("courseId");
  if (!z.string().uuid().safeParse(courseId).success)
    return new Response("courseId is required", { status: 400 });
  const { data: selectedCourse } = await admin
    .from("courses")
    .select(
      "id,title,delivery,organizer_name,accredited,accreditation_status,accreditation_number,accreditation_points,accreditation_authority,pass_score,completion_percent,satisfaction_required",
    )
    .eq("id", courseId!)
    .maybeSingle();
  if (
    !selectedCourse?.accredited ||
    selectedCourse.accreditation_status !== "approved" ||
    !selectedCourse.accreditation_number ||
    Number(selectedCourse.accreditation_points) <= 0
  )
    return new Response("Course is not approved for accreditation", {
      status: 409,
    });
  const liveSessionId = new URL(request.url).searchParams.get("liveSessionId");
  if (selectedCourse.delivery === "live") {
    if (!z.string().uuid().safeParse(liveSessionId).success)
      return new Response(
        "courseId and liveSessionId are required for live courses",
        { status: 400 },
      );
    return buildLiveAccreditationExport(
      admin,
      actorId,
      selectedCourse,
      liveSessionId!,
    );
  }
  if (liveSessionId)
    return new Response("liveSessionId is only valid for live courses", {
      status: 400,
    });

  const { data: registrations } = await admin
    .from("accreditation_registrations")
    .select(
      "id,learner_id,course_id,enrollment_id,status,personnel_category,national_id_masked,submitted_at",
    )
    .eq("course_id", courseId!)
    .order("submitted_at");
  const learnerIds = [
    ...new Set((registrations ?? []).map((item) => item.learner_id)),
  ];
  const enrollmentIds = (registrations ?? []).map((item) => item.enrollment_id);
  const [
    { data: enrollments },
    { data: attempts },
    { data: satisfaction },
    { data: events },
  ] = await Promise.all([
    enrollmentIds.length
      ? admin
          .from("enrollments")
          .select(
            "id,status,progress_percent,valid_watch_seconds,quiz_passed,satisfaction_completed,started_at,completed_at",
          )
          .in("id", enrollmentIds)
      : Promise.resolve({ data: [] }),
    enrollmentIds.length
      ? admin
          .from("quiz_attempts")
          .select("enrollment_id,score,answers,submitted_at,attempt_number")
          .in("enrollment_id", enrollmentIds)
          .order("attempt_number", { ascending: false })
      : Promise.resolve({ data: [] }),
    enrollmentIds.length
      ? admin
          .from("satisfaction_responses")
          .select("enrollment_id,ratings,feedback,submitted_at")
          .in("enrollment_id", enrollmentIds)
      : Promise.resolve({ data: [] }),
    enrollmentIds.length
      ? admin
          .from("learning_events")
          .select(
            "enrollment_id,event_type,position_seconds,occurred_at,received_at",
          )
          .in("enrollment_id", enrollmentIds)
          .order("occurred_at")
      : Promise.resolve({ data: [] }),
  ]);
  const identities = new Map<
    string,
    ReturnType<typeof decryptAccreditationIdentity>
  >();
  for (const learnerId of learnerIds) {
    const { data } = await admin.rpc("get_accreditation_profile", {
      target_user_id: learnerId,
    });
    const encrypted = Array.isArray(data) ? data[0]?.encrypted_payload : null;
    if (encrypted)
      identities.set(learnerId, decryptAccreditationIdentity(encrypted));
  }

  const rows = (registrations ?? []).map((registration, index) => {
    const identity = identities.get(registration.learner_id);
    const course = selectedCourse;
    const enrollment = enrollments?.find(
      (item) => item.id === registration.enrollment_id,
    );
    const learnerAttempts =
      attempts?.filter(
        (item) => item.enrollment_id === registration.enrollment_id,
      ) ?? [];
    const attempt = learnerAttempts.reduce<
      (typeof learnerAttempts)[number] | undefined
    >(
      (best, item) => (!best || item.score > best.score ? item : best),
      undefined,
    );
    const survey = satisfaction?.find(
      (item) => item.enrollment_id === registration.enrollment_id,
    );
    const qualification = accreditationQualification({
      courseApproved:
        course?.accreditation_status === "approved" &&
        Boolean(course?.accreditation_number) &&
        Number(course?.accreditation_points) > 0,
      registrationStatus: registration.status,
      progressPercent: enrollment?.progress_percent ?? 0,
      completionPercent: course?.completion_percent ?? 90,
      quizPassed: enrollment?.quiz_passed ?? false,
      satisfactionCompleted: enrollment?.satisfaction_completed ?? false,
      satisfactionRequired: course?.satisfaction_required ?? true,
      enrollmentStatus: enrollment?.status ?? "active",
    });
    return {
      no: index + 1,
      registration,
      identity,
      course,
      enrollment,
      attempt,
      survey,
      qualification,
    };
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "歲悅學苑";
  workbook.created = new Date();
  workbook.subject = "正式錄播積分課送審資料";
  const summary = workbook.addWorksheet("積分資格統整表");
  summary.columns = [
    { header: "編號", key: "no", width: 8 },
    { header: "課程名稱", key: "course", width: 34 },
    { header: "主辦單位", key: "organizer", width: 26 },
    { header: "核定字號", key: "approval", width: 22 },
    { header: "姓名", key: "name", width: 16 },
    { header: "身分證／居留證號", key: "nationalId", width: 20 },
    { header: "長照人員認證字號", key: "careNumber", width: 22 },
    { header: "人員類別", key: "category", width: 18 },
    { header: "有效觀看秒數", key: "watch", width: 16 },
    { header: "觀看進度", key: "progress", width: 14 },
    { header: "最高測驗分數", key: "score", width: 16 },
    { header: "滿意度", key: "satisfaction", width: 12 },
    { header: "資格結果", key: "result", width: 14 },
    { header: "異常／未通過原因", key: "reason", width: 34 },
  ];
  rows.forEach((row) =>
    summary.addRow({
      no: row.no,
      course: row.course?.title ?? "",
      organizer: row.course?.organizer_name ?? "歲悅學苑",
      approval: row.course?.accreditation_number ?? "尚未核定",
      name: row.identity?.fullName ?? "加密資料缺失",
      nationalId:
        row.identity?.nationalId ?? row.registration.national_id_masked,
      careNumber: row.identity?.longTermCareNumber ?? "",
      category: row.registration.personnel_category,
      watch: row.enrollment?.valid_watch_seconds ?? 0,
      progress: (row.enrollment?.progress_percent ?? 0) / 100,
      score: row.attempt?.score ?? "",
      satisfaction:
        (row.survey?.ratings as { overall?: number } | null)?.overall ?? "",
      result: row.qualification.qualified ? "合格" : "待處理",
      reason: row.qualification.reasons.join("；"),
    }),
  );
  summary.getColumn("progress").numFmt = "0%";

  const assessment = workbook.addWorksheet("考核與滿意度");
  assessment.columns = [
    { header: "編號", key: "no", width: 8 },
    { header: "課程名稱", key: "course", width: 34 },
    { header: "姓名", key: "name", width: 16 },
    { header: "提交時間", key: "submitted", width: 22 },
    { header: "分數", key: "score", width: 12 },
    { header: "及格標準", key: "passScore", width: 12 },
    { header: "補考次數", key: "attempts", width: 12 },
    { header: "整體滿意度", key: "rating", width: 16 },
    { header: "課程建議", key: "feedback", width: 34 },
  ];
  rows.forEach((row) =>
    assessment.addRow({
      no: row.no,
      course: row.course?.title ?? "",
      name: row.identity?.fullName ?? "",
      submitted: row.attempt?.submitted_at
        ? new Date(row.attempt.submitted_at)
        : "",
      score: row.attempt?.score ?? "",
      passScore: row.course?.pass_score ?? 80,
      attempts:
        attempts?.filter(
          (item) => item.enrollment_id === row.registration.enrollment_id,
        ).length ?? 0,
      rating:
        (row.survey?.ratings as { overall?: number } | null)?.overall ?? "",
      feedback: row.survey?.feedback ?? "",
    }),
  );
  assessment.getColumn("submitted").numFmt = "yyyy-mm-dd hh:mm";

  const raw = workbook.addWorksheet("學習稽核原始事件");
  raw.columns = [
    { header: "課程名稱", key: "course", width: 34 },
    { header: "姓名", key: "name", width: 16 },
    { header: "事件時間", key: "occurred", width: 22 },
    { header: "收到時間", key: "received", width: 22 },
    { header: "事件類型", key: "type", width: 20 },
    { header: "播放位置（秒）", key: "position", width: 18 },
  ];
  for (const event of events ?? []) {
    const row = rows.find(
      (item) => item.registration.enrollment_id === event.enrollment_id,
    );
    if (row)
      raw.addRow({
        course: row.course?.title ?? "",
        name: row.identity?.fullName ?? "",
        occurred: new Date(event.occurred_at),
        received: new Date(event.received_at),
        type: event.event_type,
        position: event.position_seconds,
      });
  }
  raw.getColumn("occurred").numFmt = "yyyy-mm-dd hh:mm:ss";
  raw.getColumn("received").numFmt = "yyyy-mm-dd hh:mm:ss";

  [summary, assessment, raw].forEach((sheet) => {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFB45309" },
    };
    header.alignment = { vertical: "middle", horizontal: "center" };
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columnCount },
    };
  });
  const buffer = await workbook.xlsx.writeBuffer();
  const checksum = createHash("sha256")
    .update(Buffer.from(buffer))
    .digest("hex");
  await admin
    .from("accreditation_exports")
    .insert({
      course_id: courseId,
      created_by: actorId,
      learner_count: rows.length,
      file_path: `download://accreditation-${Date.now()}.xlsx`,
      checksum,
    });
  await admin
    .from("audit_events")
    .insert({
      actor_id: actorId,
      action: "accreditation.exported",
      target_type: "course",
      target_id: courseId,
      after_data: { learner_count: rows.length, checksum },
    });
  const safeApproval = selectedCourse.accreditation_number
    .replace(/[^0-9A-Za-z\u4e00-\u9fff_-]/g, "-")
    .slice(0, 40);
  return new Response(buffer as BodyInit, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''suiyue-${encodeURIComponent(safeApproval)}-${new Date().toISOString().slice(0, 10)}.xlsx`,
      "cache-control": "no-store",
    },
  });
}

async function buildLiveAccreditationExport(
  admin: SupabaseClient,
  actorId: string,
  course: {
    id: string;
    title: string;
    organizer_name: string | null;
    accreditation_number: string;
    accreditation_points: number;
    accreditation_authority: string | null;
    pass_score: number;
  },
  liveSessionId: string,
) {
  const { data: session } = await admin
    .from("live_sessions")
    .select(
      "id,title,starts_at,ends_at,status,instructor_name,camera_required_percent,break_intervals",
    )
    .eq("id", liveSessionId)
    .eq("course_id", course.id)
    .maybeSingle();
  if (!session)
    return new Response("Live session not found for course", { status: 404 });
  const { data: bookings } = await admin
    .from("live_session_bookings")
    .select("id,learner_id,enrollment_id,status,confirmed_at")
    .eq("live_session_id", liveSessionId)
    .in("status", ["confirmed", "cancelled", "refunded"])
    .order("confirmed_at");
  const enrollmentIds = (bookings ?? []).flatMap((item) =>
    item.enrollment_id ? [item.enrollment_id] : [],
  );
  const bookingIds = (bookings ?? []).map((item) => item.id);
  const [
    { data: registrations },
    { data: enrollments },
    { data: summaries },
    { data: attempts },
    { data: satisfaction },
    { data: events },
    { data: adjustments },
  ] = await Promise.all([
    enrollmentIds.length
      ? admin
          .from("accreditation_registrations")
          .select(
            "enrollment_id,learner_id,status,personnel_category,national_id_masked",
          )
          .in("enrollment_id", enrollmentIds)
      : Promise.resolve({ data: [] }),
    enrollmentIds.length
      ? admin
          .from("enrollments")
          .select("id,status,quiz_passed,satisfaction_completed,completed_at")
          .in("id", enrollmentIds)
      : Promise.resolve({ data: [] }),
    bookingIds.length
      ? admin
          .from("live_attendance_summaries")
          .select(
            "booking_id,checked_in_at,checked_out_at,online_seconds,camera_seconds,required_seconds,camera_percent,attendance_status,reasons,last_calculated_at",
          )
          .in("booking_id", bookingIds)
      : Promise.resolve({ data: [] }),
    enrollmentIds.length
      ? admin
          .from("quiz_attempts")
          .select("enrollment_id,score,attempt_number,submitted_at")
          .in("enrollment_id", enrollmentIds)
          .order("score", { ascending: false })
      : Promise.resolve({ data: [] }),
    enrollmentIds.length
      ? admin
          .from("satisfaction_responses")
          .select("enrollment_id,ratings,feedback,submitted_at")
          .in("enrollment_id", enrollmentIds)
      : Promise.resolve({ data: [] }),
    bookingIds.length
      ? admin
          .from("live_attendance_events")
          .select(
            "booking_id,learner_id,event_type,source,occurred_at,received_at,payload",
          )
          .in("booking_id", bookingIds)
          .order("occurred_at")
      : Promise.resolve({ data: [] }),
    bookingIds.length
      ? admin
          .from("live_attendance_adjustments")
          .select(
            "booking_id,actor_id,decision,camera_seconds_delta,check_in_override,check_out_override,reason,created_at",
          )
          .in("booking_id", bookingIds)
          .order("created_at")
      : Promise.resolve({ data: [] }),
  ]);
  const identities = new Map<
    string,
    ReturnType<typeof decryptAccreditationIdentity>
  >();
  for (const learnerId of [
    ...new Set((bookings ?? []).map((item) => item.learner_id)),
  ]) {
    const { data } = await admin.rpc("get_accreditation_profile", {
      target_user_id: learnerId,
    });
    const encrypted = Array.isArray(data) ? data[0]?.encrypted_payload : null;
    if (encrypted)
      identities.set(learnerId, decryptAccreditationIdentity(encrypted));
  }
  const rows = (bookings ?? []).map((booking, index) => {
    const enrollment = enrollments?.find(
      (item) => item.id === booking.enrollment_id,
    );
    const registration = registrations?.find(
      (item) => item.enrollment_id === booking.enrollment_id,
    );
    const summary = summaries?.find((item) => item.booking_id === booking.id);
    const bestAttempt = attempts
      ?.filter((item) => item.enrollment_id === booking.enrollment_id)
      .sort((a, b) => b.score - a.score)[0];
    const survey = satisfaction?.find(
      (item) => item.enrollment_id === booking.enrollment_id,
    );
    const qualified =
      booking.status === "confirmed" &&
      registration?.status === "verified" &&
      summary?.attendance_status === "qualified" &&
      Boolean(enrollment?.quiz_passed) &&
      Boolean(enrollment?.satisfaction_completed);
    const reasons = [
      booking.status !== "confirmed" && `修課權限：${booking.status}`,
      registration?.status !== "verified" &&
        `積分資料：${registration?.status ?? "未填"}`,
      summary?.attendance_status !== "qualified" &&
        `出席：${summary?.attendance_status ?? "未計算"}`,
      !enrollment?.quiz_passed && "測驗未通過",
      !enrollment?.satisfaction_completed && "滿意度未完成",
    ]
      .filter(Boolean)
      .join("；");
    return {
      no: index + 1,
      booking,
      enrollment,
      registration,
      summary,
      bestAttempt,
      survey,
      identity: identities.get(booking.learner_id),
      qualified,
      reasons,
    };
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "歲悅學苑";
  workbook.subject = "同步直播積分課送審資料";
  workbook.created = new Date();
  const summarySheet = workbook.addWorksheet("場次資格統整表");
  summarySheet.columns = [
    { header: "編號", key: "no", width: 8 },
    { header: "課程／場次", key: "session", width: 38 },
    { header: "場次日期", key: "date", width: 18 },
    { header: "核定字號", key: "approval", width: 22 },
    { header: "姓名", key: "name", width: 16 },
    { header: "身分證／居留證號", key: "nationalId", width: 20 },
    { header: "長照認證字號", key: "careNo", width: 22 },
    { header: "人員類別", key: "category", width: 18 },
    { header: "簽到", key: "checkIn", width: 20 },
    { header: "簽退", key: "checkOut", width: 20 },
    { header: "在線秒數", key: "online", width: 14 },
    { header: "鏡頭秒數", key: "camera", width: 14 },
    { header: "應計秒數", key: "required", width: 14 },
    { header: "鏡頭比例", key: "percent", width: 14 },
    { header: "最高測驗", key: "score", width: 12 },
    { header: "資格結果", key: "result", width: 14 },
    { header: "異常／未通過原因", key: "reason", width: 36 },
  ];
  rows.forEach((row) =>
    summarySheet.addRow({
      no: row.no,
      session: `${course.title}／${session.title}`,
      date: new Date(session.starts_at),
      approval: course.accreditation_number,
      name: row.identity?.fullName ?? "加密資料缺失",
      nationalId:
        row.identity?.nationalId ?? row.registration?.national_id_masked ?? "",
      careNo: row.identity?.longTermCareNumber ?? "",
      category: row.registration?.personnel_category ?? "",
      checkIn: row.summary?.checked_in_at
        ? new Date(row.summary.checked_in_at)
        : "",
      checkOut: row.summary?.checked_out_at
        ? new Date(row.summary.checked_out_at)
        : "",
      online: row.summary?.online_seconds ?? 0,
      camera: row.summary?.camera_seconds ?? 0,
      required: row.summary?.required_seconds ?? 0,
      percent: Number(row.summary?.camera_percent ?? 0) / 100,
      score: row.bestAttempt?.score ?? "",
      result: row.qualified ? "合格" : "待處理",
      reason: row.reasons,
    }),
  );
  summarySheet.getColumn("date").numFmt = "yyyy-mm-dd";
  summarySheet.getColumn("checkIn").numFmt = "yyyy-mm-dd hh:mm:ss";
  summarySheet.getColumn("checkOut").numFmt = "yyyy-mm-dd hh:mm:ss";
  summarySheet.getColumn("percent").numFmt = "0.0%";
  const eventSheet = workbook.addWorksheet("Zoom與鏡頭原始事件");
  eventSheet.columns = [
    { header: "姓名", key: "name", width: 16 },
    { header: "事件時間", key: "occurred", width: 22 },
    { header: "收到時間", key: "received", width: 22 },
    { header: "事件", key: "event", width: 20 },
    { header: "來源", key: "source", width: 18 },
    { header: "鏡頭狀態", key: "camera", width: 14 },
  ];
  for (const event of events ?? []) {
    const row = rows.find((item) => item.booking.id === event.booking_id);
    eventSheet.addRow({
      name: row?.identity?.fullName ?? "",
      occurred: new Date(event.occurred_at),
      received: new Date(event.received_at),
      event: event.event_type,
      source: event.source,
      camera:
        (event.payload as { camera_on?: boolean } | null)?.camera_on === true
          ? "開啟"
          : (event.payload as { camera_on?: boolean } | null)?.camera_on ===
              false
            ? "關閉"
            : "",
    });
  }
  eventSheet.getColumn("occurred").numFmt = "yyyy-mm-dd hh:mm:ss";
  eventSheet.getColumn("received").numFmt = "yyyy-mm-dd hh:mm:ss";
  const auditSheet = workbook.addWorksheet("休息與人工調整");
  auditSheet.columns = [
    { header: "類型", key: "type", width: 16 },
    { header: "姓名", key: "name", width: 16 },
    { header: "開始／調整時間", key: "start", width: 22 },
    { header: "結束時間", key: "end", width: 22 },
    { header: "決定", key: "decision", width: 22 },
    { header: "鏡頭秒數調整", key: "delta", width: 18 },
    { header: "原因", key: "reason", width: 42 },
  ];
  for (const rest of Array.isArray(session.break_intervals)
    ? (session.break_intervals as Array<{ startsAt: string; endsAt: string }>)
    : [])
    auditSheet.addRow({
      type: "正式休息",
      start: new Date(rest.startsAt),
      end: new Date(rest.endsAt),
    });
  for (const adjustment of adjustments ?? []) {
    const row = rows.find((item) => item.booking.id === adjustment.booking_id);
    auditSheet.addRow({
      type: "人工補正",
      name: row?.identity?.fullName ?? "",
      start: new Date(adjustment.created_at),
      decision: adjustment.decision,
      delta: adjustment.camera_seconds_delta,
      reason: adjustment.reason,
    });
  }
  auditSheet.getColumn("start").numFmt = "yyyy-mm-dd hh:mm:ss";
  auditSheet.getColumn("end").numFmt = "yyyy-mm-dd hh:mm:ss";
  for (const sheet of [summarySheet, eventSheet, auditSheet]) {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFB45309" },
    };
    header.alignment = { vertical: "middle", horizontal: "center" };
    header.height = 26;
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columnCount },
    };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const checksum = createHash("sha256")
    .update(Buffer.from(buffer))
    .digest("hex");
  await admin
    .from("accreditation_exports")
    .insert({
      course_id: course.id,
      live_session_id: liveSessionId,
      created_by: actorId,
      learner_count: rows.length,
      file_path: `download://live-accreditation-${Date.now()}.xlsx`,
      checksum,
    });
  await admin
    .from("audit_events")
    .insert({
      actor_id: actorId,
      action: "live_accreditation.exported",
      target_type: "live_session",
      target_id: liveSessionId,
      after_data: { learner_count: rows.length, checksum },
    });
  return new Response(buffer as BodyInit, {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename*=UTF-8''suiyue-live-${encodeURIComponent(course.accreditation_number)}-${session.starts_at.slice(0, 10)}.xlsx`,
      "cache-control": "no-store",
    },
  });
}
