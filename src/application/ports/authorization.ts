export interface AuthorizationContext {
  readonly subject: string;
  readonly scopes: ReadonlySet<string>;
}

export interface AuthorizationContextPort {
  getCurrent(): AuthorizationContext | undefined;
}

export interface AccessTokenStatusPort {
  isActive(accessToken: string, signal?: AbortSignal): Promise<boolean>;
}
