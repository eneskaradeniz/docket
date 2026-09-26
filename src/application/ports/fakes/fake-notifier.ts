// In-memory Notifier — notifications collected for assertions.
import type { Notifier } from '../notifier';

export interface FakeNotifier extends Notifier {
  /** Every notification, in call order. */
  notifications(): readonly { readonly title: string; readonly body: string }[];
}

export const createFakeNotifier = (): FakeNotifier => {
  const sent: { readonly title: string; readonly body: string }[] = [];
  return {
    notify: (title: string, body: string): void => {
      sent.push({ title, body });
    },
    notifications: (): readonly { readonly title: string; readonly body: string }[] => [...sent],
  };
};
