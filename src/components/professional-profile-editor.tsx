"use client";

import Link from "next/link";
import { type ChangeEvent, type FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProfessionalProfilePageData } from "@/application/professional-profile";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import { ProfessionalProfileView } from "@/components/professional-profile-view";
import { ProfileShareButton } from "@/components/profile-share-button";

type EditorValues = {
  publicName: string;
  headline: string;
  websiteUrl: string;
  biography: string;
  expertise: string;
  interests: string;
  isPublic: boolean;
  showAbout: boolean;
  showCompletedCourses: boolean;
  showTeachingCourses: boolean;
};

function initialValues(data: ProfessionalProfilePageData): EditorValues {
  return {
    publicName: data.profile.publicName,
    headline: data.profile.headline,
    websiteUrl: data.profile.websiteUrl ?? "",
    biography: data.profile.biography,
    expertise: data.profile.expertise.join("、"),
    interests: data.profile.interests.join("、"),
    isPublic: data.profile.isPublic,
    showAbout: data.profile.showAbout,
    showCompletedCourses: data.profile.showCompletedCourses,
    showTeachingCourses: data.profile.showTeachingCourses,
  };
}

function tags(value: string) {
  return [
    ...new Set(
      value
        .split(/[、,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function responseData(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === true &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null
  ) {
    return value.data as Record<string, unknown>;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    throw new Error(value.error);
  }
  throw new Error("REQUEST_REJECTED");
}

async function prepareProfileImage(
  file: File,
  kind: "avatar" | "cover",
): Promise<File> {
  if (file.size <= 1_200_000) return file;
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new window.Image();
    image.decoding = "async";
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
    });
    const maxWidth = kind === "avatar" ? 1024 : 1920;
    const maxHeight = kind === "avatar" ? 1024 : 1080;
    const scale = Math.min(
      1,
      maxWidth / image.naturalWidth,
      maxHeight / image.naturalHeight,
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const optimized = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.86),
    );
    if (!optimized || optimized.size >= file.size) return file;
    return new File([optimized], `${kind}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function ProfessionalProfileEditor({
  initialData,
}: {
  initialData: ProfessionalProfilePageData;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(initialData.profile.version === 0);
  const [values, setValues] = useState(() => initialValues(initialData));
  const [version, setVersion] = useState(initialData.profile.version);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error">(
    "success",
  );
  const [mediaMessage, setMediaMessage] = useState("");
  const [mediaBusy, setMediaBusy] = useState<"avatar" | "cover" | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const guardInternalLink = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!target || target.target === "_blank") return;
      const href = target.getAttribute("href");
      if (!href || href.startsWith("#")) return;
      if (!window.confirm("文字修改尚未儲存。確定要離開這個頁面嗎？")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guardInternalLink, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guardInternalLink, true);
    };
  }, [dirty]);

  function change<K extends keyof EditorValues>(
    key: K,
    value: EditorValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }

  function cancelEditing() {
    setValues(initialValues(initialData));
    setDirty(false);
    setMessage("");
    setEditing(false);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/profile/professional", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          ...values,
          expertise: tags(values.expertise),
          interests: tags(values.interests),
          expectedVersion: version,
        }),
      });
      const payload = await response.json();
      const data = responseData(payload);
      if (typeof data.version === "number") setVersion(data.version);
      setDirty(false);
      setEditing(false);
      setMessageTone("success");
      setMessage("個人檔案已儲存");
      router.refresh();
    } catch (error) {
      const code = error instanceof Error ? error.message : "REQUEST_REJECTED";
      setMessageTone("error");
      setMessage(
        code.includes("VERSION_CONFLICT")
          ? "另一個分頁已更新這份檔案。請重新整理，再確認內容後儲存。"
          : code.includes("INVALID") || code.includes("REJECTED")
            ? "有欄位格式不正確，請確認顯示名稱、網址與專長項目後再試一次。"
            : code.includes("EMERGENCY") || code.includes("CONFIGURATION")
              ? "平台目前暫停個人檔案修改，原有資料不受影響，請稍後再試。"
              : "目前無法連線儲存。請保留這個頁面，確認網路後再試一次。",
      );
    } finally {
      setSaving(false);
    }
  }

  async function waitUntilScanned(uploadId: string) {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      const response = await fetch(
        `/api/uploads/quarantine?uploadId=${encodeURIComponent(uploadId)}`,
        { cache: "no-store" },
      );
      const payload = await response.json();
      if (
        typeof payload === "object" &&
        payload !== null &&
        payload.ok === true &&
        typeof payload.data === "object" &&
        payload.data !== null &&
        typeof payload.data.status === "string"
      ) {
        if (payload.data.status === "promoted") return "promoted";
        if (["rejected", "failed"].includes(payload.data.status)) {
          return payload.data.status;
        }
      }
    }
    return "pending";
  }

  async function bindMedia(kind: "avatar" | "cover", uploadId: string | null) {
    const response = await fetch("/api/profile/professional/media", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        kind,
        uploadId,
        expectedVersion: version,
      }),
    });
    const payload = await response.json();
    const data = responseData(payload);
    if (typeof data.version === "number") setVersion(data.version);
  }

  async function upload(
    kind: "avatar" | "cover",
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      file.size > 5_000_000
    ) {
      setMediaMessage("請選擇 5MB 以下的 JPG 或 PNG 圖片。");
      return;
    }
    setMediaBusy(kind);
    setMediaMessage("正在準備圖片，接著會進行安全掃描。");
    try {
      const preparedFile = await prepareProfileImage(file, kind);
      const form = new FormData();
      form.set(
        "purpose",
        kind === "avatar" ? "profile_avatar" : "profile_cover",
      );
      form.set("file", preparedFile);
      const uploadResponse = await fetch("/api/uploads/quarantine", {
        method: "POST",
        body: form,
      });
      const uploadPayload = await uploadResponse.json();
      const uploadData = responseData(uploadPayload);
      if (typeof uploadData.uploadId !== "string") {
        throw new Error("UPLOAD_REJECTED");
      }
      const scanStatus = await waitUntilScanned(uploadData.uploadId);
      if (scanStatus === "pending") {
        setMediaMessage(
          "圖片仍在安全掃描中。完成後可再上傳一次或稍後重新整理查看。",
        );
        return;
      }
      if (scanStatus !== "promoted") {
        setMediaMessage("圖片未通過安全檢查，請改用另一張 JPG 或 PNG。");
        return;
      }
      await bindMedia(kind, uploadData.uploadId);
      setMediaMessage(kind === "avatar" ? "頭像已更新" : "封面已更新");
      router.refresh();
    } catch {
      setMediaMessage(
        "圖片目前無法上傳。安全掃描服務未完成設定時，系統會拒絕使用圖片。",
      );
    } finally {
      setMediaBusy(null);
    }
  }

  async function removeMedia(kind: "avatar" | "cover") {
    setMediaBusy(kind);
    setMediaMessage("");
    try {
      await bindMedia(kind, null);
      setMediaMessage(kind === "avatar" ? "頭像已移除" : "封面已移除");
      router.refresh();
    } catch {
      setMediaMessage("無法移除圖片，請重新整理後再試一次。");
    } finally {
      setMediaBusy(null);
    }
  }

  const publicPath = initialData.profile.slug
    ? `/profiles/${initialData.profile.slug}`
    : null;
  const actions = (
    <>
      <button
        className="profile-action-button primary"
        onClick={() => setEditing(true)}
        type="button"
      >
        <LearnerPortalIcon name="edit" size={19} />
        編輯個人檔案
      </button>
      <Link className="profile-action-button" href="/learner/account/preview">
        <LearnerPortalIcon name="eye" size={19} />
        預覽公開頁
      </Link>
      {publicPath && initialData.profile.isPublic && (
        <ProfileShareButton
          path={publicPath}
          title={`${initialData.profile.publicName}｜歲悅學苑`}
        />
      )}
    </>
  );

  return (
    <>
      {message && (
        <p
          aria-live="polite"
          className={`professional-profile-save-message ${messageTone}`}
        >
          {message}
        </p>
      )}
      {editing && (
        <section
          aria-labelledby="professional-profile-editor-title"
          className="professional-profile-editor"
        >
          <div className="professional-profile-editor-heading">
            <div>
              <p>個人檔案設定</p>
              <h2 id="professional-profile-editor-title">建立你的長照專業頁</h2>
              <span>
                這裡填的是公開暱稱與專業介紹，不會改動積分證明上的正式姓名。
              </span>
            </div>
            {initialData.profile.version > 0 && (
              <button onClick={cancelEditing} type="button">
                稍後再改
              </button>
            )}
          </div>

          {initialData.profile.moderationHidden && (
            <div className="professional-profile-moderation" role="alert">
              <strong>個人頁目前暫停公開</strong>
              <p>
                {initialData.profile.moderationReason ??
                  "請聯絡客服確認需要修正的內容。"}
              </p>
            </div>
          )}

          <div className="professional-profile-media-editor">
            <div>
              <span>個人頭像</span>
              <p>建議使用正方形照片；支援 JPG、PNG，最多 5MB。</p>
              <div>
                <label>
                  <LearnerPortalIcon name="upload" size={19} />
                  {mediaBusy === "avatar" ? "處理中…" : "上傳頭像"}
                  <input
                    accept="image/jpeg,image/png"
                    disabled={mediaBusy !== null}
                    onChange={(event) => void upload("avatar", event)}
                    type="file"
                  />
                </label>
                {initialData.profile.hasAvatar && (
                  <button
                    disabled={mediaBusy !== null}
                    onClick={() => void removeMedia("avatar")}
                    type="button"
                  >
                    移除
                  </button>
                )}
              </div>
            </div>
            <div>
              <span>頁面封面</span>
              <p>建議使用 3:1 橫幅；支援 JPG、PNG，最多 5MB。</p>
              <div>
                <label>
                  <LearnerPortalIcon name="upload" size={19} />
                  {mediaBusy === "cover" ? "處理中…" : "上傳封面"}
                  <input
                    accept="image/jpeg,image/png"
                    disabled={mediaBusy !== null}
                    onChange={(event) => void upload("cover", event)}
                    type="file"
                  />
                </label>
                {initialData.profile.hasCover && (
                  <button
                    disabled={mediaBusy !== null}
                    onClick={() => void removeMedia("cover")}
                    type="button"
                  >
                    移除
                  </button>
                )}
              </div>
            </div>
          </div>
          <p aria-live="polite" className="professional-profile-media-message">
            {mediaMessage}
          </p>
          <p className="professional-profile-media-note">
            圖片通過安全檢查後會立即更新；下方「取消文字修改」不會移除已更新的圖片。
          </p>

          <form onSubmit={(event) => void save(event)}>
            <div className="professional-profile-form-grid">
              <label>
                <span>公開顯示名稱</span>
                <input
                  autoComplete="nickname"
                  maxLength={80}
                  onChange={(event) => change("publicName", event.target.value)}
                  required
                  value={values.publicName}
                />
                <small>可以使用暱稱，不會影響正式證明姓名。</small>
              </label>
              <label>
                <span>專業短標</span>
                <input
                  maxLength={120}
                  onChange={(event) => change("headline", event.target.value)}
                  placeholder="例如：照顧服務員｜失智照護"
                  value={values.headline}
                />
                <small>{values.headline.length}／120 字</small>
              </label>
              <label className="wide">
                <span>個人網站</span>
                <input
                  inputMode="url"
                  maxLength={500}
                  onChange={(event) => change("websiteUrl", event.target.value)}
                  placeholder="https://"
                  type="url"
                  value={values.websiteUrl}
                />
                <small>只接受 http 或 https 網址。</small>
              </label>
              <label className="wide">
                <span>關於我</span>
                <textarea
                  maxLength={1000}
                  onChange={(event) => change("biography", event.target.value)}
                  placeholder="簡單介紹照護經歷、在意的服務方式，或持續進修的原因。"
                  rows={6}
                  value={values.biography}
                />
                <small>{values.biography.length}／1000 字</small>
              </label>
              <label>
                <span>自己的專長</span>
                <textarea
                  onChange={(event) => change("expertise", event.target.value)}
                  placeholder="失智照護、吞嚥照護、家屬溝通"
                  rows={4}
                  value={values.expertise}
                />
                <small>用逗號或頓號分隔，最多 12 項。</small>
              </label>
              <label>
                <span>感興趣的主題</span>
                <textarea
                  onChange={(event) => change("interests", event.target.value)}
                  placeholder="復能、感染管制、長照法規"
                  rows={4}
                  value={values.interests}
                />
                <small>用逗號或頓號分隔，最多 12 項。</small>
              </label>
            </div>

            <fieldset className="professional-profile-visibility-settings">
              <legend>公開範圍</legend>
              <label className="primary-switch">
                <span>
                  <strong>公開個人頁</strong>
                  <small>開啟後，知道分享網址的人可以看到你允許的內容。</small>
                </span>
                <input
                  checked={values.isPublic}
                  onChange={(event) => change("isPublic", event.target.checked)}
                  role="switch"
                  type="checkbox"
                />
              </label>
              <label className={!values.isPublic ? "is-disabled" : undefined}>
                <span>
                  <strong>公開個人介紹</strong>
                  <small>包含自介、專長、興趣與網站連結。</small>
                </span>
                <input
                  checked={values.showAbout}
                  disabled={!values.isPublic}
                  onChange={(event) =>
                    change("showAbout", event.target.checked)
                  }
                  role="switch"
                  type="checkbox"
                />
              </label>
              <label className={!values.isPublic ? "is-disabled" : undefined}>
                <span>
                  <strong>公開已完成課程</strong>
                  <small>不會顯示觀看分鐘、成績或訂單。</small>
                </span>
                <input
                  checked={values.showCompletedCourses}
                  disabled={!values.isPublic}
                  onChange={(event) =>
                    change("showCompletedCourses", event.target.checked)
                  }
                  role="switch"
                  type="checkbox"
                />
              </label>
              {initialData.isInstructor && (
                <label className={!values.isPublic ? "is-disabled" : undefined}>
                  <span>
                    <strong>公開授課課程</strong>
                    <small>只顯示平台審核後的已發布課程。</small>
                  </span>
                  <input
                    checked={values.showTeachingCourses}
                    disabled={!values.isPublic}
                    onChange={(event) =>
                      change("showTeachingCourses", event.target.checked)
                    }
                    role="switch"
                    type="checkbox"
                  />
                </label>
              )}
            </fieldset>
            {!values.isPublic && (
              <p className="professional-profile-visibility-hint">
                個人頁目前未公開。先開啟上方主開關，才能選擇要分享哪些區塊。
              </p>
            )}

            <div className="professional-profile-form-actions">
              {initialData.profile.version > 0 && (
                <button
                  className="profile-action-button"
                  disabled={saving}
                  onClick={cancelEditing}
                  type="button"
                >
                  取消文字修改
                </button>
              )}
              <button
                className="profile-action-button primary"
                disabled={saving}
                type="submit"
              >
                {saving ? "儲存中…" : "儲存個人檔案"}
              </button>
            </div>
          </form>
        </section>
      )}

      <ProfessionalProfileView
        actions={actions}
        data={initialData}
        mode="owner"
      />
    </>
  );
}
