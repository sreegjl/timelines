import { GanttChartSquare, Map as MapIcon, Table2, CalendarDays } from "lucide-react";

export const VIEW_DEFS = [
  { id: "timeline", icon: GanttChartSquare },
  { id: "map", icon: MapIcon },
  { id: "spreadsheet", icon: Table2 },
  { id: "calendar", icon: CalendarDays },
];

// which views a timeline is allowed to wear, based on its settings
export function getAvailableViews(file) {
  return VIEW_DEFS.filter((view) => {
    if (view.id === "map") return file?.useMaps === true;
    if (view.id === "spreadsheet") return file?.useSpreadsheet === true;
    if (view.id === "calendar") return file?.useCalendar === true;
    return true;
  });
}
