import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import TrialBanner from "./TrialBanner";
import EmailVerifyBanner from "./EmailVerifyBanner";
import ImpersonationBanner from "./ImpersonationBanner";

export default function AppLayout() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <ImpersonationBanner />
      <EmailVerifyBanner />
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