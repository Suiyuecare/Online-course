"use client";

import {
  useCallback,
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  anonymousLearnerCartStorageKey,
  deduplicateLearnerCartItems,
  learnerCartCacheStorageKey,
  learnerCartMaximumItems,
  learnerCartResponseSchema,
  legacyLearnerPortalStorageKey,
  mergeLearnerCartItems,
  parseLearnerCartStorage,
  serializeLearnerCartStorage,
  type LearnerCartItem,
  type LearnerCartMutation,
  type LearnerCartResponse,
} from "@/domain/learner-cart";

export type { LearnerCartItem } from "@/domain/learner-cart";

type LearnerPortalState = {
  cart: LearnerCartItem[];
};

type LearnerPortalContextValue = LearnerPortalState & {
  favoriteSlugs: string[];
  favoritePendingSlugs: string[];
  cartPendingIds: string[];
  cartSyncStatus: "syncing" | "synced" | "unavailable";
  hydrated: boolean;
  addCartItem: (item: LearnerCartItem) => Promise<void>;
  removeCartItem: (courseVersionId: string) => Promise<void>;
  toggleFavorite: (slug: string) => Promise<void>;
  isFavorite: (slug: string) => boolean;
  announcement: string;
};

const LearnerPortalContext = createContext<LearnerPortalContextValue | null>(
  null,
);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function parseCartResponse(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== "object" || !("data" in body)) {
    throw new Error("LEARNER_CART_UNAVAILABLE");
  }
  const parsed = learnerCartResponseSchema.safeParse(body.data);
  if (!parsed.success) throw new Error("LEARNER_CART_UNAVAILABLE");
  return parsed.data;
}

async function requestCartMutation(
  accountId: string,
  input: LearnerCartMutation,
) {
  return parseCartResponse(
    await fetch("/api/cart", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "x-suiyue-account-id": accountId,
      },
      body: JSON.stringify(input),
    }),
  );
}

async function requestCartRefresh(accountId: string) {
  return parseCartResponse(
    await fetch("/api/cart", {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-suiyue-account-id": accountId,
      },
      cache: "no-store",
    }),
  );
}

