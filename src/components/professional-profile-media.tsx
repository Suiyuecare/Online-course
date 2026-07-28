import Image from "next/image";

export function ProfessionalProfileMedia({
  kind,
  hasMedia,
  publicName,
  publicSlug,
  updatedAt,
  priority = false,
}: {
  kind: "avatar" | "cover";
  hasMedia: boolean;
  publicName: string;
  publicSlug?: string;
  updatedAt: string | null;
  priority?: boolean;
}) {
  if (!hasMedia) {
    return kind === "avatar" ? (
      <span aria-hidden="true" className="professional-profile-avatar-fallback">
        {publicName.slice(0, 1)}
      </span>
    ) : (
      <span aria-hidden="true" className="professional-profile-cover-fallback">
        <i />
        <i />
        <i />
      </span>
    );
  }

  const params = new URLSearchParams();
  if (publicSlug) params.set("slug", publicSlug);
  if (updatedAt) params.set("v", updatedAt);
  return (
    <Image
      alt={kind === "avatar" ? `${publicName}的個人頭像` : ""}
      fill
      priority={priority}
      sizes={kind === "avatar" ? "180px" : "(max-width: 760px) 100vw, 1200px"}
      src={`/api/profile/media/${kind}?${params.toString()}`}
      unoptimized
    />
  );
}
