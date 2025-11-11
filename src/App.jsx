import TimelineView from "./components/TimelineView";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import BottomPanel from "./components/BottomPanel";
import "./index.css";

function App() {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Sidebar />
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <TopBar />
        </header>

        <main className="app-content">
          <TimelineView />
        </main>

        <footer className="app-bottom">
          <BottomPanel />
        </footer>
      </div>
    </div>
  );
}

export default App;