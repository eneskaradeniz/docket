// roadmap/validate.ts — narrows untyped (parsed roadmap YAML/JSON) input into a typed Roadmap.
// Field-by-field narrowing plus cross-reference and cycle checks; every issue is collected before
// deciding (all-or-nothing), so one run reports a task cycle, a phase cycle, and the deadlocks that
// only appear when both graphs are combined.
import type { ProjectDef } from '../definitions';
import { err, ok, parseSlug, type PhaseSlug, type RepoSlug, type Result, type Slug, type TaskSlug } from '../shared';
import type {
  IssueSource,
  PhaseDef,
  PhaseItem,
  RepoIssue,
  RepoMilestone,
  RepoRoadmap,
  Roadmap,
  RoadmapIssue,
  RoadmapIssueCode,
  TaskDef,
} from './types';

type UnknownRecord = Readonly<Record<string, unknown>>;

// Drafts survive partial failure (fields stay undefined) so cross-reference checks still see the
// ids that did parse, instead of cascading into phantom "unknown" references.
interface TaskDraft {
  readonly id: TaskSlug | undefined;
  readonly title: string | undefined;
  readonly dependsOnSlots: readonly (TaskSlug | undefined)[] | undefined;
  readonly acceptance: readonly string[] | undefined;
  readonly targetSlots: readonly (RepoSlug | undefined)[] | undefined; // undefined = targets absent
}

interface PhaseItemDraft {
  readonly kind: 'manual' | 'repo_item' | undefined;
  readonly manualId: string | undefined;
  readonly manualTitle: string | undefined;
  readonly manualDone: boolean | undefined;
  readonly refRepo: RepoSlug | undefined;
  readonly refKind: 'milestone' | 'issue' | undefined;
  readonly refId: string | undefined;
}

interface PhaseDraft {
  readonly id: PhaseSlug | undefined;
  readonly name: string | undefined;
  readonly blockedBySlots: readonly (PhaseSlug | undefined)[] | undefined;
  readonly tasks: readonly (TaskDraft | undefined)[] | undefined;
  readonly items: readonly (PhaseItemDraft | undefined)[] | undefined;
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const addIssue = (issues: RoadmapIssue[], path: string, code: RoadmapIssueCode, message: string): void => {
  issues.push({ path, code, message });
};

const readStringField = (issues: RoadmapIssue[], container: UnknownRecord, field: string, path: string): string | undefined => {
  const value: unknown = container[field];
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (typeof value !== 'string') {
    addIssue(issues, path, 'wrong_type', `${path} must be a string`);
    return undefined;
  }
  return value;
};

const readSlugField = <B extends string>(issues: RoadmapIssue[], container: UnknownRecord, field: string, path: string): Slug<B> | undefined => {
  const value = readStringField(issues, container, field, path);
  if (value === undefined) return undefined;
  const parsed = parseSlug<B>(value);
  if (!parsed.ok) {
    addIssue(issues, path, 'invalid_slug', `${path} "${value}" is not a valid slug (^[a-z0-9][a-z0-9-]{0,62}$)`);
    return undefined;
  }
  return parsed.value;
};

const readStringArrayField = (issues: RoadmapIssue[], container: UnknownRecord, field: string, path: string): readonly string[] | undefined => {
  const value: unknown = container[field];
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be an array of strings`);
    return undefined;
  }
  const out: string[] = [];
  let valid = true;
  value.forEach((item: unknown, index: number) => {
    if (typeof item !== 'string') {
      addIssue(issues, `${path}[${index}]`, 'wrong_type', `${path}[${index}] must be a string`);
      valid = false;
    } else {
      out.push(item);
    }
  });
  return valid ? out : undefined;
};

/** Parses an array of slug strings, keeping one slot per input item (undefined = bad item). */
const readSlugSlots = <B extends string>(issues: RoadmapIssue[], value: unknown, path: string): readonly (Slug<B> | undefined)[] | undefined => {
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be an array`);
    return undefined;
  }
  const slots: (Slug<B> | undefined)[] = [];
  value.forEach((item: unknown, index: number) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== 'string') {
      addIssue(issues, itemPath, 'wrong_type', `${itemPath} must be a string`);
      slots.push(undefined);
      return;
    }
    const parsed = parseSlug<B>(item);
    if (!parsed.ok) {
      addIssue(issues, itemPath, 'invalid_slug', `${itemPath} "${item}" is not a valid slug`);
      slots.push(undefined);
      return;
    }
    slots.push(parsed.value);
  });
  return slots;
};

