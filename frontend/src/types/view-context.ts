export type ViewSnapshot = {
  capturedAt: string;
  title: string;
  text: string;
  controls: { label: string; value: string }[];
  visuals: { title: string; labels: string[]; image?: string }[];
  sources: { name: string; data: unknown }[];
  limitations: string[];
};
export type ChatViewContext = {
  path: string;
  view: string;
  entity: string | null;
  content?: ViewSnapshot;
};
