"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LearnerPortalIcon } from "@/components/learner-portal-icon";
import {
  anonymousLearnerCartStorageKey,
  learnerCartChangedEvent,
  parseLearnerCartStorage,
} from "@/domain/learner-cart";

function readAnonymousCartCount() {
  try {
    return parseLearnerCartStorage(
      window.localStorage.getItem(anonymousLearnerCartStorageKey),
    ).length;
  } catch {
    return 0;
  }
}

export function PublicCartLink() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const refresh = () => setCount(readAnonymousCartCount());
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === anonymousLearnerCartStorageKey) {
        refresh();
      }
    };

    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("storage", handleStorage);
    window.addEventListener(learnerCartChangedEvent, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(learnerCartChangedEvent, refresh);
    };
  }, []);

  return (
    <Link
      aria-label={`購物車，${count} 門課程`}
      className="site-cart-link"
      href="/learner/cart"
    >
      <LearnerPortalIcon name="cart" />
      <span className="site-cart-label">購物車</span>
      {count > 0 && <b aria-hidden="true">{count > 99 ? "99+" : count}</b>}
    </Link>
  );
}
