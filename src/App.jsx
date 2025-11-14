import { useState, useRef, useEffect } from "react";
import TimelineView from "./components/TimelineView";
import Sidebar from "./components/Sidebar";
import RightPanel from "./components/RightPanel";
import "./index.css";

function App() {
  const MIN_WIDTH = 220;
  const MAX_WIDTH = 455;
  const COLLAPSED_WIDTH = 44;

  const [sidebarWidth, setSidebarWidth] = useState(MIN_WIDTH);
  const [rightWidth, setRightWidth] = useState(MIN_WIDTH);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);

  const [selectedId, setSelectedId] = useState(null);

  const isDraggingLeft = useRef(false);
  const isDraggingRight = useRef(false);

  useEffect(() => {
    function handleMouseMove(e) {
      if (isDraggingLeft.current && !isLeftCollapsed) {
        e.preventDefault();
        const next = Math.min(Math.max(e.clientX, MIN_WIDTH), MAX_WIDTH);
        setSidebarWidth(next);
      } else if (isDraggingRight.current) {
        e.preventDefault();
        const windowWidth = window.innerWidth;
        const distanceFromRight = windowWidth - e.clientX;
        const next = Math.min(
          Math.max(distanceFromRight, MIN_WIDTH),
          MAX_WIDTH
        );
        setRightWidth(next);
      }
    }

    function handleMouseUp() {
      if (isDraggingLeft.current || isDraggingRight.current) {
        isDraggingLeft.current = false;
        isDraggingRight.current = false;
        document.body.classList.remove("dragging");
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isLeftCollapsed]);

  const currentLeftWidth = isLeftCollapsed ? COLLAPSED_WIDTH : sidebarWidth;

  const handleSelect = (id) => {
    setSelectedId(id);
  };

  return (
    <div className="app-shell">
      <aside
        className="app-sidebar overlay-sidebar"
        style={{ width: currentLeftWidth }}
      >
        <Sidebar
          isCollapsed={isLeftCollapsed}
          onToggle={() => setIsLeftCollapsed((v) => !v)}
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </aside>

      {!isLeftCollapsed && (
        <div
          className="sidebar-resizer overlay-resizer"
          style={{ left: `${currentLeftWidth - 3}px` }}
          onMouseDown={(e) => {
            e.preventDefault();
            isDraggingLeft.current = true;
            document.body.classList.add("dragging");
          }}
        />
      )}

      <main className="app-content">
        <TimelineView
          selectedId={selectedId}
          onSelect={handleSelect}
        />
      </main>

      {selectedId && (
        <>
          <div
            className="right-resizer overlay-resizer"
            style={{ right: `${Math.max(rightWidth, MIN_WIDTH) - 3}px` }}
            onMouseDown={(e) => {
              e.preventDefault();
              isDraggingRight.current = true;
              document.body.classList.add("dragging");
            }}
          />

          <aside
            className="app-right overlay-right"
            style={{ width: rightWidth }}
          >
            <RightPanel
              selectedId={selectedId}
              onSelect={handleSelect}
            />
          </aside>
        </>
      )}
    </div>
  );
}

export default App;