/** R-47: targets are optional in the file; each entry is slug-checked, and a project checks membership. */
const parseTargetSlots = (
  issues: RoadmapIssue[],
  container: UnknownRecord,
  path: string,
): readonly (RepoSlug | undefined)[] | undefined => {
  const raw: unknown = container['targets'];
  if (raw === undefined) return undefined;
  return readSlugSlots<'repo'>(issues, raw, `${path}.targets`);
};

const parseTask = (issues: RoadmapIssue[], container: UnknownRecord, path: string): TaskDraft => ({
  id: readSlugField<'task'>(issues, container, 'id', `${path}.id`),
  title: readStringField(issues, container, 'title', `${path}.title`),
  dependsOnSlots: readSlugSlots<'task'>(issues, container['dependsOn'], `${path}.dependsOn`),
  acceptance: readStringArrayField(issues, container, 'acceptance', `${path}.acceptance`),
  targetSlots: parseTargetSlots(issues, container, path),
});

const parseIssueSource = (issues: RoadmapIssue[], container: UnknownRecord, path: string): IssueSource | undefined => {
  const kind = readStringField(issues, container, 'kind', `${path}.kind`);
  if (kind === undefined) return undefined;
  if (kind === 'local') return { kind: 'local' };
  if (kind === 'tracker') {
    const tracker = readStringField(issues, container, 'tracker', `${path}.tracker`);
    const externalId = readStringField(issues, container, 'externalId', `${path}.externalId`);
    if (tracker === undefined || externalId === undefined) return undefined;
    const urlRaw: unknown = container['url'];
    if (urlRaw !== undefined && typeof urlRaw !== 'string') {
      addIssue(issues, `${path}.url`, 'wrong_type', `${path}.url must be a string`);
      return undefined;
    }
    return urlRaw === undefined ? { kind: 'tracker', tracker, externalId } : { kind: 'tracker', tracker, externalId, url: urlRaw };
  }
  addIssue(issues, `${path}.kind`, 'wrong_type', `${path}.kind must be "local" or "tracker"`);
  return undefined;
};

const parsePhaseItem = (issues: RoadmapIssue[], container: UnknownRecord, path: string): PhaseItemDraft => {
  const kindRaw = readStringField(issues, container, 'kind', `${path}.kind`);
  if (kindRaw === undefined) return { kind: undefined, manualId: undefined, manualTitle: undefined, manualDone: undefined, refRepo: undefined, refKind: undefined, refId: undefined };
  if (kindRaw === 'manual') {
    const manualId = readStringField(issues, container, 'id', `${path}.id`);
    const manualTitle = readStringField(issues, container, 'title', `${path}.title`);
    const doneRaw: unknown = container['done'];
    if (doneRaw === undefined) {
      addIssue(issues, `${path}.done`, 'missing_field', `${path}.done is required`);
    } else if (typeof doneRaw !== 'boolean') {
      addIssue(issues, `${path}.done`, 'wrong_type', `${path}.done must be a boolean`);
    }
    return {
      kind: 'manual',
      manualId,
      manualTitle,
      manualDone: typeof doneRaw === 'boolean' ? doneRaw : undefined,
      refRepo: undefined,
      refKind: undefined,
      refId: undefined,
    };
  }
  if (kindRaw === 'repo_item') {
    const refRaw: unknown = container['ref'];
    if (!isRecord(refRaw)) {
      addIssue(issues, `${path}.ref`, 'wrong_type', `${path}.ref must be an object`);
      return { kind: 'repo_item', manualId: undefined, manualTitle: undefined, manualDone: undefined, refRepo: undefined, refKind: undefined, refId: undefined };
    }
    const refRepo = readSlugField<'repo'>(issues, refRaw, 'repo', `${path}.ref.repo`);
    const refKindRaw = readStringField(issues, refRaw, 'kind', `${path}.ref.kind`);
    const refKind = refKindRaw === 'milestone' || refKindRaw === 'issue' ? refKindRaw : undefined;
    if (refKindRaw !== undefined && refKind === undefined) {
      addIssue(issues, `${path}.ref.kind`, 'wrong_type', `${path}.ref.kind must be "milestone" or "issue"`);
    }
    const refId = readStringField(issues, refRaw, 'id', `${path}.ref.id`);
    return {
      kind: 'repo_item',
      manualId: undefined,
      manualTitle: undefined,
      manualDone: undefined,
      refRepo,
      refKind,
      refId,
    };
  }
  addIssue(issues, `${path}.kind`, 'wrong_type', `${path}.kind must be "manual" or "repo_item"`);
  return { kind: undefined, manualId: undefined, manualTitle: undefined, manualDone: undefined, refRepo: undefined, refKind: undefined, refId: undefined };
};

