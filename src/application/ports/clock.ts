import type { IsoTimestamp } from "../../domain/iso-timestamp.js";

export interface ClockPort {
  now(): Date;
  nowIso(): IsoTimestamp;
}
