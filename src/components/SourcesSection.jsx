import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, ChevronDown, Pencil, Trash2, ExternalLink } from "lucide-react";

export default function SourcesSection({ sources, sourceLink, isEditMode, onSourcesChange }) {
  const { t } = useTranslation("timeline");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");

  const srcList = Array.isArray(sources) ? sources : [];

  const resetForm = () => { setTitle(""); setUrl(""); setDescription(""); };

  const handleAdd = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    onSourcesChange([...srcList, { title: trimmedTitle, url: url.trim(), description: description.trim() }], sourceLink);
    resetForm();
    setIsFormOpen(false);
  };

  const handleEdit = (i) => {
    const src = srcList[i];
    setEditingIndex(i);
    setTitle(src.title || "");
    setUrl(src.url || "");
    setDescription(src.description || src.citation || "");
  };

  const handleSaveEdit = () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    const next = srcList.map((src, i) =>
      i === editingIndex ? { title: trimmedTitle, url: url.trim(), description: description.trim() } : src
    );
    onSourcesChange(next, sourceLink);
    setEditingIndex(null);
    resetForm();
  };

  const handleRemove = (index) => {
    const next = srcList.filter((_, i) => i !== index);
    const nextLink = sourceLink && srcList[index]?.url === sourceLink ? null : sourceLink;
    onSourcesChange(next, nextLink);
  };

  const handleToggleSourceLink = (src) => {
    const nextLink = sourceLink === src.url ? null : src.url;
    onSourcesChange(srcList, nextLink);
  };

  const cancelEdit = () => { setEditingIndex(null); resetForm(); };

  if (!isEditMode) {
    if (!srcList.length) return null;
    return (
      <>
        <div className="note-divider" />
        <button type="button" className="rp-note-header sources-collapse-btn" onClick={() => setIsCollapsed(v => !v)}>
          <span className="rp-sources-label"><Link size={12} strokeWidth={2} />{t("sources.heading", "Sources")}</span>
          <span className="sources-collapse-right">
            <span className="rp-note-meta">{srcList.length}</span>
            <ChevronDown size={14} style={{ transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s ease", color: "var(--ui-muted)" }} />
          </span>
        </button>
        {!isCollapsed && (
          <div className="sources-list">
            {srcList.map((src, i) => (
              <div key={`${src.title}-${i}`} className="wiki-url-card">
                <div className="wiki-url-card-avatar">{src.title.charAt(0).toUpperCase()}</div>
                <div className="wiki-url-card-info">
                  <div className="wiki-url-card-title">{src.title}</div>
                  {(src.description || src.citation) && <div className="wiki-url-card-host">{src.description || src.citation}</div>}
                </div>
                {src.url && <a href={src.url} target="_blank" rel="noopener noreferrer" className="wiki-url-card-btn" title={t("common:actions.open", "Open")}><ExternalLink size={13} /></a>}
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  // Edit mode
  return (
    <div className="sources-edit-section">
      <button type="button" className="rp-note-header sources-collapse-btn" onClick={() => setIsCollapsed(v => !v)}>
        <span className="rp-sources-label"><Link size={12} strokeWidth={2} />{t("sources.heading", "Sources")}</span>
        <span className="sources-collapse-right">
          {srcList.length > 0 && <span className="rp-note-meta">{srcList.length}</span>}
          <ChevronDown size={14} style={{ transform: isCollapsed ? "rotate(-90deg)" : "none", transition: "transform 0.15s ease", color: "var(--ui-muted)" }} />
        </span>
      </button>
      {!isCollapsed && (
        <div className="sources-list">
          {srcList.map((src, i) => (
            editingIndex === i ? (
              <div key={`${src.title}-${i}`} className="source-add-form" style={{ marginTop: 0, paddingTop: 8, borderTop: "none" }}>
                <div className="source-field">
                  <label className="source-field-label">{t("sources.fields.title", "Title")}</label>
                  <input type="text" className="source-field-input" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }} autoFocus />
                </div>
                <div className="source-field">
                  <label className="source-field-label">{t("sources.fields.url", "URL (optional)")}</label>
                  <input type="text" className="source-field-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }} />
                </div>
                <div className="source-field">
                  <label className="source-field-label">{t("sources.fields.description", "Description (optional)")}</label>
                  <textarea className="source-field-input source-field-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("sources.fields.descriptionPlaceholder", "Author, year, notes…")} rows={2} onKeyDown={(e) => { if (e.key === "Escape") cancelEdit(); }} />
                </div>
                <div className="source-add-actions">
                  <button type="button" className="btn-secondary" onClick={cancelEdit}>{t("common:actions.cancel", "Cancel")}</button>
                  <button type="button" className="btn-primary" onClick={handleSaveEdit}>{t("common:actions.save", "Save")}</button>
                </div>
              </div>
            ) : (
              <div key={`${src.title}-${i}`} className="source-item">
                <div className="wiki-url-card-avatar">{src.title.charAt(0).toUpperCase()}</div>
                <div className="source-text">
                  <span className="source-title">{src.title}</span>
                  {(src.description || src.citation) && <span className="source-citation">{src.description || src.citation}</span>}
                </div>
                <div className="source-item-actions">
                  {src.url && (
                    <button
                      type="button"
                      className={`wiki-url-card-btn${sourceLink === src.url ? " source-link-active" : ""}`}
                      title={sourceLink === src.url ? t("sources.unfeature", "Remove featured link") : t("sources.feature", "Set as featured link")}
                      onClick={() => handleToggleSourceLink(src)}
                    ><Link size={13} /></button>
                  )}
                  <button type="button" className="wiki-url-card-btn" onClick={() => handleEdit(i)} title={t("common:actions.edit", "Edit")}><Pencil size={13} /></button>
                  <button type="button" className="wiki-url-card-btn wiki-url-card-btn-remove" onClick={() => handleRemove(i)} title={t("common:actions.remove", "Remove")}><Trash2 size={13} /></button>
                </div>
              </div>
            )
          ))}
        </div>
      )}
      {!isCollapsed && (isFormOpen ? (
        <div className="source-add-form">
          <div className="source-field">
            <label className="source-field-label">{t("sources.fields.title", "Title")}</label>
            <input type="text" className="source-field-input" placeholder={t("sources.fields.titlePlaceholder", "Source title")} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setIsFormOpen(false); }} autoFocus />
          </div>
          <div className="source-field">
            <label className="source-field-label">{t("sources.fields.url", "URL (optional)")}</label>
            <input type="text" className="source-field-input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setIsFormOpen(false); }} />
          </div>
          <div className="source-field">
            <label className="source-field-label">{t("sources.fields.description", "Description (optional)")}</label>
            <textarea className="source-field-input source-field-textarea" placeholder={t("sources.fields.descriptionPlaceholder", "Author, year, notes…")} value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setIsFormOpen(false); }} rows={3} />
          </div>
          <div className="source-add-actions">
            <button type="button" className="btn-secondary" onClick={() => { setIsFormOpen(false); resetForm(); }}>{t("common:actions.cancel", "Cancel")}</button>
            <button type="button" className="btn-primary" onClick={handleAdd}>{t("sources.add", "Add source")}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="source-add-btn" onClick={() => setIsFormOpen(true)}>+ Add source</button>
      ))}
    </div>
  );
}
