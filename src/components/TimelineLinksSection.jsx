import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, Link2, Plus, X } from "lucide-react";
import { listTimelines, loadTimeline } from "../utils/electronApi";
import { getStorageId } from "../utils/idUtils";
import { describeLink, normalizeLinks, normalizeListing } from "../utils/timelineLinks";

const TYPE_ORDER = { era: 0, span: 1, event: 2 };

const sortElements = (elements) =>
  [...(elements || [])]
    .filter((el) => el?.id && ["event", "span", "era"].includes(el.type))
    .sort((a, b) => (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || String(a.title || "").localeCompare(String(b.title || "")));

// the library listing is shared by every open links section, one fetch is plenty
let listingPromise = null;
function useLibraryListing(enabled) {
  const [listing, setListing] = useState([]);
  useEffect(() => {
    if (!enabled || window.electron === undefined) return undefined;
    let cancelled = false;
    listingPromise = listingPromise || listTimelines().then(normalizeListing).finally(() => {
      // forget it soon so new timelines show up next time around
      setTimeout(() => { listingPromise = null; }, 5000);
    });
    listingPromise.then((list) => { if (!cancelled) setListing(list); });
    return () => { cancelled = true; };
  }, [enabled]);
  return listing;
}

export default function TimelineLinksSection({ element, timelineData, isEditMode, readOnly = false, onCommit, onFollowLink }) {
  const { t } = useTranslation("timeline");
  const typeLabels = {
    event: t("elementTypes.event", "Event"),
    span: t("elementTypes.span", "Span"),
    era: t("elementTypes.era", "Era"),
  };
  const links = useMemo(() => normalizeLinks(element?.links), [element?.links]);
  const canBrowse = window.electron !== undefined;
  const listing = useLibraryListing(canBrowse && (links.length > 0 || isEditMode));
  const currentUid = getStorageId(timelineData?.file);

  const [isAdding, setIsAdding] = useState(false);
  const [targetTimeline, setTargetTimeline] = useState("");
  const [targetElements, setTargetElements] = useState([]);
  const [targetElement, setTargetElement] = useState("");
  const [isLoadingTarget, setIsLoadingTarget] = useState(false);

  useEffect(() => {
    setIsAdding(false);
    setTargetTimeline("");
    setTargetElement("");
  }, [element?.id]);

  useEffect(() => {
    if (!targetTimeline) {
      setTargetElements([]);
      return undefined;
    }
    if (targetTimeline === currentUid) {
      setTargetElements(sortElements(timelineData?.elements).filter((el) => el.id !== element?.id));
      return undefined;
    }
    const entry = listing.find((item) => item.uid === targetTimeline);
    if (!entry) return undefined;
    let cancelled = false;
    setIsLoadingTarget(true);
    loadTimeline(entry.id)
      .then((data) => { if (!cancelled) setTargetElements(sortElements(data?.elements)); })
      .catch(() => { if (!cancelled) setTargetElements([]); })
      .finally(() => { if (!cancelled) setIsLoadingTarget(false); });
    return () => { cancelled = true; };
  }, [targetTimeline, currentUid, listing, timelineData?.elements, element?.id]);

  if (!element) return null;
  if (!isEditMode && links.length === 0) return null;

  const commitLinks = (nextLinks) => {
    const normalized = normalizeLinks(nextLinks);
    const next = { ...element };
    if (normalized.length) next.links = normalized;
    else delete next.links;
    onCommit?.(next);
  };

  const addLink = () => {
    if (!targetTimeline) return;
    const isSelf = targetTimeline === currentUid;
    const entry = listing.find((item) => item.uid === targetTimeline);
    const target = targetElements.find((el) => el.id === targetElement);
    const link = { timeline: targetTimeline };
    if (!isSelf && entry?.name) link.timelineTitle = entry.name;
    if (target) {
      link.element = target.id;
      link.elementTitle = target.title || target.id;
    }
    commitLinks([...links, link]);
    setIsAdding(false);
    setTargetTimeline("");
    setTargetElement("");
  };

  const renderLink = (link, index) => {
    const info = describeLink(link, listing, currentUid);
    const timelineTitle = info.isSelf
      ? t("links.thisTimeline", "This timeline")
      : info.timelineTitle || t("links.missingTimeline", "Missing timeline");
    const label = info.elementTitle ? `${timelineTitle} · ${info.elementTitle}` : timelineTitle;
    return (
      <div key={`${link.timeline}-${link.element ?? ""}`} className={`timeline-link-row${info.isMissing ? " is-missing" : ""}`}>
        <button
          type="button"
          className="timeline-link-button"
          disabled={!onFollowLink || info.isMissing}
          title={info.isMissing ? t("links.missingHint", "That timeline isn't in your library anymore") : t("links.goTo", "Go to {{label}}", { label })}
          onClick={() => onFollowLink?.(link)}
        >
          <ArrowUpRight size={12} />
          <span className="timeline-link-label">{label}</span>
        </button>
        {isEditMode && !readOnly && (
          <button
            type="button"
            className="property-remove"
            onClick={() => commitLinks(links.filter((_, i) => i !== index))}
            aria-label={t("links.remove", "Remove link to {{label}}", { label })}
          >
            <X size={12} />
          </button>
        )}
      </div>
    );
  };

  if (!isEditMode) {
    return (
      <div className="view-group view-group-chips">
        <label>{t("links.label", "Links")}</label>
        <div className="view-separator" />
        <div className="timeline-link-list">{links.map(renderLink)}</div>
      </div>
    );
  }

  return (
    <div className="form-group timeline-links-editor">
      <div className="edit-row edit-row-links">
        <label>{t("links.label", "Links")}</label>
        <div className="edit-separator" />
        <div className="timeline-link-list">
          {links.length === 0 && !isAdding && <span className="timeline-link-empty">{t("links.empty", "No links yet")}</span>}
          {links.map(renderLink)}
        </div>
      </div>
      {!readOnly && (isAdding ? (
        <div className="timeline-link-picker">
          <select
            className="edit-select"
            value={targetTimeline}
            aria-label={t("links.pickTimelineLabel", "Timeline to link")}
            onChange={(e) => { setTargetTimeline(e.target.value); setTargetElement(""); }}
          >
            <option value="">{t("links.pickTimeline", "Pick a timeline…")}</option>
            {currentUid && <option value={currentUid}>{t("links.thisTimeline", "This timeline")}</option>}
            {listing
              .filter((entry) => entry.uid && entry.uid !== currentUid && !entry.isPackage)
              .sort((a, b) => String(a.name).localeCompare(String(b.name)))
              .map((entry) => (
                <option key={entry.uid} value={entry.uid}>{entry.folder ? `${entry.folder}/` : ""}{entry.name}</option>
              ))}
          </select>
          <select
            className="edit-select"
            value={targetElement}
            aria-label={t("links.pickElementLabel", "Element to land on")}
            disabled={!targetTimeline || isLoadingTarget}
            onChange={(e) => setTargetElement(e.target.value)}
          >
            <option value="">
              {isLoadingTarget
                ? t("links.loading", "Loading…")
                : targetTimeline === currentUid ? t("links.pickElement", "Pick an element…") : t("links.wholeTimeline", "Whole timeline")}
            </option>
            {targetElements.map((el) => (
              <option key={el.id} value={el.id}>{typeLabels[el.type] ?? el.type} · {el.title || el.id}</option>
            ))}
          </select>
          <div className="properties-actions">
            <button type="button" className="btn-add-break" onClick={() => setIsAdding(false)}>{t("common:actions.cancel", "Cancel")}</button>
            <button
              type="button"
              className="btn-add-break"
              disabled={!targetTimeline || (targetTimeline === currentUid && !targetElement)}
              onClick={addLink}
            >
              <Link2 size={11} /> {t("links.add", "Add link")}
            </button>
          </div>
        </div>
      ) : (
        <div className="properties-actions">
          <button type="button" className="btn-add-break" onClick={() => setIsAdding(true)} disabled={!canBrowse && !currentUid}>
            <Plus size={11} /> {t("links.start", "Link to a timeline or element")}
          </button>
        </div>
      ))}
    </div>
  );
}
