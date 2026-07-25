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
