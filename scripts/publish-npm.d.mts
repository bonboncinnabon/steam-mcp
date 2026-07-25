export interface PublishCommandResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface PublishNpmPackageOptions {
  readonly archiveArgument: string;
  readonly evidenceArgument: string;
  readonly cwd?: string;
  readonly run?: (
    command: string,
    arguments_: readonly string[],
  ) => PublishCommandResult;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

export declare function publishNpmPackage(
  options: PublishNpmPackageOptions,
): Promise<void>;
