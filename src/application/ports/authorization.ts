export interface AuthorizationContext {
  readonly subject: string;
  readonly scopes: ReadonlySet<string>;
}

export interface AuthorizationContextPort {
  getCurrent(): AuthorizationContext | undefined;
}
