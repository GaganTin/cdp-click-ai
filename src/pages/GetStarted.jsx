import { Rocket } from "lucide-react";

export default function GetStarted() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-8 pt-8 pb-0 flex-shrink-0">
        <div className="mb-5">
          <h1 className="font-heading text-3xl font-semibold tracking-tight">Get Started</h1>
          <p className="text-sm text-muted-foreground mt-1">Your onboarding guide to Click CDP.</p>
        </div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Rocket className="w-12 h-12 mx-auto mb-4 opacity-20" />
          <p className="text-sm font-medium text-foreground">Coming soon</p>
          <p className="text-xs mt-1">The onboarding guide will be available here.</p>
        </div>
      </div>
    </div>
  );
}
