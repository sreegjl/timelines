import { sampleData } from "../data/sampleData";

export function useTimelineData() {
  const { file, elements } = sampleData;
  const events = elements.filter(e => e.type === "event");
  const spans = elements.filter(e => e.type === "span");
  const eras  = elements.filter(e => e.type === "era");
  return { file, events, spans, eras };
}
