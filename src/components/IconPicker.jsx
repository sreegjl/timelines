import { useState, useRef, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { ICON_CATEGORIES, ALL_ICONS } from "../config/elementIcons";

export default function IconPicker({ value, onChange }) {
  const { t } = useTranslation("timeline");
  // Listed statically so i18next-parser can see every category key.
  const categoryLabels = useMemo(() => ({
    people: t("iconCategories.people", "People & Emotions"),
    places: t("iconCategories.places", "Places"),
    time: t("iconCategories.time", "Time"),
    events: t("iconCategories.events", "Events & Milestones"),
    military: t("iconCategories.military", "Military & Politics"),
    religion: t("iconCategories.religion", "Religion & Culture"),
    science: t("iconCategories.science", "Science, Tech & Education"),
    arts: t("iconCategories.arts", "Arts, Media & Gaming"),
    transport: t("iconCategories.transport", "Transport"),
    nature: t("iconCategories.nature", "Nature & Animals"),
    food: t("iconCategories.food", "Food, Health & Commerce"),
    tools: t("iconCategories.tools", "Tools & Communication"),
    symbols: t("iconCategories.symbols", "Symbols"),
  }), [t]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const popoverRef = useRef(null);

  const CurrentIcon = value
    ? ALL_ICONS.find((i) => i.name === value)?.component
    : null;

  useEffect(() => {
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (!popoverRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = query.trim()
    ? ALL_ICONS.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()))
    : null;

  const handleSelect = (name) => {
    onChange(name === value ? null : name);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="icon-picker-wrap">
      <>
        <button
          type="button"
          className={`icon-picker-trigger${value ? " has-icon" : ""}`}
          onClick={() => setOpen((v) => !v)}
          title={value ? t("iconPicker.current", "Icon: {{name}}", { name: value }) : t("iconPicker.add", "Add icon")}
        >
          {CurrentIcon ? <CurrentIcon size={14} /> : <span className="icon-picker-placeholder">{t("iconPicker.none", "No icon")}</span>}
        </button>
        {value && (
          <button
            type="button"
            className="icon-picker-clear"
            onClick={() => onChange(null)}
            title={t("iconPicker.remove", "Remove icon")}
          >
            <X size={10} />
          </button>
        )}
      </>
      {open && (
        <div className="icon-picker-popover" ref={popoverRef}>
          <div className="icon-picker-search-wrap">
            <input
              ref={searchRef}
              type="text"
              className="icon-picker-search"
              placeholder={t("iconPicker.search", "Search icons...")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="icon-picker-grid-wrap">
            {filtered ? (
              filtered.length > 0 ? (
                <div className="icon-picker-grid">
                  {filtered.map((entry) => (
                    <button
                      key={entry.name}
                      type="button"
                      className={`icon-picker-cell${value === entry.name ? " is-selected" : ""}`}
                      title={entry.name}
                      onClick={() => handleSelect(entry.name)}
                    >
                      <entry.component size={16} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="icon-picker-empty">{t("iconPicker.noMatches", "No icons match")}</div>
              )
            ) : (
              ICON_CATEGORIES.map((cat) => (
                <div key={cat.id} className="icon-picker-category">
                  <div className="icon-picker-category-label">{categoryLabels[cat.id] || cat.label}</div>
                  <div className="icon-picker-grid">
                    {cat.icons.map((entry) => (
                      <button
                        key={entry.name}
                        type="button"
                        className={`icon-picker-cell${value === entry.name ? " is-selected" : ""}`}
                        title={entry.name}
                        onClick={() => handleSelect(entry.name)}
                      >
                        <entry.component size={16} />
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
