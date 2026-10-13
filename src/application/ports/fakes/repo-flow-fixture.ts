// fakes/repo-flow-fixture.ts — fixture conversion for the repo-owned flow (D-1): a library
// flow's stages become the repo's own copy with one version-1 binding per stage and empty
// account chains. Runs route through the bindings port as before; only the pin copies these.
// Loose shapes in and out on purpose: fixtures serialise JSON, and the store's narrowing is the
// law that decides.
export const repoFlowOf = (
  flow: { readonly id: string; readonly stages: readonly { readonly id: string; readonly role: string | null }[] },
  version = 1,
): Record<string, unknown> => ({
  flowId: flow.id,
  version,
  stages: flow.stages,
  bindings: flow.stages.map((stage) => ({
    stage: stage.id,
    ...(stage.role === null ? {} : { role: { roleId: stage.role, version: 1 } }),
    accounts: [],
  })),
});
