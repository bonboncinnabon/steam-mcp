import type { SteamId64 } from "../../domain/steam-id.js";

export interface LinkedIdentityPort {
  getLinkedSteamId(subject: string): Promise<SteamId64 | undefined>;
  replaceLinkedSteamId(subject: string, steamId: SteamId64): Promise<void>;
  unlinkSteamId(subject: string): Promise<void>;
}
