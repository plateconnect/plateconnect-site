# PlateConnect — admin website

Next.js staff portal for `plateconnect-18068`. The website itself is
client-only (no API routes, no server actions), but this repo also owns the
Firestore security rules and the Cloud Functions that back it — anything
privileged goes through one of those functions.

## Where the rest of the system lives

This repo is one of four that share the same Firebase project.

| What | Location |
|---|---|
| Firestore security rules | `firestore.rules` (this repo) |
| Firestore indexes | `firestore.indexes.json` (this repo) |
| Cloud Functions | `functions/` (this repo) |
| Grant/revoke admin (CLI) | `platecap` repo, `set_claims.py` |
| Admin SDK service account | `platecap` repo, `firebase.json` (gitignored) |
| Plate detection pipeline | `platecap` repo, `python/` |
| Flutter mobile app | `studentconnect2.0` repo, `lib/` |

All four repos sit side by side under `Github Files -use/`.

**They moved here on 2026-08-13.** Previously `firestore.rules` and
`functions/` lived in `studentconnect2.0`, which made them easy to miss
during a search of this repo. They were moved here because this is the repo
day-to-day work happens in, and to keep new backend work out of
`studentconnect2.0` while that repo is separately being reworked. Do not
recreate a copy in `studentconnect2.0` — if both repos have one, whichever
gets deployed last silently wins and the other goes stale.

`functions/.env` (the OneSignal key) is intentionally not in git — set it up
locally by hand once, it won't show up in a file search.

Deploy from this repo:

```bash
firebase deploy --only firestore:rules
firebase deploy --only functions
```

## Access model

**The gate is the `admin` Auth custom claim** (`request.auth.token.admin`), not
a Firestore field. `users/{uid}.admin` is mirrored for display only — the admin
list UI needs it because custom claims cannot be queried.

This split exists because of the Aug 2026 lockout: admin used to live only in
`users/{uid}.admin`, so deleting the users collection revoked every admin at
once and left nobody able to repair it. Claims survive Firestore loss.

- `admin` — full access. The only tier this website checks.
- `staff` — used by `firestore.rules` `isStaff()` to gate arrivals, notices,
  plates and settings reads for the Flutter teacher view. **This website never
  reads it** (it is admin-only), so `AuthContext` intentionally does not expose
  it. Do not remove `staff` from the rules or the mobile app.

Grant either claim with `set_claims.py` in `platecap`:

```bash
python set_claims.py --list
python set_claims.py --grant admin someone@school.org
python set_claims.py --revoke admin someone@school.org
```

A claim change only reaches a signed-in client when its ID token refreshes
(~1 hour, or immediately on re-login). `AuthContext` forces one refresh when no
`admin` claim is present, so a newly granted admin only needs to reload.

`set_claims.py` is the break-glass path. Keep it working even after the
in-website admin UI exists — if the site is the only way to grant admin and the
last admin is lost, the lockout repeats.

## Gotchas

- **Never create user docs with `addDoc()`.** It mints a random document id,
  but every read is `doc(db, 'users', <auth uid>)`. Such users appear in the
  admin list yet can never load their own profile. Use the `createUserAccount`
  callable, which creates the Auth account first and keys the doc by its UID.
- **Archive, never delete.** `archiveUser` / `restoreUser` callables. A hard
  delete is what caused the Aug 2026 data loss.
- **`account_type` is not a permission.** `admin`, `staff`, `faculty` and
  `teacher` are roster values meaning "recognise this person's car at the
  gate". Only `guardian` and `student` actually sign in. Portal access is the
  custom claim, and the two are deliberately independent.
- The `arrivals` listener on the admin page reads the whole collection with no
  `limit()`, on every page load. It is by far the largest source of Firestore
  reads in the app.