export function LearnerPortalProvider({
  accountId,
  children,
  initialCart,
  initialCartAvailable,
  initialFavoriteSlugs,
}: {
  accountId: string;
  children: ReactNode;
  initialCart: LearnerCartItem[];
  initialCartAvailable: boolean;
  initialFavoriteSlugs: string[];
}) {
  const cacheStorageKey = learnerCartCacheStorageKey(accountId);
  const legacyStorageKey = legacyLearnerPortalStorageKey(accountId);
  const initialCartRef = useRef(initialCart);
  const [state, setState] = useState<LearnerPortalState>(() => ({
    cart: initialCart,
  }));
  const stateRef = useRef(state);
  const cartRequestQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [favoriteSlugs, setFavoriteSlugs] = useState(() =>
    Array.from(
      new Set(initialFavoriteSlugs.filter((slug) => slugPattern.test(slug))),
    ),
  );
  const [favoritePendingSlugs, setFavoritePendingSlugs] = useState<string[]>(
    [],
  );
  const [cartPendingIds, setCartPendingIds] = useState<string[]>([]);
  const [cartSyncStatus, setCartSyncStatus] = useState<
    "syncing" | "synced" | "unavailable"
  >(initialCartAvailable ? "syncing" : "unavailable");
  const [hydrated, setHydrated] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const saveCart = useCallback(
    (cart: LearnerCartItem[]) => {
      const next = { cart };
      stateRef.current = next;
      setState(next);
      window.localStorage.setItem(
        cacheStorageKey,
        serializeLearnerCartStorage(cart),
      );
    },
    [cacheStorageKey],
  );

  const acceptServerCart = useCallback(
    (cart: LearnerCartItem[]) => {
      saveCart(cart);
      setCartSyncStatus("synced");
    },
    [saveCart],
  );

  const enqueueCartRequest = useCallback(
    (request: () => Promise<LearnerCartResponse>) => {
      const result = cartRequestQueueRef.current.then(request, request);
      cartRequestQueueRef.current = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const anonymousItems = parseLearnerCartStorage(
      window.localStorage.getItem(anonymousLearnerCartStorageKey),
    );
    const legacyItems = parseLearnerCartStorage(
      window.localStorage.getItem(legacyStorageKey),
    );
    const cachedItems = parseLearnerCartStorage(
      window.localStorage.getItem(cacheStorageKey),
    );
    const migrationItems = deduplicateLearnerCartItems(
      anonymousItems,
      legacyItems,
    );
    // The account cache is display-only fallback data. Uploading it would
    // resurrect items that another device or a completed order removed.
    const fallback = initialCartAvailable
      ? mergeLearnerCartItems(initialCartRef.current, migrationItems)
      : mergeLearnerCartItems(migrationItems, cachedItems);
    saveCart(fallback);
    setHydrated(true);
    setCartSyncStatus("syncing");

    async function mergeLocalCart(
      items: LearnerCartItem[],
      sources: {
        anonymous: LearnerCartItem[];
        legacy: LearnerCartItem[];
      },
    ) {
      try {
        let result: LearnerCartResponse;
        const rejectedIds = new Set<string>();
        if (items.length === 0) {
          result = initialCartAvailable
            ? {
                items: initialCartRef.current,
                rejectedCourseVersionIds: [],
              }
            : await enqueueCartRequest(() => requestCartRefresh(accountId));
        } else {
          let latestResult: LearnerCartResponse | null = null;
          for (
            let offset = 0;
            offset < items.length;
            offset += learnerCartMaximumItems
          ) {
            const batch = items.slice(offset, offset + learnerCartMaximumItems);
            latestResult = await enqueueCartRequest(() =>
              requestCartMutation(accountId, {
                operation: "merge",
                courseVersionIds: batch.map((item) => item.courseVersionId),
              }),
            );
            for (const id of latestResult.rejectedCourseVersionIds) {
              rejectedIds.add(id);
            }
          }
          if (!latestResult) throw new Error("LEARNER_CART_UNAVAILABLE");
          result = latestResult;
        }
        if (!active) return;
        acceptServerCart(result.items);
        const submittedIds = new Set(items.map((item) => item.courseVersionId));
        const concurrentAnonymousItems = parseLearnerCartStorage(
          window.localStorage.getItem(anonymousLearnerCartStorageKey),
        ).filter((item) => !submittedIds.has(item.courseVersionId));
        const rejectedAnonymousItems = sources.anonymous.filter((item) =>
          rejectedIds.has(item.courseVersionId),
        );
        const rejectedLegacyItems = sources.legacy.filter((item) =>
          rejectedIds.has(item.courseVersionId),
        );
        const remainingAnonymousItems = mergeLearnerCartItems(
          rejectedAnonymousItems,
          concurrentAnonymousItems,
        );
        if (remainingAnonymousItems.length > 0) {
          window.localStorage.setItem(
            anonymousLearnerCartStorageKey,
            serializeLearnerCartStorage(remainingAnonymousItems),
          );
        } else {
          window.localStorage.removeItem(anonymousLearnerCartStorageKey);
        }
        if (rejectedLegacyItems.length > 0) {
          window.localStorage.setItem(
            legacyStorageKey,
            serializeLearnerCartStorage(rejectedLegacyItems),
          );
        } else {
          window.localStorage.removeItem(legacyStorageKey);
        }
        if (rejectedIds.size > 0) {
          setAnnouncement(
            `${rejectedIds.size} 門已停售或購物車已滿的課程仍保留在這台裝置，尚未加入帳號購物車。`,
          );
        }
      } catch {
        if (!active) return;
        setCartSyncStatus("unavailable");
        setAnnouncement(
          "購物車暫時無法同步；目前先顯示這台裝置上次保存的內容。",
        );
      }
    }

    async function refreshServerCart() {
      try {
        const result = await enqueueCartRequest(() =>
          requestCartRefresh(accountId),
        );
        if (active) acceptServerCart(result.items);
      } catch {
        if (active) setCartSyncStatus("unavailable");
      }
    }

    void mergeLocalCart(migrationItems, {
      anonymous: anonymousItems,
      legacy: legacyItems,
    });

    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === anonymousLearnerCartStorageKey) {
        const incomingAnonymousItems = parseLearnerCartStorage(event.newValue);
        if (incomingAnonymousItems.length === 0) {
          void refreshServerCart();
          return;
        }
        saveCart(
          mergeLearnerCartItems(stateRef.current.cart, incomingAnonymousItems),
        );
        setCartSyncStatus("syncing");
        void mergeLocalCart(incomingAnonymousItems, {
          anonymous: incomingAnonymousItems,
          legacy: [],
        });
      } else if (event.key === cacheStorageKey) {
        void refreshServerCart();
      }
    };
    const refreshOnFocus = () => void refreshServerCart();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshServerCart();
    };
    window.addEventListener("storage", syncAcrossTabs);
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      active = false;
      window.removeEventListener("storage", syncAcrossTabs);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [
    accountId,
    acceptServerCart,
    cacheStorageKey,
    enqueueCartRequest,
    initialCartAvailable,
    legacyStorageKey,
    saveCart,
  ]);

  const value: LearnerPortalContextValue = {
    ...state,
    favoriteSlugs,
    favoritePendingSlugs,
    cartPendingIds,
    cartSyncStatus,
    hydrated,
    announcement,
    async addCartItem(item) {
      if (
        cartSyncStatus === "syncing" ||
        cartPendingIds.includes(item.courseVersionId)
      ) {
        return;
      }
      if (
        stateRef.current.cart.some(
          (course) => course.courseVersionId === item.courseVersionId,
        )
      ) {
        setAnnouncement(`${item.title} 已經在購物車裡。`);
        return;
      }
      setCartPendingIds((current) => [...current, item.courseVersionId]);
      setAnnouncement(`正在將 ${item.title} 加入購物車…`);
      try {
        const result = await enqueueCartRequest(() =>
          requestCartMutation(accountId, {
            operation: "add",
            courseVersionIds: [item.courseVersionId],
          }),
        );
        acceptServerCart(result.items);
        setAnnouncement(`已將 ${item.title} 加入購物車並同步到帳號。`);
      } catch {
        setCartSyncStatus("unavailable");
        setAnnouncement("課程沒有加入購物車，請稍後再試。");
      } finally {
        setCartPendingIds((current) =>
          current.filter((id) => id !== item.courseVersionId),
        );
      }
    },
    async removeCartItem(courseVersionId) {
      if (
        cartSyncStatus === "syncing" ||
        cartPendingIds.includes(courseVersionId)
      ) {
        return;
      }
      const removed = stateRef.current.cart.find(
        (course) => course.courseVersionId === courseVersionId,
      );
      if (!removed) return;
      setCartPendingIds((current) => [...current, courseVersionId]);
      setAnnouncement(`正在從購物車移除 ${removed.title}…`);
      try {
        const result = await enqueueCartRequest(() =>
          requestCartMutation(accountId, {
            operation: "remove",
            courseVersionIds: [courseVersionId],
          }),
        );
        acceptServerCart(result.items);
        setAnnouncement(`已從購物車移除 ${removed.title}。`);
      } catch {
        setCartSyncStatus("unavailable");
        setAnnouncement("購物車沒有更新，請稍後再試。");
      } finally {
        setCartPendingIds((current) =>
          current.filter((id) => id !== courseVersionId),
        );
      }
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
