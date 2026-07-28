export type LearnerPortalIconName =
  | "account"
  | "book"
  | "bookmark"
  | "cart"
  | "certificate"
  | "chevron"
  | "discount"
  | "home"
  | "notification"
  | "order"
  | "search"
  | "settings"
  | "support"
  | "x";

export function LearnerPortalIcon({
  name,
  size = 24,
}: {
  name: LearnerPortalIconName;
  size?: number;
}) {
  const common = {
    "aria-hidden": true,
    fill: "none",
    height: size,
    viewBox: "0 0 24 24",
    width: size,
  } as const;

  switch (name) {
    case "account":
      return (
        <svg {...common}>
          <circle
            cx="12"
            cy="8"
            r="3.5"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M4.8 20c.7-4 3-6 7.2-6s6.5 2 7.2 6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path
            d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5v-16Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "bookmark":
      return (
        <svg {...common}>
          <path
            d="M7 4.5A1.5 1.5 0 0 1 8.5 3h7A1.5 1.5 0 0 1 17 4.5V21l-5-3-5 3V4.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "cart":
      return (
        <svg {...common}>
          <path
            d="M3 4h2l1.8 9.2a2 2 0 0 0 2 1.6h7.8a2 2 0 0 0 1.9-1.4L20 8H6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <circle cx="9" cy="19" r="1.3" fill="currentColor" />
          <circle cx="17" cy="19" r="1.3" fill="currentColor" />
        </svg>
      );
    case "certificate":
      return (
        <svg {...common}>
          <path
            d="M6 3h9l3 3v9.5A2.5 2.5 0 0 1 15.5 18h-9A2.5 2.5 0 0 1 4 15.5v-10A2.5 2.5 0 0 1 6.5 3Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="M14 3v4h4M8 9h6M8 12h6M10 18l-1 3 3-1 3 1-1-3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "chevron":
      return (
        <svg {...common}>
          <path
            d="m9 5 7 7-7 7"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
          />
        </svg>
      );
    case "discount":
      return (
        <svg {...common}>
          <path
            d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5V9a3 3 0 0 0 0 6v1.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5V15a3 3 0 0 0 0-6V7.5Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="m9 15 6-6M9.2 9h.1M14.7 15h.1"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path
            d="m3 11 9-8 9 8"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="M5.5 9.5V21h13V9.5M9.5 21v-7h5v7"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "notification":
      return (
        <svg {...common}>
          <path
            d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8Z"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="M10 21h4"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "order":
      return (
        <svg {...common}>
          <path
            d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
          <path
            d="M9 8h6M9 12h6"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle
            cx="10.5"
            cy="10.5"
            r="6.5"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="m15.5 15.5 5 5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <circle
            cx="12"
            cy="12"
            r="3.2"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <path
            d="M19 13.5V10.5l-2-.7-.6-1.4.9-1.9-2-2-1.9.9-1.4-.6-.7-2h-2.8l-.7 2-1.4.6-1.9-.9-2 2 .9 1.9-.6 1.4-2 .7v3l2 .7.6 1.4-.9 1.9 2 2 1.9-.9 1.4.6.7 2h2.8l.7-2 1.4-.6 1.9.9 2-2-.9-1.9.6-1.4 2-.7Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
      );
    case "support":
      return (
        <svg {...common}>
          <path
            d="M4 13a8 8 0 0 1 16 0"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.8"
          />
          <path
            d="M4 13v4a2 2 0 0 0 2 2h1v-7H6a2 2 0 0 0-2 1ZM20 13v4a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 1ZM17 19c0 1.1-.9 2-2 2h-3"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case "x":
      return (
        <svg {...common}>
          <path
            d="m6 6 12 12M18 6 6 18"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
          />
        </svg>
      );
  }
}
