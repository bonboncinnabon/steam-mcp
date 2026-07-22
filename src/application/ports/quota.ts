export interface QuotaRequest {
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
      readonly reason: "global_reserve" | "unavailable";
    };

export interface QuotaPort {
  reserve(request: QuotaRequest): Promise<QuotaReservation>;
}