const parsePhase = (issues: RoadmapIssue[], container: UnknownRecord, path: string): PhaseDraft => {
  const id = readSlugField<'phase'>(issues, container, 'id', `${path}.id`);
  const name = readStringField(issues, container, 'name', `${path}.name`);
  const blockedBySlots = readSlugSlots<'phase'>(issues, container['blockedBy'], `${path}.blockedBy`);

  const tasksRaw: unknown = container['tasks'];
  let tasks: readonly (TaskDraft | undefined)[] | undefined;
  if (tasksRaw === undefined) {
    addIssue(issues, `${path}.tasks`, 'missing_field', `${path}.tasks is required`);
    tasks = undefined;
  } else if (!Array.isArray(tasksRaw)) {
    addIssue(issues, `${path}.tasks`, 'wrong_type', `${path}.tasks must be an array`);
    tasks = undefined;
  } else {
    tasks = tasksRaw.map((item: unknown, index: number) => {
      const taskPath = `${path}.tasks[${index}]`;
      if (!isRecord(item)) {
        addIssue(issues, taskPath, 'wrong_type', `${taskPath} must be an object`);
        return undefined;
      }
      return parseTask(issues, item, taskPath);
    });
  }

  const itemsRaw: unknown = container['items'];
  let items: readonly (PhaseItemDraft | undefined)[] | undefined;
  if (itemsRaw === undefined) {
    items = undefined;
  } else if (!Array.isArray(itemsRaw)) {
    addIssue(issues, `${path}.items`, 'wrong_type', `${path}.items must be an array`);
    items = undefined;
  } else {
    items = itemsRaw.map((item: unknown, index: number) => {
      const itemPath = `${path}.items[${index}]`;
      if (!isRecord(item)) {
        addIssue(issues, itemPath, 'wrong_type', `${itemPath} must be an object`);
        return undefined;
      }
      return parsePhaseItem(issues, item, itemPath);
    });
  }

  return { id, name, blockedBySlots, tasks, items };
};

interface Cycle {
  readonly ids: readonly string[]; // closed walk: starts and ends on the same id
  readonly node: string; // id of the node whose outgoing edge closed the cycle
}

/**
 * Depth-first search over `edges`; every back-edge to a node still on the stack is one cycle,
 * reported with the ids of the walk so the message names everyone involved. Deterministic because
 * nodes are visited in insertion (roadmap) order and edges in declaration order.
 */
const findCycles = (edges: ReadonlyMap<string, readonly string[]>): readonly Cycle[] => {
  const cycles: Cycle[] = [];
  const state = new Map<string, 'visiting' | 'settled'>();
  const stack: string[] = [];
  const visit = (node: string): void => {
    state.set(node, 'visiting');
    stack.push(node);
    for (const next of edges.get(node) ?? []) {
      const nextState = state.get(next);
      if (nextState === undefined) {
        visit(next);
      } else if (nextState === 'visiting') {
        cycles.push({ ids: [...stack.slice(stack.indexOf(next)), next], node });
      }
    }
    stack.pop();
    state.set(node, 'settled');
  };
  for (const node of edges.keys()) {
    if (!state.has(node)) visit(node);
  }
  return cycles;
};

/** One node of a reference graph: `id` declares, `refs` are the ids it points at. */
interface RefNode {
  readonly id: string;
  readonly refs: readonly (string | undefined)[];
  readonly refPath: string;
}

