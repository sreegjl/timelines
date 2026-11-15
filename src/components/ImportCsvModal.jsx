import { ArrowLeft } from "lucide-react";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { getActiveDateFormat, displayDateLabel } from "../utils/dateUtils";
import { parseCsv, guessMapping, buildTimelineFromRows, IMPORT_FIELDS } from "../utils/csvImport";
import useEscapeKey from "../hooks/useEscapeKey";
import "../styles/07-modals-menus.css";

const PREVIEW_ROWS = 8;
const SKIPPED_SHOWN = 5;

const sanitizeFilename = (name) =>
  name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

export default function ImportCsvModal({ text, fileName, onClose, onCreate }) {
  const { t } = useTranslation(["app", "timeline", "common"]);

  // Same labels as the spreadsheet columns, so the app's own exports map themselves
  const fieldLabels = useMemo(() => ({
    title: t("timeline:columns.title", "Title"),
    date: t("timeline:columns.date", "Date / Start"),
    end: t("timeline:columns.end", "End"),
    description: t("timeline:columns.description", "Description"),
    group: t("timeline:columns.group", "Group"),
    tags: t("timeline:columns.tags", "Tags"),
    color: t("timeline:columns.color", "Color"),
  }), [t]);

  const { headers, rows } = useMemo(() => parseCsv(text), [text]);
  const [title, setTitle] = useState(() => String(fileName || "").replace(/\.(csv|tsv)$/i, ""));
  const [mapping, setMapping] = useState(() => guessMapping(headers, fieldLabels));
  const [dateFormat, setDateFormat] = useState(() => (getActiveDateFormat() === "DMY" ? "DMY" : "MDY"));
  const [useSpreadsheet, setUseSpreadsheet] = useState(true);
  const [validationErrors, setValidationErrors] = useState([]);
  const [creating, setCreating] = useState(false);

  useEscapeKey(true, onClose);

  const result = useMemo(
    () => buildTimelineFromRows(rows, mapping, { dateFormat }),
    [rows, mapping, dateFormat]
  );

  const samples = useMemo(
    () => headers.map((_, i) => rows.find((r) => r[i]?.trim())?.[i]?.trim() ?? ""),
    [headers, rows]
  );

  const counts = useMemo(() => {
    const c = { event: 0, span: 0 };
    result.elements.forEach((el) => { c[el.type] += 1; });
    return c;
  }, [result.elements]);

  const hasTitle = mapping.includes("title");
  const hasDate = mapping.includes("date");

  const setColumnField = (index, field) => {
    setMapping((prev) => prev.map((f, i) => {
      if (i === index) return field;
      return field && f === field ? "" : f; // a field maps from one column only
    }));
    if (validationErrors.length) setValidationErrors([]);
  };

  const skipReason = (reason) => reason === "noTitle"
    ? t("importCsv.skipReason.noTitle", "no title")
    : t("importCsv.skipReason.noDate", "no readable date");

  const formatDate = (label, value) => displayDateLabel(label) || String(value);

  const handleCreate = async () => {
    const errors = [];
    if (!title.trim()) errors.push(t("newTimeline.errors.nameRequired", "Please enter a timeline name."));
    else if (!sanitizeFilename(title)) errors.push(t("newTimeline.errors.nameAlphanumeric", "Timeline name must contain at least one letter or number."));
    if (!result.elements.length) errors.push(t("importCsv.errors.nothingToImport", "No rows can be imported. Map a title and a date column."));
    if (errors.length) { setValidationErrors(errors); return; }

    setCreating(true);
    const response = await onCreate({
      title: title.trim(),
      start: result.start,
      end: result.end,
      detailLevel: 1,
      useSpreadsheet,
      useCalendar: result.useCalendar,
      elements: result.elements,
      groups: result.groups,
    });
    setCreating(false);
    if (response?.error) setValidationErrors([response.error]);
  };

  return (
    <div className="settings-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-modal csv-import-modal">
        <div className="settings-header">
          <button className="settings-back-button" onClick={onClose} aria-label={t("common:actions.close", "Close")}>
            <ArrowLeft size={20} strokeWidth={2} />
          </button>
          <h2 className="settings-title">{t("importCsv.title", "IMPORT CSV")}</h2>
        </div>

        {validationErrors.length > 0 && (
          <div className="settings-errors">
            {validationErrors.map((error, index) => (
              <div key={index} className="settings-error">{error}</div>
            ))}
          </div>
        )}

        <div className="settings-content">
          {!headers.length ? (
            <div className="settings-form-note">{t("importCsv.empty", "This file has no rows to import.")}</div>
          ) : (
            <>
              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">{t("newTimeline.name.label", "Timeline Name")}</div>
                  <div className="settings-row-description">{t("newTimeline.name.description", "Your file will be saved as: {{filename}}.timeline", { filename: title ? title.toLowerCase().replace(/\s+/g, "-") : "untitled" })}</div>
                </div>
                <div className="settings-row-right">
                  <input
                    type="text"
                    className="settings-input"
                    value={title}
                    onChange={(e) => { setTitle(e.target.value); if (validationErrors.length) setValidationErrors([]); }}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleCreate(); } }}
                    placeholder={t("newTimeline.name.placeholder", "Enter timeline name")}
                    autoFocus
                    maxLength={100}
                  />
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">{t("importCsv.dateFormat.label", "Date Order")}</div>
                  <div className="settings-row-description">{t("importCsv.dateFormat.description", "How to read dates like 03/04/2024. Plain years and YYYY-MM-DD dates are always understood.")}</div>
                </div>
                <div className="settings-row-right">
                  <select className="settings-select" value={dateFormat} onChange={(e) => setDateFormat(e.target.value)}>
                    <option value="MDY">{t("importCsv.dateFormat.mdy", "Month / Day / Year")}</option>
                    <option value="DMY">{t("importCsv.dateFormat.dmy", "Day / Month / Year")}</option>
                  </select>
                </div>
              </div>

              <div className="settings-row">
                <div className="settings-row-left">
                  <div className="settings-row-label">{t("newTimeline.spreadsheet.label", "Spreadsheet View")}</div>
                  <div className="settings-row-description">{t("newTimeline.spreadsheet.description", "Enable a spreadsheet view for bulk editing elements.")}</div>
                </div>
                <div className="settings-row-right">
                  <label className="settings-toggle">
                    <input type="checkbox" checked={useSpreadsheet} onChange={(e) => setUseSpreadsheet(e.target.checked)} />
                    <span className="settings-toggle-slider"></span>
                  </label>
                </div>
              </div>

              <div className="csv-import-section">
                <div className="settings-row-label">{t("importCsv.columns.label", "Columns")}</div>
                <div className="settings-row-description">
                  {t("importCsv.columns.description", "Choose what each column becomes. A title and a date are required. Rows with an end date become spans, the rest become events.")}
                </div>
                <table className="csv-import-table">
                  <thead>
                    <tr>
                      <th>{t("importCsv.columns.csvColumn", "CSV column")}</th>
                      <th>{t("importCsv.columns.example", "Example")}</th>
                      <th>{t("importCsv.columns.importAs", "Import as")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {headers.map((header, i) => (
                      <tr key={i} className={mapping[i] ? undefined : "csv-import-row-ignored"}>
                        <td className="csv-import-header">{header || t("importCsv.columns.unnamed", "(unnamed)")}</td>
                        <td className="csv-import-sample" title={samples[i]}>{samples[i]}</td>
                        <td>
                          <select className="settings-select csv-import-select" value={mapping[i]} onChange={(e) => setColumnField(i, e.target.value)}>
                            <option value="">{t("importCsv.columns.ignore", "Don't import")}</option>
                            {IMPORT_FIELDS.map((field) => (
                              <option key={field} value={field}>{fieldLabels[field]}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {(!hasTitle || !hasDate) && (
                  <div className="csv-import-warning">
                    {!hasTitle
                      ? t("importCsv.missingTitle", "Pick which column holds the title.")
                      : t("importCsv.missingDate", "Pick which column holds the date or start date.")}
                  </div>
                )}
              </div>

              <div className="csv-import-section">
                <div className="settings-row-label">{t("importCsv.preview.label", "Preview")}</div>
                <div className="settings-row-description">
                  {t("importCsv.preview.summary", {
                    count: result.elements.length,
                    events: counts.event,
                    spans: counts.span,
                    defaultValue_one: "{{count}} element ({{events}} events, {{spans}} spans)",
                    defaultValue_other: "{{count}} elements ({{events}} events, {{spans}} spans)",
                  })}
                  {result.elements.length > 0 && ` · ${formatDate(null, result.start)} – ${formatDate(null, result.end)}`}
                </div>
                {result.skipped.length > 0 && (
                  <div className="csv-import-warning">
                    {t("importCsv.preview.skipped", {
                      count: result.skipped.length,
                      defaultValue_one: "{{count}} row will be skipped:",
                      defaultValue_other: "{{count}} rows will be skipped:",
                    })}{" "}
                    {result.skipped.slice(0, SKIPPED_SHOWN).map((s) =>
                      t("importCsv.preview.skippedRow", "row {{row}} ({{reason}})", { row: s.row, reason: skipReason(s.reason) })
                    ).join(", ")}
                    {result.skipped.length > SKIPPED_SHOWN && ", …"}
                  </div>
                )}
                {result.elements.length > 0 && (
                  <table className="csv-import-table">
                    <thead>
                      <tr>
                        <th>{t("timeline:columns.type", "Type")}</th>
                        <th>{fieldLabels.title}</th>
                        <th>{fieldLabels.date}</th>
                        <th>{fieldLabels.end}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.elements.slice(0, PREVIEW_ROWS).map((el) => (
                        <tr key={el.id}>
                          <td>{t(`timeline:elementTypes.${el.type}`)}</td>
                          <td>{el.title}</td>
                          <td>{el.type === "event" ? formatDate(el.dateLabel, el.date) : formatDate(el.startLabel, el.start)}</td>
                          <td>{el.type === "event" ? "" : formatDate(el.endLabel, el.end)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>

        <div className="settings-footer">
          <button className="settings-footer-button settings-cancel-button" onClick={onClose}>
            {t("common:actions.cancel", "Cancel")}
          </button>
          <button
            className="settings-footer-button settings-create-button"
            onClick={handleCreate}
            disabled={creating || !result.elements.length}
          >
            {t("importCsv.create", "Create Timeline")}
          </button>
        </div>
      </div>
    </div>
  );
}
