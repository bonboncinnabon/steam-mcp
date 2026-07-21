export interface QuotaRequest {
  readonly subject: string;
  readonly operation: string;
  readonly cost: number;
}

export type QuotaReservation =
  | {
      readonly reserved: true;
      readonly remaining: number;
      readonly rollback: () => void;
    }
  | {
      readonly reserved: false;
      readonly reason: "user_exhausted" | "global_reserve" | "unavailable";
    };

export interface QuotaPort {
  reserve(request: QuotaRequest): Promise<QuotaReservation>;
}