// Undefined refs were already reported as invalid_slug / wrong_type during narrowing; only edges
// between declared ids enter the graph, so cycle messages always name real ids.
const buildAdjacency = (
  issues: RoadmapIssue[],
  nodes: readonly RefNode[],
  known: ReadonlySet<string>,
  unknownCode: RoadmapIssueCode,
  unknownWord: string,
): ReadonlyMap<string, readonly string[]> => {
  const edges = new Map<string, string[]>();
  for (const node of nodes) {
    if (!edges.has(node.id)) edges.set(node.id, []);
    node.refs.forEach((ref, index) => {
      if (ref === undefined) return;
      if (!known.has(ref)) {
        addIssue(issues, `${node.refPath}[${index}]`, unknownCode, `"${ref}" is not ${unknownWord} in this roadmap`);
        return;
      }
      edges.get(node.id)?.push(ref);
    });
  }
  return edges;
};

/**
 * Cross-graph deadlock: dependsOn edges and phase-block edges meet in one graph over tasks. An edge
 * T -> X is added for every task X of every phase T's phase is transitively blockedBy (the block can
 * span several blockedBy hops, so the closure of the phase graph is walked). A closed walk made
 * purely of dependsOn edges was already reported as task_cycle above and is skipped, so a task cycle
 * is never reported twice.
 */
const crossCycleCheck = (
  issues: RoadmapIssue[],
  phaseDrafts: readonly PhaseDraft[],
  phaseEdges: ReadonlyMap<string, readonly string[]>,
  taskEdges: ReadonlyMap<string, readonly string[]>,
  taskPathById: ReadonlyMap<string, string>,
): void => {
  const tasksOfPhase = new Map<string, readonly string[]>();
  const phaseOfTask = new Map<string, string>();
  phaseDrafts.forEach((draft) => {
    // Duplicate phase ids were already reported; the first declaration defines the phase here.
    if (draft.id === undefined || tasksOfPhase.has(draft.id)) return;
    const phaseId = draft.id;
    const declared: string[] = [];
    draft.tasks?.forEach((task) => {
      if (task === undefined || task.id === undefined || declared.includes(task.id)) return;
      declared.push(task.id);
      if (!phaseOfTask.has(task.id)) phaseOfTask.set(task.id, phaseId);
    });
    tasksOfPhase.set(phaseId, declared);
  });

  const closureCache = new Map<string, ReadonlySet<string>>();
  const blockedClosure = (phaseId: string): ReadonlySet<string> => {
    const cached = closureCache.get(phaseId);
    if (cached !== undefined) return cached;
    const reached = new Set<string>();
    const walk = (current: string): void => {
      for (const next of phaseEdges.get(current) ?? []) {
        if (reached.has(next)) continue;
        reached.add(next);
        walk(next);
      }
    };
    walk(phaseId);
    closureCache.set(phaseId, reached);
    return reached;
  };

  const depTargets = new Map<string, Set<string>>();
  const combinedEdges = new Map<string, string[]>();
  taskEdges.forEach((targets, from) => {
    combinedEdges.set(from, [...targets]);
    const pairs = depTargets.get(from) ?? new Set<string>();
    targets.forEach((to) => pairs.add(to));
    depTargets.set(from, pairs);
  });
  phaseOfTask.forEach((phaseId, task) => {
    const out = combinedEdges.get(task) ?? [];
    blockedClosure(phaseId).forEach((blocker) => {
      (tasksOfPhase.get(blocker) ?? []).forEach((target) => {
        if (out.includes(target)) return;
        out.push(target);
      });
    });
    combinedEdges.set(task, out);
  });

  const isDepStep = (from: string, to: string): boolean => depTargets.get(from)?.has(to) === true;
  for (const cycle of findCycles(combinedEdges)) {
    const steps = cycle.ids.slice(0, -1);
    const pureTaskCycle = steps.every((id, index) => {
      const next = cycle.ids[index + 1];
      return next !== undefined && isDepStep(id, next);
    });
    if (pureTaskCycle) continue;
    addIssue(
      issues,
      `${taskPathById.get(cycle.node)}`,
      'cross_cycle',
      `cross-graph deadlock: ${cycle.ids.join(' -> ')}`,
    );
  }
};

