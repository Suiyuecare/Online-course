# PII copies and key dependencies

| Copy                     | Allowed data                                                     | Encryption/key                                        | Browser exposure                        | Deletion/recovery                                        |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- | -------------------------------------------------------- |
| `auth.users`             | Phone required; optional verified email                          | Supabase Auth                                         | Current session only                    | Identity can be disabled without deleting business owner |
| Private identity profile | Name, ID/resident ID, birth date, care-worker ID, category, unit | Per-person AES-256-GCM DEK; versioned managed-KMS KEK | Never                                   | Crypto-shred DEK after holds; tombstone replay           |
| Blind indexes            | Normalized national/care-worker identifiers                      | Separate current/previous HMAC keys                   | Never                                   | Dual-index rotation, then old index purge                |
| Invitations              | Encrypted E.164 phone and invitation-only blind index            | Envelope + separate HMAC                              | Never plaintext                         | Purge reversible number on accept/revoke/expiry          |
| Payment proof/correction | Minimum evidence                                                 | Quarantine then private envelope                      | Narrow authenticated download only      | Case/retention purge; keep hash/result                   |
| Certificate PDF          | Masked/public certificate fields                                 | Private object; checksum                              | Authenticated owner; public page masked | Revisions retained/revoked, not overwritten              |
| Accreditation export     | Required full identity only                                      | Separate envelope per export                          | One-time app capability stream          | Short capability expiry; retention policy                |
| Notification payload     | Masked/minimum fields                                            | Destination encrypted in outbox                       | Website record to owner                 | Channel event retained without full PII                  |
| Provider                 | Synthetic Zoom email/customer key; minimum delivery address      | Provider control + server token                       | Ephemeral join only                     | Registrant revocation/provider retention                 |
| Logs/audit               | IDs, reason, hashes; no plaintext secrets/PII                    | Private log/audit store + signed checkpoints          | Staff query by role/reason              | Legal retention/checkpoint                               |
| Offline backup           | Encrypted DB, Storage, video manifests                           | KMS plus dual-person encrypted escrow                 | Never                                   | Tombstone replay before reopen                           |

Every decrypt, full export, download, deletion, recovery, and exceptional
retention action records actor, target, reason, and timestamp. Support,
course-admin, and organization screens use masked projections.

Accreditation-case plaintext additionally requires two different reviewer
approvals. Only the assigned reviewer can mint the final two-minute access
grant after another fresh TOTP; the service-side KMS read consumes that grant
once and appends a separate audit event.
