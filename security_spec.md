# Security Specification — CCLS Ain Mlila Cloud Sync

## Phase 0: Data Invariants
1. **Master Gate & Verified Authentication:** No unauthenticated user may read or write any collection. Write operations require `request.auth != null` AND `request.auth.token.email_verified == true`.
2. **Ownership Integrity:** Every operational document (`ccls_records`, `fire_motors`, `water_tanks`, `security_settings`, `intruder_alerts`, `storage_snapshots`) must store `ownerUid == request.auth.uid` on create and keep `ownerUid` immutable on update.
3. **PII Isolation:** `security_settings` (supervisor phone) and `intruder_alerts` (phone & device info) are readable and writable ONLY by the verified owner (`resource.data.ownerUid == request.auth.uid`) or verified bootstrapped admin (`ferdjiouisalah@gmail.com`).
4. **Strict Field Allowlisting & Bounds:** Every `create` verifies `hasAll` and `hasOnly` with strict string `.size()` bounds and numeric ranges (`capacityM3 > 0`, `currentM3 >= 0`, `currentM3 <= capacityM3 * 1.1`, `status in ['تعمل', 'عطب', 'صيانة']`). Every `update` specifies exact `affectedKeys().hasOnly(...)` and runs the validation helper first.
5. **Temporal Integrity:** `createdAt == request.time` on create (immutable on update) and `updatedAt == request.time` on update.
6. **Zero DB Lookups in List Queries:** `allow list` rules evaluate only `request.auth` token claims and `resource.data` fields (no `get()` or `exists()`).

## Dirty Dozen Payloads (Must All Return PERMISSION_DENIED)
1. Unauthenticated read on `/ccls_records`.
2. Unauthenticated write on `/fire_motors`.
3. Create `/ccls_records/{id}` with `email_verified: false`.
4. Create `/ccls_records/{id}` with `ownerUid` set to another user's UID (Identity Spoofing).
5. Create `/fire_motors/{id}` with ghost field `isVerified: true` (Shadow Update/Write).
6. Update `/fire_motors/{id}` modifying `ownerUid` or `createdAt` (Immortal Field tampering).
7. Create `/water_tanks/{id}` with negative `currentM3: -10` or `capacityM3: 0` (Value Poisoning).
8. Create `/fire_motors/{id}` with invalid status `"hacked"` not in `['تعمل', 'عطب', 'صيانة']`.
9. Read `/security_settings/{id}` by a different signed-in non-admin user (PII Leak).
10. Create `/ccls_records/{id}` with `field1` exceeding 240 chars or doc ID failing `^[a-zA-Z0-9_\-]+$` (Resource Poisoning).
11. Create `/admins/{uid}` by non-admin user (Privilege Escalation).
12. List `/intruder_alerts` by non-owner non-admin user without `where('ownerUid', '==', uid)`.
