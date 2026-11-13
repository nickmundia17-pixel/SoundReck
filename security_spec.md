# Firestore Security Specification — SoundDeck Studio

## 1. Data Invariants
1. **Public vs Private PII Isolation**: `/users/{userId}` stores only public creator metadata (`uid`, `displayName`, `role`, `buyMeSodaHandle`, `bio`, timestamps). All PII (`email`, `phone`, `whatsappNumber`, private social handles) is strictly isolated in `/users/{userId}/private/info` readable and writable only by `request.auth.uid == userId`.
2. **Identity Integrity**: Every write enforces that `uid`, `ownerId`, or `supporterId` in the incoming payload strictly matches `request.auth.uid`.
3. **Immutable Ownership & Temporal Integrity**: `createdAt == request.time` on create; `createdAt == existing().createdAt` and `updatedAt == request.time` on update; `ownerId`/`uid` cannot be reassigned on update.
4. **Strict Key Allowlists & Size Bounds**: Every collection enforces `keys().hasAll(...) && keys().hasOnly(...)` on create, `affectedKeys().hasOnly(...)` on update, and explicit `.size()` bounds on all strings.
5. **Query Enforcer**: `allow list` rules explicitly evaluate `resource.data.ownerId == request.auth.uid` (for private projects/campaigns) or public creator catalog fields without delegating security to the client.

## 2. The "Dirty Dozen" Attack Payloads (All Expected: PERMISSION_DENIED)
1. **Shadow Field Injection on Profile**: `{ uid: "u1", displayName: "DJ", role: "dj", isAdmin: true, createdAt: serverTimestamp, updatedAt: serverTimestamp }`
2. **Identity Spoofing on Project**: `{ ownerId: "other_uid", title: "Track", genre: "Trap", bpm: 140, createdAt: serverTimestamp, updatedAt: serverTimestamp }`
3. **Oversized ID Poisoning**: Document ID > 128 chars or containing `/` / `$` characters.
4. **Oversized Lyrics DoS**: `lyrics` string exceeding 8000 characters on `/projects/{id}`.
5. **Invalid Role Enumeration**: `role: "superadmin"` on `/users/{uid}`.
6. **PII Cross-User Read**: User B attempting `get(/users/userA/private/info)`.
7. **Timestamp Forgery**: `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time`.
8. **Immutable Owner Reassignment**: Updating `ownerId` on `/projects/{id}`.
9. **Immutable CreatedAt Mutation**: Changing `createdAt` during `/projects/{id}` update.
10. **Negative / Invalid BPM**: `bpm: -50` or `bpm: "fast"` on `/projects/{id}`.
11. **Unbounded Soda Support Amount**: `sodaCount: 0` or `amountUsd: -100` on `/soda_supports/{id}`.
12. **Unscoped List Scrape**: User B listing `/projects` without `where('ownerId', '==', userB.uid)`.
