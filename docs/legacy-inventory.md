# Disposable legacy inventory evidence

Baseline before replacement:

- Git branch: `codex/suiyue-clean-rebuild`
- Git commit: `481a54f`
- Working tree: clean
- Legacy source files: 143
- Legacy application migrations: 7
- Legacy source domains: email/password Auth, ECPay payment/invoice, demo pilot
  course, enterprise seat lots/price tiers, old accreditation/live/Zoom flows
- Preserved: `.git`, `PLAN.md`, `PLAN-REVIEW-LOG.md`, Suiyue name,
  `public/suiyue-milk.png`, Vercel/Supabase link metadata

Frozen legacy migration checksums:

| Migration        | SHA-256                                                            |
| ---------------- | ------------------------------------------------------------------ |
| reset APM        | `bdca71a297c3f26c8d3e35f2c849cdbba7cbe51cad3262583910bbef9946f697` |
| initial learning | `f0d4ff255191e638594c19e08c0ec6f8a18860c49186a66ec4f4b19b0a18c`    |
| closed beta      | `9f9cc8d6cef516613f2e4f59ce61053cd78ff522957090850277709b4290c3cf` |
| accreditation    | `ad5ab3f5f60b4cea338f5fb2852c1f939456ed1bd892de06558970fd298377fd` |
| live             | `49077047880f918b32829dff972809b9a8c40753340d88c1dad6ecfc7cc50be6` |
| enterprise seats | `fe3345f06a185bbc549423453e0a6ab53be31b5a58aa97e0d79a0d15b9486b91` |
| allowance fix    | `9ea0a4fc20d31692148ea216fa66769f2fbebc68f637a8e4c675b74d338db605` |

Normalized concatenated fingerprint used by the reset guard:
`9520c33bac3a0b4f719344ddba5ae25e98067dcdd5c7115da67570736d7eefbc`.

The exact removed paths remain visible in the uncommitted Git diff against
`481a54f`; no legacy business data backup was created or claimed.
