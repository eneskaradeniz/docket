import type { BoardColumn as ColumnId, WorkOrderCardView } from '../../../core/types';
import { BoardColumn } from './BoardColumn';

const COLUMNS: ColumnId[] = ['your_turn', 'running', 'external'];

export function Board({
  cards,
  onSelect,
}: {
  cards: WorkOrderCardView[];
  onSelect: (id: WorkOrderCardView['id']) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {COLUMNS.map((col) => (
        <BoardColumn
          key={col}
          column={col}
          cards={cards.filter((c) => c.column === col)}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