const crossCheck = (issues: RoadmapIssue[], phaseDrafts: readonly PhaseDraft[]): void => {
  const phaseIds = new Set<string>();
  const phasePathById = new Map<string, string>();
  const phaseNodes: RefNode[] = [];
  phaseDrafts.forEach((draft, index) => {
    if (draft.id === undefined) return;
    if (phaseIds.has(draft.id)) {
      addIssue(issues, `phases[${index}].id`, 'duplicate_id', `phases[${index}].id "${draft.id}" duplicates an earlier phase id`);
    } else {
      phaseIds.add(draft.id);
      phasePathById.set(draft.id, `phases[${index}]`);
    }
    phaseNodes.push({ id: draft.id, refs: draft.blockedBySlots ?? [], refPath: `phases[${index}].blockedBy` });
  });

  const taskIds = new Set<string>();
  const taskPathById = new Map<string, string>();
  const taskNodes: RefNode[] = [];
  phaseDrafts.forEach((phase, phaseIndex) => {
    phase.tasks?.forEach((task, taskIndex) => {
      if (task === undefined || task.id === undefined) return;
      const taskPath = `phases[${phaseIndex}].tasks[${taskIndex}]`;
      if (taskIds.has(task.id)) {
        addIssue(issues, `${taskPath}.id`, 'duplicate_id', `${taskPath}.id "${task.id}" duplicates an earlier task id`);
      } else {
        taskIds.add(task.id);
        taskPathById.set(task.id, taskPath);
      }
      taskNodes.push({ id: task.id, refs: task.dependsOnSlots ?? [], refPath: `${taskPath}.dependsOn` });
    });
  });

  const phaseEdges = buildAdjacency(issues, phaseNodes, phaseIds, 'unknown_phase', 'a phase');
  const phaseCycles = findCycles(phaseEdges);
  for (const cycle of phaseCycles) {
    addIssue(
      issues,
      `${phasePathById.get(cycle.node)}.blockedBy`,
      'phase_cycle',
      `phase dependency cycle: ${cycle.ids.join(' -> ')}`,
    );
  }

  const taskEdges = buildAdjacency(issues, taskNodes, taskIds, 'unknown_task', 'a task');
  const taskCycles = findCycles(taskEdges);
  for (const cycle of taskCycles) {
    addIssue(
      issues,
      `${taskPathById.get(cycle.node)}.dependsOn`,
      'task_cycle',
      `task dependency cycle: ${cycle.ids.join(' -> ')}`,
    );
  }

  // A phase cycle makes every involved phase block itself, which would surface as noise here; the
  // phase cycle is the root cause and is already reported on its own.
  if (phaseCycles.length === 0) crossCycleCheck(issues, phaseDrafts, phaseEdges, taskEdges, taskPathById);
};

const buildPhaseItem = (draft: PhaseItemDraft): PhaseItem | undefined => {
  if (draft.kind === 'manual') {
    if (draft.manualId === undefined || draft.manualTitle === undefined || draft.manualDone === undefined) return undefined;
    return { kind: 'manual', id: draft.manualId, title: draft.manualTitle, done: draft.manualDone };
  }
  if (draft.kind === 'repo_item') {
    if (draft.refRepo === undefined || draft.refKind === undefined || draft.refId === undefined) return undefined;
    return {
      kind: 'repo_item',
      ref: { repo: draft.refRepo, kind: draft.refKind, id: draft.refId },
    };
  }
  return undefined;
};

const buildTask = (
  draft: TaskDraft,
  defaultTargets: readonly RepoSlug[],
  issues: RoadmapIssue[],
  path: string,
  multiRepo: boolean,
): TaskDef | undefined => {
  if (draft.id === undefined || draft.title === undefined || draft.acceptance === undefined || draft.dependsOnSlots === undefined) {
    return undefined;
  }
  const dependsOn = draft.dependsOnSlots.filter((slot): slot is TaskSlug => slot !== undefined);
  const written = draft.targetSlots === undefined ? [] : draft.targetSlots.filter((slot): slot is RepoSlug => slot !== undefined);
  let targets: readonly RepoSlug[];
  if (written.length > 0) {
    targets = written;
  } else if (defaultTargets.length === 1) {
    targets = defaultTargets;
  } else if (multiRepo) {
    addIssue(issues, `${path}.targets`, 'target_required', `${path}.targets is required when the project lists more than one repo`);
    return undefined;
  } else {
    targets = [];
  }
  return {
    id: draft.id,
    title: draft.title,
    dependsOn,
    acceptance: draft.acceptance,
    targets,
  };
};

