// User-facing notification port (toast/OS notification), kept out of use cases.
export interface Notifier {
  notify(title: string, body: string): void;
}
