import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Plus, Bookmark, Trash2 } from "lucide-react";
import {
  STARTER_PRESETS,
  applyPreset,
  createPresetFromElement,
  normalizeProperties,
} from "../utils/presets";

const toRows = (properties) =>
  (Array.isArray(properties) ? properties : []).map((p) => ({ key: p?.key ?? "", value: p?.value ?? "" }));

// read-only flavor. empty values stay hidden, nobody wants to read "role: ___"
export function PropertiesView({ element }) {
  const rows = normalizeProperties(element?.properties).filter((p) => String(p.value).trim() !== "");
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((p) => (
        <div key={p.key} className="view-group view-group-property">
          <label title={p.key}>{p.key}</label>
          <div className="view-separator" />
          <p>{p.value}</p>
        </div>
      ))}
    </>
  );
}

export function PresetBadge({ element, presets }) {
  const preset = (presets || []).find((p) => p.id === element?.preset);
  if (!preset) return null;
  return (
    <span className="rp-preset-badge" style={preset.color ? { "--preset-color": preset.color } : undefined}>
      {preset.name}
    </span>
  );
}

// the edit flavor: pick a preset, fiddle with key/value pairs, save the look for later
export default function PropertiesEditor({ element, presets = [], propertyKeys = [], onCommit, onUpdatePresets }) {
  const { t } = useTranslation("timeline");
  const listId = useId();
  const [rows, setRows] = useState(() => toRows(element?.properties));
  const [presetName, setPresetName] = useState(null);

  useEffect(() => {
    setRows(toRows(element?.properties));
  }, [element?.id, element?.properties]);

  const presetsForType = useMemo(
    () => presets.filter((p) => p.type === element?.type),
    [presets, element?.type]
  );
  const activePreset = presets.find((p) => p.id === element?.preset) || null;

  if (!element) return null;

  const commitRows = (nextRows) => {
    const properties = normalizeProperties(nextRows);
    const next = { ...element };
    if (properties.length) next.properties = properties;
    else delete next.properties;
    onCommit?.(next);
  };

  const updateRow = (index, patch) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index) => {
    const nextRows = rows.filter((_, i) => i !== index);
    setRows(nextRows);
    commitRows(nextRows);
  };

  const addRow = () => setRows((prev) => [...prev, { key: "", value: "" }]);

  const handlePresetChange = (value) => {
    if (value === "__starter") {
      const existingIds = new Set(presets.map((p) => p.id));
      onUpdatePresets?.([...presets, ...STARTER_PRESETS.filter((p) => !existingIds.has(p.id))]);
      return;
    }
    if (!value) {
      const next = { ...element };
      delete next.preset;
      onCommit?.(next);
      return;
    }
    const preset = presets.find((p) => p.id === value);
    if (preset) onCommit?.(applyPreset({ ...element, properties: normalizeProperties(rows) }, preset));
  };

  const savePreset = () => {
    const preset = createPresetFromElement({ ...element, properties: normalizeProperties(rows) }, presetName, presets);
    setPresetName(null);
    if (!preset) return;
    onUpdatePresets?.([...presets, preset]);
    onCommit?.({ ...element, properties: normalizeProperties(rows), preset: preset.id });
  };

  const deleteActivePreset = () => {
    if (!activePreset) return;
    if (!window.confirm(t("presets.confirmDelete", "Delete the \"{{name}}\" preset? Elements keep their properties.", { name: activePreset.name }))) return;
    onUpdatePresets?.(presets.filter((p) => p.id !== activePreset.id));
  };

  return (
    <div className="form-group properties-editor">
      <div className="edit-row">
        <label htmlFor={`${listId}-preset`}>{t("presets.label", "Preset")}</label>
        <div className="edit-separator" />
        <div className="properties-preset-wrap">
          {activePreset && (
            <button type="button" className="event-color-revert" title={t("presets.delete", "Delete this preset")} onClick={deleteActivePreset}>
              <Trash2 size={11} />
            </button>
          )}
          <select
            id={`${listId}-preset`}
            className="edit-select properties-preset-select"
            value={activePreset ? activePreset.id : ""}
            onChange={(e) => handlePresetChange(e.target.value)}
          >
            <option value="">{t("presets.none", "None")}</option>
            {presetsForType.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {activePreset && activePreset.type !== element.type && (
              <option value={activePreset.id}>{activePreset.name} ({activePreset.type})</option>
            )}
            {presets.length === 0 && <option value="__starter">{t("presets.addStarters", "Add starter presets…")}</option>}
          </select>
        </div>
      </div>

      <datalist id={`${listId}-keys`}>
        {propertyKeys.map((key) => <option key={key} value={key} />)}
      </datalist>

      {rows.map((row, index) => {
        const keyName = row.key || t("presets.keyPlaceholder", "property");
        return (
        <div key={index} className="property-row">
          <input
            className="edit-input property-key-input"
            value={row.key}
            placeholder={t("presets.keyPlaceholder", "property")}
            list={`${listId}-keys`}
            maxLength={60}
            aria-label={t("presets.keyLabel", "Property name")}
            onChange={(e) => updateRow(index, { key: e.target.value })}
            onBlur={() => commitRows(rows)}
          />
          <input
            className="edit-input property-value-input"
            value={row.value}
            placeholder={t("presets.valuePlaceholder", "value")}
            maxLength={500}
            aria-label={t("presets.valueLabel", "{{field}} value", { field: keyName })}
            onChange={(e) => updateRow(index, { value: e.target.value })}
            onBlur={() => commitRows(rows)}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
          />
          <button type="button" className="property-remove" onClick={() => removeRow(index)} aria-label={t("presets.removeProperty", "Remove {{field}}", { field: keyName })}>
            <X size={12} />
          </button>
        </div>
        );
      })}

      <div className="properties-actions">
        <button type="button" className="btn-add-break" onClick={addRow}>
          <Plus size={11} /> {t("presets.addProperty", "Add custom property")}
        </button>
        {presetName === null ? (
          <button
            type="button"
            className="btn-add-break"
            onClick={() => setPresetName("")}
            title={t("presets.saveHint", "Save this element's type, color, icon, tags and property names as a preset")}
          >
            <Bookmark size={11} /> {t("presets.saveAs", "Save as preset")}
          </button>
        ) : (
          <span className="properties-preset-name">
            <input
              className="edit-input"
              autoFocus
              value={presetName}
              placeholder={t("presets.namePlaceholder", "Preset name (Character, Location…)")}
              maxLength={60}
              aria-label={t("presets.nameLabel", "Preset name")}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); savePreset(); }
                else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPresetName(null); }
              }}
            />
            <button type="button" className="property-remove" onClick={savePreset} disabled={!presetName.trim()} aria-label={t("presets.save", "Save preset")}>
              <Bookmark size={12} />
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