const buildPhase = (draft: PhaseDraft, defaultTargets: readonly RepoSlug[], issues: RoadmapIssue[], phasePath: string, multiRepo: boolean): PhaseDef | undefined => {
  if (draft.id === undefined || draft.name === undefined || draft.tasks === undefined || draft.blockedBySlots === undefined) {
    return undefined;
  }
  const tasks: TaskDef[] = [];
  draft.tasks.forEach((task, index) => {
    if (task === undefined) return;
    const built = buildTask(task, defaultTargets, issues, `${phasePath}.tasks[${index}]`, multiRepo);
    if (built !== undefined) tasks.push(built);
  });
  const blockedBy = draft.blockedBySlots.filter((slot): slot is PhaseSlug => slot !== undefined);
  const builtItems: PhaseItem[] = [];
  draft.items?.forEach((item) => {
    if (item === undefined) return;
    const built = buildPhaseItem(item);
    if (built !== undefined) builtItems.push(built);
  });
  const phase: PhaseDef = { id: draft.id, name: draft.name, blockedBy, tasks };
  return builtItems.length > 0 ? { ...phase, items: builtItems } : phase;
};

/** Validates untyped input (parsed YAML/JSON). All-or-nothing: any issue → err with ALL issues.
 *  With a project, every written target must be one of its repos (R-47). */
export function validateRoadmap(input: unknown, project?: ProjectDef): Result<Roadmap, readonly RoadmapIssue[]> {
  const issues: RoadmapIssue[] = [];

  if (!isRecord(input)) {
    return err([{ path: '', code: 'wrong_type', message: 'roadmap must be an object' }]);
  }

  const phasesRaw: unknown = input['phases'];
  let phaseDrafts: readonly PhaseDraft[];
  if (phasesRaw === undefined) {
    addIssue(issues, 'phases', 'missing_field', 'phases is required');
    phaseDrafts = [];
  } else if (!Array.isArray(phasesRaw)) {
    addIssue(issues, 'phases', 'wrong_type', 'phases must be an array');
    phaseDrafts = [];
  } else {
    phaseDrafts = phasesRaw.map((item: unknown, index: number) => {
      const path = `phases[${index}]`;
      if (!isRecord(item)) {
        addIssue(issues, path, 'wrong_type', `${path} must be an object`);
        return { id: undefined, name: undefined, blockedBySlots: undefined, tasks: undefined, items: undefined };
      }
      return parsePhase(issues, item, path);
    });
  }

  crossCheck(issues, phaseDrafts);

  if (project !== undefined) {
    const knownRepos = new Set<string>(project.repos);
    phaseDrafts.forEach((phase, phaseIndex) => {
      phase.tasks?.forEach((task, taskIndex) => {
        if (task === undefined || task.targetSlots === undefined) return;
        task.targetSlots.forEach((slot, slotIndex) => {
          if (slot === undefined || knownRepos.has(slot)) return;
          addIssue(
            issues,
            `phases[${phaseIndex}].tasks[${taskIndex}].targets[${slotIndex}]`,
            'unknown_repo',
            `"${slot}" is not a repo of project "${project.id}"`,
          );
        });
      });
      phase.items?.forEach((item, itemIndex) => {
        if (item === undefined || item.kind !== 'repo_item' || item.refRepo === undefined) return;
        if (knownRepos.has(item.refRepo)) return;
        addIssue(
          issues,
          `phases[${phaseIndex}].items[${itemIndex}].ref.repo`,
          'unknown_repo',
          `"${item.refRepo}" is not a repo of project "${project.id}"`,
        );
      });
    });
  }

  const onlyRepo = project === undefined || project.repos.length !== 1 ? undefined : project.repos[0];
  const defaultTargets: readonly RepoSlug[] = onlyRepo === undefined ? [] : [onlyRepo];
  const multiRepo = project !== undefined && project.repos.length > 1;

  if (multiRepo) {
    phaseDrafts.forEach((phase, phaseIndex) => {
      phase.tasks?.forEach((task, taskIndex) => {
        if (task === undefined) return;
        const written = task.targetSlots === undefined ? [] : task.targetSlots.filter((slot): slot is RepoSlug => slot !== undefined);
        if (written.length === 0) {
          addIssue(
            issues,
            `phases[${phaseIndex}].tasks[${taskIndex}].targets`,
            'target_required',
            `phases[${phaseIndex}].tasks[${taskIndex}].targets is required when the project lists more than one repo`,
          );
        }
      });
    });
  }

  if (issues.length > 0) return err(issues);

  const phases: PhaseDef[] = [];
  phaseDrafts.forEach((draft, phaseIndex) => {
    const built = buildPhase(draft, defaultTargets, issues, `phases[${phaseIndex}]`, multiRepo);
    if (built !== undefined) phases.push(built);
  });
  if (issues.length > 0) return err(issues);
  return ok({ phases });
}

