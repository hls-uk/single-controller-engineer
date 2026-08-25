export * from "./authority.js";
export * from "./normalize.js";
export * from "./outbox.js";
export * from "./packet.js";
export * from "./schemas.js";
export {
  discoverExisting,
  reconcileExactDuplicates,
  type DiscoveryResult,
  type DuplicateReconciliation,
  type FeedbackGitHubTransport,
  type GitHubDiscovery,
  type GitHubIssue,
  type SubmitResult,
} from "./submit.js";
