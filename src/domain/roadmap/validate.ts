// roadmap/validate.ts — narrows untyped (parsed roadmap YAML/JSON) input into a typed Roadmap.
// Field-by-field narrowing plus cross-reference and cycle checks; every issue is collected before
// deciding (all-or-nothing), so one run reports a task cycle, a phase cycle, and the deadlocks that
// only appear when both graphs are combined.
import { err, ok, parseSlug, type PhaseSlug, type Result, type Slug, type TaskSlug } from '../shared';
import type { PhaseDef, Roadmap, RoadmapIssue, RoadmapIssueCode, TaskDef } from './types';

type UnknownRecord = Readonly<Record<string, unknown>>;

// Drafts survive partial failure (fields stay undefined) so cross-reference checks still see the
// ids that did parse, instead of cascading into phantom "unknown" references.
interface TaskDraft {
  readonly id: TaskSlug | undefined;
  readonly title: string | undefined;
  readonly dependsOnSlots: readonly (TaskSlug | undefined)[] | undefined;
  readonly acceptance: readonly string[] | undefined;
  readonly repo: string | undefined;
}

interface PhaseDraft {
  readonly id: PhaseSlug | undefined;
  readonly name: string | undefined;
  readonly blockedBySlots: readonly (PhaseSlug | undefined)[] | undefined;
  readonly tasks: readonly (TaskDraft | undefined)[] | undefined;
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

const readOptionalStringField = (issues: RoadmapIssue[], container: UnknownRecord, field: string, path: string): string | undefined => {
  const value: unknown = container[field];
  if (value === undefined) return undefined;
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

const parseTask = (issues: RoadmapIssue[], container: UnknownRecord, path: string): TaskDraft => ({
  id: readSlugField<'task'>(issues, container, 'id', `${path}.id`),
  title: readStringField(issues, container, 'title', `${path}.title`),
  dependsOnSlots: readSlugSlots<'task'>(issues, container['dependsOn'], `${path}.dependsOn`),
  acceptance: readStringArrayField(issues, container, 'acceptance', `${path}.acceptance`),
  repo: readOptionalStringField(issues, container, 'repo', `${path}.repo`),
});

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

  return { id, name, blockedBySlots, tasks };
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

  crossCycleCheck(issues, phaseDrafts, phaseEdges, taskEdges, taskPathById);
};

const buildTask = (draft: TaskDraft): TaskDef | undefined => {
  if (draft.id === undefined || draft.title === undefined || draft.acceptance === undefined || draft.dependsOnSlots === undefined) {
    return undefined;
  }
  const dependsOn = draft.dependsOnSlots.filter((slot): slot is TaskSlug => slot !== undefined);
  return draft.repo === undefined
    ? { id: draft.id, title: draft.title, dependsOn, acceptance: draft.acceptance }
    : { id: draft.id, title: draft.title, dependsOn, acceptance: draft.acceptance, repo: draft.repo };
};

const buildPhase = (draft: PhaseDraft): PhaseDef | undefined => {
  if (draft.id === undefined || draft.name === undefined || draft.tasks === undefined || draft.blockedBySlots === undefined) {
    return undefined;
  }
  const tasks: TaskDef[] = [];
  for (const task of draft.tasks) {
    if (task === undefined) return undefined;
    const built = buildTask(task);
    if (built === undefined) return undefined;
    tasks.push(built);
  }
  const blockedBy = draft.blockedBySlots.filter((slot): slot is PhaseSlug => slot !== undefined);
  return { id: draft.id, name: draft.name, blockedBy, tasks };
};

/** Validates untyped input (parsed YAML/JSON). All-or-nothing: any issue → err with ALL issues. */
export function validateRoadmap(input: unknown): Result<Roadmap, readonly RoadmapIssue[]> {
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
        return { id: undefined, name: undefined, blockedBySlots: undefined, tasks: undefined };
      }
      return parsePhase(issues, item, path);
    });
  }

  crossCheck(issues, phaseDrafts);

  if (issues.length > 0) return err(issues);

  // With zero issues every draft parsed completely, so the builders never drop an entry here.
  const phases: PhaseDef[] = [];
  for (const draft of phaseDrafts) {
    const built = buildPhase(draft);
    if (built !== undefined) phases.push(built);
  }
  return ok({ phases });
}