/** R-136: narrows a repo roadmap document for one repo. */
export function validateRepoRoadmap(input: unknown, repo: RepoSlug): Result<RepoRoadmap, readonly RoadmapIssue[]> {
  const issues: RoadmapIssue[] = [];
  if (!isRecord(input)) {
    return err([{ path: '', code: 'wrong_type', message: 'repo roadmap must be an object' }]);
  }

  const milestonesRaw: unknown = input['milestones'];
  const issuesRaw: unknown = input['issues'];
  let milestoneDrafts: readonly (UnknownRecord | undefined)[] = [];
  let issueDrafts: readonly (UnknownRecord | undefined)[] = [];

  if (milestonesRaw === undefined) {
    addIssue(issues, 'milestones', 'missing_field', 'milestones is required');
  } else if (!Array.isArray(milestonesRaw)) {
    addIssue(issues, 'milestones', 'wrong_type', 'milestones must be an array');
  } else {
    milestoneDrafts = milestonesRaw.map((item: unknown, index: number) => {
      const path = `milestones[${index}]`;
      if (!isRecord(item)) {
        addIssue(issues, path, 'wrong_type', `${path} must be an object`);
        return undefined;
      }
      return item;
    });
  }

  if (issuesRaw === undefined) {
    addIssue(issues, 'issues', 'missing_field', 'issues is required');
  } else if (!Array.isArray(issuesRaw)) {
    addIssue(issues, 'issues', 'wrong_type', 'issues must be an array');
  } else {
    issueDrafts = issuesRaw.map((item: unknown, index: number) => {
      const path = `issues[${index}]`;
      if (!isRecord(item)) {
        addIssue(issues, path, 'wrong_type', `${path} must be an object`);
        return undefined;
      }
      return item;
    });
  }

  const milestoneIds = new Set<string>();
  const builtMilestones: RepoMilestone[] = [];
  milestoneDrafts.forEach((row, index) => {
    if (row === undefined) return;
    const path = `milestones[${index}]`;
    const id = readStringField(issues, row, 'id', `${path}.id`);
    const title = readStringField(issues, row, 'title', `${path}.title`);
    const stateRaw = readStringField(issues, row, 'state', `${path}.state`);
    const state = stateRaw === 'open' || stateRaw === 'closed' ? stateRaw : undefined;
    if (stateRaw !== undefined && state === undefined) {
      addIssue(issues, `${path}.state`, 'wrong_type', `${path}.state must be "open" or "closed"`);
    }
    const sourceRaw: unknown = row['source'];
    let source: IssueSource | undefined;
    if (!isRecord(sourceRaw)) {
      addIssue(issues, `${path}.source`, 'missing_field', `${path}.source is required`);
    } else {
      source = parseIssueSource(issues, sourceRaw, `${path}.source`);
    }
    const dueAtRaw: unknown = row['dueAt'];
    let dueAt: number | undefined;
    if (dueAtRaw !== undefined) {
      if (typeof dueAtRaw !== 'number') {
        addIssue(issues, `${path}.dueAt`, 'wrong_type', `${path}.dueAt must be a number`);
      } else {
        dueAt = dueAtRaw;
      }
    }
    if (id === undefined || title === undefined || state === undefined || source === undefined) return;
    if (milestoneIds.has(id)) {
      addIssue(issues, `${path}.id`, 'duplicate_id', `${path}.id "${id}" duplicates an earlier milestone id`);
      return;
    }
    milestoneIds.add(id);
    builtMilestones.push(dueAt === undefined ? { id, title, state, source } : { id, title, state, source, dueAt });
  });

  const issueIds = new Set<string>();
  const builtIssues: RepoIssue[] = [];
  const issueParents = new Map<string, string | undefined>();

  issueDrafts.forEach((row, index) => {
    if (row === undefined) return;
    const path = `issues[${index}]`;
    const id = readStringField(issues, row, 'id', `${path}.id`);
    const title = readStringField(issues, row, 'title', `${path}.title`);
    const stateRaw = readStringField(issues, row, 'state', `${path}.state`);
    const state = stateRaw === 'open' || stateRaw === 'closed' ? stateRaw : undefined;
    if (stateRaw !== undefined && state === undefined) {
      addIssue(issues, `${path}.state`, 'wrong_type', `${path}.state must be "open" or "closed"`);
    }
    const sourceRaw: unknown = row['source'];
    let source: IssueSource | undefined;
    if (!isRecord(sourceRaw)) {
      addIssue(issues, `${path}.source`, 'missing_field', `${path}.source is required`);
    } else {
      source = parseIssueSource(issues, sourceRaw, `${path}.source`);
    }
    const labelsRaw: unknown = row['labels'];
    let labels: readonly string[] | undefined;
    if (labelsRaw === undefined) {
      addIssue(issues, `${path}.labels`, 'missing_field', `${path}.labels is required`);
    } else {
      labels = readStringArrayField(issues, row, 'labels', `${path}.labels`);
    }
    const milestoneRaw: unknown = row['milestone'];
    let milestone: string | undefined;
    if (milestoneRaw !== undefined) {
      if (typeof milestoneRaw !== 'string') {
        addIssue(issues, `${path}.milestone`, 'wrong_type', `${path}.milestone must be a string`);
      } else {
        milestone = milestoneRaw;
      }
    }
    const parentRaw: unknown = row['parent'];
    let parent: string | undefined;
    if (parentRaw !== undefined) {
      if (typeof parentRaw !== 'string') {
        addIssue(issues, `${path}.parent`, 'wrong_type', `${path}.parent must be a string`);
      } else {
        parent = parentRaw;
      }
    }
    const bodyRaw: unknown = row['body'];
    let body: string | undefined;
    if (bodyRaw !== undefined && typeof bodyRaw !== 'string') {
      addIssue(issues, `${path}.body`, 'wrong_type', `${path}.body must be a string`);
    } else if (typeof bodyRaw === 'string') {
      body = bodyRaw;
    }
    if (id === undefined || title === undefined || state === undefined || source === undefined || labels === undefined) return;
    if (issueIds.has(id)) {
      addIssue(issues, `${path}.id`, 'duplicate_id', `${path}.id "${id}" duplicates an earlier issue id`);
      return;
    }
    issueIds.add(id);
    issueParents.set(id, parent);
    if (parent !== undefined && source.kind !== 'local') {
      addIssue(issues, `${path}.source`, 'wrong_type', 'a subtask must have source.kind === "local"');
    }
    const built: RepoIssue = {
      id,
      title,
      state: state as 'open' | 'closed',
      labels,
      source,
      ...(body === undefined ? {} : { body }),
      ...(milestone === undefined ? {} : { milestone }),
      ...(parent === undefined ? {} : { parent }),
    };
    builtIssues.push(built);
  });

  builtIssues.forEach((issue, index) => {
    const path = `issues[${index}]`;
    if (issue.milestone !== undefined && !milestoneIds.has(issue.milestone)) {
      addIssue(issues, `${path}.milestone`, 'unknown_phase', `"${issue.milestone}" is not a milestone in this repo roadmap`);
    }
    if (issue.parent !== undefined) {
      if (!issueIds.has(issue.parent)) {
        addIssue(issues, `${path}.parent`, 'unknown_task', `"${issue.parent}" is not an issue in this repo roadmap`);
      } else {
        const parentIssue = builtIssues.find((entry) => entry.id === issue.parent);
        if (parentIssue?.parent !== undefined) {
          addIssue(issues, `${path}.parent`, 'wrong_type', 'issue nesting is limited to one level');
        }
      }
    }
  });

  if (issues.length > 0) return err(issues);
  return ok({ repo, milestones: builtMilestones, issues: builtIssues });
}
