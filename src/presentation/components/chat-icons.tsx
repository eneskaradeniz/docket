// components/chat-icons.tsx — the chat's small line icons, drawn from the approved prototype's own
// paths. Every icon is decorative (`aria-hidden`): the control that carries it names itself.
export type ChatIconName =
  | 'spark'
  | 'close'
  | 'history'
  | 'plus'
  | 'send'
  | 'stop'
  | 'chevron'
  | 'global'
  | 'project'
  | 'workOrder'
  | 'page'
  | 'file'
  | 'repo'
  | 'pin'
  | 'trash'
  | 'mention';

const PATHS: Readonly<Record<ChatIconName, string>> = {
  spark: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3zM18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z',
  close: 'M6 6l12 12M18 6L6 18',
  history: 'M8 2.25a5.75 5.75 0 100 11.5 5.75 5.75 0 000-11.5zM8 4.75V8l2.25 1.5',
  plus: 'M8 3v10M3 8h10',
  send: 'M8 13V3M3.5 7.5L8 3l4.5 4.5',
  stop: 'M4.5 4.5h7v7h-7z',
  chevron: 'M2 3.5l3 3 3-3',
  global: 'M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11',
  project: 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z',
  workOrder: 'M4.5 2.5h7a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5h-7A1.5 1.5 0 013 12V4a1.5 1.5 0 011.5-1.5zM5.5 6h5M5.5 8.5h5M5.5 11h3',
  page: 'M4 2.5h8a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 12V4A1.5 1.5 0 014 2.5zM2.5 6h11',
  file: 'M4 2.5h5l3 3v8H4zM9 2.5v3h3',
  repo: 'M3 3.5a1.5 1.5 0 011.5-1.5h7v10h-7A1.5 1.5 0 003 13.5v-10zM3 13.5A1.5 1.5 0 004.5 15h7',
  pin: 'M8 2.5l2.5 3.5 3-1-1 4-3 1.5V14L8 12l-1.5 2v-3.5l-3-1.5-1-4 3 1z',
  trash: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8',
  mention: 'M8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM10.5 8v1a2 2 0 004 0V8a6.5 6.5 0 10-2.5 5.1',
};

const VIEWBOX: Readonly<Partial<Record<ChatIconName, string>>> = { spark: '0 0 24 24', close: '0 0 24 24', chevron: '0 0 10 10' };

export function ChatIcon({ name, className }: { readonly name: ChatIconName; readonly className: string }) {
  const filled = name === 'stop';
  return (
    <svg
      aria-hidden="true"
      viewBox={VIEWBOX[name] ?? '0 0 16 16'}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={name === 'spark' ? 1.6 : 1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The scope icon of a scope kind. */
export const scopeIcon = (kind: 'global' | 'project' | 'workOrder'): ChatIconName => (kind === 'global' ? 'global' : kind === 'project' ? 'project' : 'workOrder');

/** The icon of a reference chip kind. */
export const refIcon = (kind: 'workOrder' | 'page' | 'project' | 'repo' | 'file'): ChatIconName =>
  kind === 'workOrder' ? 'workOrder' : kind === 'page' ? 'page' : kind === 'project' ? 'project' : kind === 'repo' ? 'repo' : 'file';
