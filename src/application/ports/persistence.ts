import type { IsoTimestamp } from "../../domain/iso-timestamp.js";
import type { SteamId64 } from "../../domain/steam-id.js";

export interface AccountRecord {
  readonly subject: string;
  readonly linkedSteamId?: SteamId64;
  readonly consentedAt?: IsoTimestamp;
  readonly revokedAt?: IsoTimestamp;
  readonly deletionRequestedAt?: IsoTimestamp;
}

export interface AccountPersistencePort {
  get(subject: string): Promise<AccountRecord | undefined>;
  upsert(record: AccountRecord): Promise<void>;
  deleteDeletableMetadata(subject: string): Promise<void>;
}
