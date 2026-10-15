/**
 * Fresh links for detection images.
 *
 * Arrival documents store a V4 signed Cloud Storage URL in image_url /
 * departure_image_url. Those are capped at 7 days by Google, after which they
 * return ExpiredToken even though the file is still in the bucket. Instead of
 * trusting the stored link, the admin site asks this callable for a new
 * short-lived one each time someone clicks "View image".
 *
 * Accepts either a storage `path` (preferred, what the pipeline should store
 * going forward) or the old `url`, from which the object path is parsed.
 */
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

const LINK_MINUTES = 15;

/**
 * Throw unless the caller holds the admin custom claim.
 * @param {object} request Callable request.
 */
function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in required");
  }
  if (request.auth.token.admin !== true) {
    throw new HttpsError("permission-denied", "Admin privileges required");
  }
}

/**
 * Pull {bucket, path} out of a Cloud Storage URL.
 * Handles storage.googleapis.com/<bucket>/<path>, <bucket>.storage.googleapis
 * .com/<path>, and firebasestorage.googleapis.com/v0/b/<bucket>/o/<path>.
 * @param {string} raw The stored URL.
 * @return {{bucket: string, path: string}|null}
 */
function parseStorageUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch (e) {
    return null;
  }
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (u.hostname === "storage.googleapis.com" && parts.length >= 2) {
    return {bucket: parts[0], path: parts.slice(1).join("/")};
  }
  if (u.hostname.endsWith(".storage.googleapis.com") && parts.length >= 1) {
    const bucket = u.hostname.slice(0, -".storage.googleapis.com".length);
    return {bucket, path: parts.join("/")};
  }
  if (u.hostname === "firebasestorage.googleapis.com" &&
      parts[0] === "v0" && parts[1] === "b" && parts[3] === "o" &&
      parts.length >= 5) {
    return {bucket: parts[2], path: parts.slice(4).join("/")};
  }
  return null;
}

/**
 * True for this project's own buckets only, so the callable can't be used to
 * sign objects in an unrelated bucket the service account happens to reach.
 * @param {string} bucket Bucket name.
 * @return {boolean}
 */
function isProjectBucket(bucket) {
  const project = process.env.GCLOUD_PROJECT;
  return bucket === `${project}.appspot.com` ||
    bucket === `${project}.firebasestorage.app`;
}

exports.getImageUrl = onCall(async (request) => {
  requireAdmin(request);

  const {url, path, bucket: bucketIn} = request.data || {};
  let bucketName;
  let objectPath;

  if (path) {
    objectPath = String(path).replace(/^\/+/, "");
    bucketName = bucketIn || admin.storage().bucket().name;
  } else if (url) {
    const parsed = parseStorageUrl(String(url));
    if (!parsed) {
      throw new HttpsError("invalid-argument", "Not a Cloud Storage URL");
    }
    bucketName = parsed.bucket;
    objectPath = parsed.path;
  } else {
    throw new HttpsError("invalid-argument", "url or path is required");
  }

  if (!isProjectBucket(bucketName)) {
    throw new HttpsError("permission-denied", "Unknown storage bucket");
  }

  const file = admin.storage().bucket(bucketName).file(objectPath);
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError("not-found", "Image no longer exists in storage");
  }

  const [signed] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + LINK_MINUTES * 60 * 1000,
  });
  return {url: signed, expiresInMinutes: LINK_MINUTES};
});

exports.parseStorageUrl = parseStorageUrl;
