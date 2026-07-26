import { Minus, Square, X, PanelLeft, PanelRight, Lock, LockOpen } from "lucide-react";

export default function TopBar({
  title = "Timelines",
  version,
  isLeftCollapsed,
  onToggleLeft,
  isRightCollapsed,
  onToggleRight,
  rightLockState,
  onCycleRightLock,
}) {
  const isElectron = window.electron !== undefined;

  const handleMinimize = () => {
    if (isElectron) window.electron.minimizeWindow();
  };

  const handleMaximize = () => {
    if (isElectron) window.electron.maximizeWindow();
  };

  const handleClose = () => {
    if (isElectron) window.electron.closeWindow();
  };

  if (!isElectron) {
    return null; // Don't show title bar in web version
  }

  return (
    <div className="custom-title-bar">
      <div className="title-bar-drag-region">
        <svg
          className="title-bar-icon"
          width="67"
          height="25"
          viewBox="0 0 67 25"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect y="8.89844" width="28.2656" height="6.80469" fill="currentColor" />
          <rect x="35.0703" width="31.9297" height="7.32812" fill="currentColor" />
          <rect x="35.0703" y="16.75" width="31.9297" height="7.32812" fill="currentColor" />
          <path
            d="M28.2656 5C28.2656 2.23858 30.5042 0 33.2656 0H35.0703V24.0781H33.2656C30.5042 24.0781 28.2656 21.8395 28.2656 19.0781V5Z"
            fill="currentColor"
          />
        </svg>
        <span className="title-bar-title">
          {title}
          {version && <span className="title-bar-version">{version}</span>}
        </span>
      </div>
      <div className="title-bar-controls">
        {onToggleLeft && (
          <button
            className="title-bar-button title-bar-panel-toggle"
            onClick={onToggleLeft}
            title={isLeftCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <PanelLeft size={14} />
          </button>
        )}
        {onToggleRight && (
          <button
            className="title-bar-button title-bar-panel-toggle"
            onClick={onToggleRight}
            title={isRightCollapsed ? "Show panel" : "Hide panel"}
          >
            <PanelRight size={14} />
          </button>
        )}
        {onCycleRightLock && (
          <button
            className={`title-bar-button title-bar-panel-toggle${rightLockState ? " title-bar-button-locked" : ""}`}
            onClick={onCycleRightLock}
            title={rightLockState ? "Unlock panel" : "Lock panel"}
          >
            {rightLockState ? <Lock size={13} /> : <LockOpen size={13} />}
          </button>
        )}
        <div className="title-bar-separator" />
        <button className="title-bar-button" onClick={handleMinimize} title="Minimize">
          <Minus size={14} />
        </button>
        <button className="title-bar-button" onClick={handleMaximize} title="Maximize">
          <Square size={12} />
        </button>
        <button className="title-bar-button title-bar-close" onClick={handleClose} title="Close">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
