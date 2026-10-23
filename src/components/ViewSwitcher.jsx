import { useTranslation } from "react-i18next";

const formatBind = (bind) => (bind?.keys?.length ? bind.keys.join("+") : "");

// the views as buttons for whichever toolbar is already on screen. the active one gets the pressed look
export default function ViewSwitcher({ viewMode, views, onChange, keybinds = {} }) {
  const { t } = useTranslation("timeline");
  if (!views || views.length < 2) return null;
  // spelled out so the parser sees every label
  const labels = {
    timeline: t("toolbar.timelineView", "Timeline View"),
    map: t("toolbar.mapView", "Map View"),
    spreadsheet: t("toolbar.spreadsheetView", "Spreadsheet view"),
    calendar: t("toolbar.calendarView", "Calendar view"),
  };
  const binds = {
    timeline: keybinds.viewTimeline,
    map: keybinds.viewMap,
    spreadsheet: keybinds.viewSpreadsheet,
    calendar: keybinds.viewCalendar,
  };
  return views.map((view) => {
    const ViewIcon = view.icon;
    const label = labels[view.id];
    const bind = formatBind(binds[view.id]);
    const isActive = viewMode === view.id;
    return (
      <button
        key={view.id}
        type="button"
        className={`timeline-canvas-button${isActive ? " timeline-canvas-button-active" : ""}`}
        aria-label={label}
        aria-pressed={isActive}
        data-tooltip={bind ? `${label} (${bind})` : label}
        onClick={() => onChange(view.id)}
      >
        <ViewIcon size={16} />
      </button>
    );
  });
}
