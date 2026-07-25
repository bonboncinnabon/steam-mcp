import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";

export function canonicalArchiveDigest(archive) {
  return createHash("sha256").update(gunzipSync(archive)).digest("hex");
}

export function releaseArchiveName(packageName, version) {
  return `${packageName.replace(/^@/u, "").replaceAll("/", "-")}-${version}.tgz`;
}

export function npmPublicationAction(localIntegrity, publishedIntegrity) {
  if (publishedIntegrity === undefined) {
    return "publish";
  }
  if (publishedIntegrity === localIntegrity) {
    return "reuse";
  }
  throw new Error(
    "Published package integrity does not match the local artifact",
  );
}
