import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import TrialBanner from "./TrialBanner";

export default function AppLayout() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <TrialBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}