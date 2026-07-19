export interface CommitMessageInput {
  stagedDiff: string;
  unstagedDiff?: string;
  changedFiles: string[];
  recentCommits: string[];
  branch?: string | null;
  scope?: string;
  testResults?: string[];
}

export interface CommitMessageResult {
  subject: string;
  body?: string;
  fullMessage: string;
}

export interface CommitStyleDetection {
  detectedStyle: 'conventional' | 'scoped_conventional' | 'sentence' | 'imperative' | 'issue_prefixed' | 'custom_prefix' | 'unknown';
  confidence: number;
  examples: string[];
  recommendedType?: string;
  recommendedScope?: string;
}

export interface StagedChangeSummary {
  stagedFileNames: string[];
  addedFiles: string[];
  modifiedFiles: string[];
  deletedFiles: string[];
  renamedFiles: string[];
  additions: number;
  deletions: number;
  testFilesChanged: string[];
  documentationFilesChanged: string[];
  configurationFilesChanged: string[];
  dependencyFilesChanged: string[];
  likelyPrimaryComponent?: string;
  likelyChangeCategories: string[];
}

export interface CommitMessageValidation {
  valid: boolean;
  corrected?: string;
  errors: string[];
}
