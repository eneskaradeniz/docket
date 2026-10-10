// services/chat-read-scope.ts — what one conversation may read through the assistant's tools
// (docs/v2/application.md A-205). The scope is the conversation's own scope plus the references of
// ITS user messages: a reference widens it by exactly what it names, and an assistant message
// (whose text the model wrote) never widens anything.
import type { Conversation, PageId, ProjectSlug, RepoSlug, WorkOrderId } from '../../domain/index';

export interface ChatReadScope {
  readonly projects: ReadonlySet<ProjectSlug>;
  readonly repos: ReadonlySet<RepoSlug>;
  readonly workOrders: ReadonlySet<WorkOrderId>;
  readonly pages: ReadonlySet<PageId>;
  readonly files: readonly { readonly repo: RepoSlug; readonly path: string }[];
  /** Every project the operator owns (a global conversation). */
  readonly all: boolean;
}

export function chatReadScope(conversation: Conversation): ChatReadScope {
  const projects = new Set<ProjectSlug>();
  const repos = new Set<RepoSlug>();
  const workOrders = new Set<WorkOrderId>();
  const pages = new Set<PageId>();
  const files: { repo: RepoSlug; path: string }[] = [];

  const { scope } = conversation;
  if (scope.kind === 'project') projects.add(scope.project);
  if (scope.kind === 'workOrder') workOrders.add(scope.workOrder);

  for (const message of conversation.messages) {
    if (message.role !== 'user') continue;
    for (const ref of message.refs) {
      switch (ref.kind) {
        case 'workOrder':
          workOrders.add(ref.id as WorkOrderId);
          break;
        case 'page':
          pages.add(ref.id as PageId);
          break;
        case 'project':
          projects.add(ref.id as ProjectSlug);
          break;
        case 'repo':
          repos.add(ref.id as RepoSlug);
          break;
        case 'file':
          if (ref.repo !== undefined) files.push({ repo: ref.repo, path: ref.id });
          break;
      }
    }
  }
  return { projects, repos, workOrders, pages, files, all: scope.kind === 'global' };
}
