import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import TrialBanner from "./TrialBanner";
import EmailVerifyBanner from "./EmailVerifyBanner";
import ImpersonationBanner from "./ImpersonationBanner";
import AnnouncementBanner from "./AnnouncementBanner";
import AiCreditBanner from "./AiCreditBanner";
import DemoBanner from "./DemoBanner";
import AccountClosedBanner from "./AccountClosedBanner";

export default function AppLayout() {
  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <ImpersonationBanner />
      <AnnouncementBanner />
      <EmailVerifyBanner />
      <AccountClosedBanner />
      <TrialBanner />
      <AiCreditBanner />
      <DemoBanner />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}