declare module "es-git" {
  export function openRepository(path: string): Promise<{
    statuses: (options?: {
      includeUntracked?: boolean;
      recurseUntrackedDirs?: boolean;
      includeIgnored?: boolean;
    }) => Array<{
      path: () => string;
      status: () => {
        isIndexNew?: () => boolean;
        isIndexModified?: () => boolean;
        isIndexDeleted?: () => boolean;
        isIndexRenamed?: () => boolean;
        isIndexTypechange?: () => boolean;
        isWtNew?: () => boolean;
        isWtModified?: () => boolean;
        isWtDeleted?: () => boolean;
        isWtTypechange?: () => boolean;
        isWtRenamed?: () => boolean;
        isIgnored?: () => boolean;
      };
    }>;
    head: () => {
      shorthandle?: () => string;
      name?: () => string;
      shorthand?: () => string;
    };
  }>;
}
