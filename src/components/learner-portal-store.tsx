"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

export type LearnerCartItem = {
  courseVersionId: string;
  slug: string;
  title: string;
  priceTwd: number;
  deliveryType: "recorded" | "live" | "hybrid";
  coverUrl: string | null;
};

type LearnerPortalState = {
  cart: LearnerCartItem[];
};

type LearnerPortalContextValue = LearnerPortalState & {
  favoriteSlugs: string[];
  favoritePendingSlugs: string[];
  hydrated: boolean;
  addCartItem: (item: LearnerCartItem) => void;
  removeCartItem: (courseVersionId: string) => void;
  toggleFavorite: (slug: string) => Promise<void>;
  isFavorite: (slug: string) => boolean;
  announcement: string;
};

const emptyState: LearnerPortalState = {
  cart: [],
};

const LearnerPortalContext = createContext<LearnerPortalContextValue | null>(
  null,
);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const coverPattern = /^\/api\/catalog\/courses\/[0-9a-f-]{36}\/cover$/i;

function isDeliveryType(
  value: unknown,
): value is LearnerCartItem["deliveryType"] {
  return value === "recorded" || value === "live" || value === "hybrid";
}

function parseState(value: string | null): LearnerPortalState {
  if (!value) return emptyState;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return emptyState;
    const candidate = parsed as Partial<LearnerPortalState>;
    const cart = Array.isArray(candidate.cart)
      ? candidate.cart.filter((item): item is LearnerCartItem => {
          if (!item || typeof item !== "object") return false;
          const course = item as Partial<LearnerCartItem>;
          return (
            typeof course.courseVersionId === "string" &&
            uuidPattern.test(course.courseVersionId) &&
            typeof course.slug === "string" &&
            slugPattern.test(course.slug) &&
            typeof course.title === "string" &&
            course.title.length > 0 &&
            course.title.length <= 160 &&
            Number.isInteger(course.priceTwd) &&
            (course.priceTwd ?? -1) >= 0 &&
            (course.priceTwd ?? 10_000_001) <= 10_000_000 &&
            isDeliveryType(course.deliveryType) &&
            (course.coverUrl === null ||
              (typeof course.coverUrl === "string" &&
                coverPattern.test(course.coverUrl)))
          );
        })
      : [];
    return { cart };
  } catch {
    return emptyState;
  }
}

export function LearnerPortalProvider({
  accountId,
  children,
  initialFavoriteSlugs,
}: {
  accountId: string;
  children: ReactNode;
  initialFavoriteSlugs: string[];
}) {
  const storageKey = `suiyue:learner-portal:${accountId}:v1`;
  const [state, setState] = useState<LearnerPortalState>(emptyState);
  const [favoriteSlugs, setFavoriteSlugs] = useState(() =>
    Array.from(
      new Set(initialFavoriteSlugs.filter((slug) => slugPattern.test(slug))),
    ),
  );
  const [favoritePendingSlugs, setFavoritePendingSlugs] = useState<string[]>(
    [],
  );
  const [hydrated, setHydrated] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setState(parseState(window.localStorage.getItem(storageKey)));
      setHydrated(true);
    }, 0);
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === storageKey) setState(parseState(event.newValue));
    };
    window.addEventListener("storage", syncAcrossTabs);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("storage", syncAcrossTabs);
    };
  }, [storageKey]);

  function save(next: LearnerPortalState) {
    setState(next);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  }

  const value: LearnerPortalContextValue = {
    ...state,
    favoriteSlugs,
    favoritePendingSlugs,
    hydrated,
    announcement,
    addCartItem(item) {
      if (
        state.cart.some(
          (course) => course.courseVersionId === item.courseVersionId,
        )
      ) {
        setAnnouncement(`${item.title} 已經在購物車裡。`);
        return;
      }
      save({ ...state, cart: [...state.cart, item] });
      setAnnouncement(`已將 ${item.title} 加入購物車。`);
    },
    removeCartItem(courseVersionId) {
      const removed = state.cart.find(
        (course) => course.courseVersionId === courseVersionId,
      );
      save({
        ...state,
        cart: state.cart.filter(
          (course) => course.courseVersionId !== courseVersionId,
        ),
      });
      if (removed) setAnnouncement(`已從購物車移除 ${removed.title}。`);
    },
    async toggleFavorite(slug) {
      if (!slugPattern.test(slug) || favoritePendingSlugs.includes(slug)) {
        return;
      }
      const existed = favoriteSlugs.includes(slug);
      const favorited = !existed;
      setFavoritePendingSlugs((current) => [...current, slug]);
      setFavoriteSlugs((current) =>
        favorited
          ? Array.from(new Set([...current, slug]))
          : current.filter((item) => item !== slug),
      );
      setAnnouncement(favorited ? "正在加入收藏…" : "正在取消收藏…");
      try {
        const response = await fetch("/api/favorites", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "idempotency-key": crypto.randomUUID(),
          },
          body: JSON.stringify({ slug, favorited }),
        });
        const result = await response.json().catch(() => null);
        if (
          !response.ok ||
          result?.data?.favorited !== favorited ||
          result?.data?.slug !== slug
        ) {
          throw new Error(result?.error ?? "COURSE_FAVORITE_REJECTED");
        }
        setAnnouncement(favorited ? "已加入我的收藏。" : "已取消收藏。");
      } catch {
        setFavoriteSlugs((current) =>
          existed
            ? Array.from(new Set([...current, slug]))
            : current.filter((item) => item !== slug),
        );
        setAnnouncement("收藏沒有更新，請稍後再試。");
      } finally {
        setFavoritePendingSlugs((current) =>
          current.filter((item) => item !== slug),
        );
      }
    },
    isFavorite(slug) {
      return favoriteSlugs.includes(slug);
    },
  };

  return (
    <LearnerPortalContext.Provider value={value}>
      {children}
      <span
        aria-atomic="true"
        aria-live="polite"
        className="visually-hidden"
        role="status"
      >
        {announcement}
      </span>
    </LearnerPortalContext.Provider>
  );
}

export function useLearnerPortal() {
  const value = useContext(LearnerPortalContext);
  if (!value) {
    throw new Error("LEARNER_PORTAL_PROVIDER_REQUIRED");
  }
  return value;
}
