export function canonicalArchiveDigest(archive: Uint8Array): string;

export function releaseArchiveName(
  packageName: string,
  version: string,
): string;

export function npmPublicationAction(
  localIntegrity: string,
  publishedIntegrity: string | undefined,
): "publish" | "reuse";
