"use client";

import { useEffect, useState } from "react";

function remainingParts(startsAt: string) {
  const remaining = Math.max(0, Date.parse(startsAt) - Date.now());
  const totalMinutes = Math.floor(remaining / 60_000);
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
    started: remaining === 0,
  };
}

export function LearnerCountdown({ startsAt }: { startsAt: string }) {
  const [remaining, setRemaining] = useState(() => remainingParts(startsAt));

  useEffect(() => {
    const timer = window.setInterval(
      () => setRemaining(remainingParts(startsAt)),
      60_000,
    );
    return () => window.clearInterval(timer);
  }, [startsAt]);

  if (remaining.started) {
    return <strong className="learner-countdown-open">現在可以上課</strong>;
  }

  return (
    <span
      aria-label={`距離開課還有 ${remaining.days} 天 ${remaining.hours} 小時 ${remaining.minutes} 分鐘`}
      className="learner-countdown"
    >
      <span>
        <strong>{remaining.days}</strong>
        <small>天</small>
      </span>
      <span>
        <strong>{remaining.hours}</strong>
        <small>時</small>
      </span>
      <span>
        <strong>{remaining.minutes}</strong>
        <small>分</small>
      </span>
    </span>
  );
}
