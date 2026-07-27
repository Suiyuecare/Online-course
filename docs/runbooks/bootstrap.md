# Two-admin bootstrap and break-glass

## One-time bootstrap

1. Two named administrators separately register using Phone OTP.
2. Both enroll and verify TOTP.
3. Confirm both identities are active, unrestricted, and have matching epochs.
4. From the protected server runbook, call
   `bootstrap_platform_admins(first, second, execution_hash)` using service
   authority.
5. The function succeeds only when no staff role and no bootstrap marker exist.
   It creates both platform administrators atomically and writes an audit event.
6. Confirm the permanent marker; the operation cannot be reused.

No single-admin bootstrap path exists.

## Break-glass

- Split encrypted recovery material between two independent custodians.
- Require both custodians, incident ID, fresh identity proof, and contemporaneous
  audit.
- Immediately alert all administrators.
- Raise affected identity/session epochs, revoke every session, and reset TOTP.
- Rotate exposed credentials and review all sensitive actions since the last
  known-good checkpoint.
- Break-glass material is never stored only in Vercel/Supabase or one person's
  device.
