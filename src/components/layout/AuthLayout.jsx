import { Link } from "react-router-dom";

// Google "G" logo SVG
export function GoogleIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

// Microsoft logo SVG (four coloured squares)
export function MicrosoftIcon({ className = "w-5 h-5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.4 11.4H2V2h9.4v9.4z" fill="#F25022" />
      <path d="M22 11.4h-9.4V2H22v9.4z" fill="#7FBA00" />
      <path d="M11.4 22H2v-9.4h9.4V22z" fill="#00A4EF" />
      <path d="M22 22h-9.4v-9.4H22V22z" fill="#FFB900" />
    </svg>
  );
}

// Divider with "or" text
export function OrDivider() {
  return (
    <div className="relative my-6">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-border" />
      </div>
      <div className="relative flex justify-center text-xs">
        <span className="bg-background px-3 text-muted-foreground">or continue with email</span>
      </div>
    </div>
  );
}

// Google OAuth button
export function GoogleButton({ action = "Continue" }) {
  const handleClick = () => {
    window.location.href = "/api/auth/google";
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-border rounded-md bg-background hover:bg-secondary text-sm font-medium transition-colors"
    >
      <GoogleIcon />
      {action} with Google
    </button>
  );
}

// Microsoft OAuth button
export function MicrosoftButton({ action = "Continue" }) {
  const handleClick = () => {
    window.location.href = "/api/auth/microsoft";
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-border rounded-md bg-background hover:bg-secondary text-sm font-medium transition-colors"
    >
      <MicrosoftIcon />
      {action} with Microsoft
    </button>
  );
}

// Branded logo - matches the landing page wordmark ("Click CDP")
export function Logo({ className = "" }) {
  return (
    <Link to="/" className={`inline-flex items-center gap-2 ${className}`}>
      <span className="font-bold text-lg tracking-tight">Click CDP</span>
    </Link>
  );
}

// Full-page auth layout: left panel (branding) + right panel (form)
export function AuthLayout({ children, title, subtitle, illustrationContent }) {
  return (
    <div className="min-h-screen flex">
      {/* Left panel - branding / illustration */}
      <div className="hidden lg:flex lg:w-[440px] flex-col bg-primary p-10 text-primary-foreground relative overflow-hidden flex-shrink-0">
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 -left-20 w-72 h-72 rounded-full bg-white" />
          <div className="absolute bottom-20 -right-10 w-96 h-96 rounded-full bg-white" />
        </div>
        <div className="relative z-10">
          <Logo className="text-primary-foreground [&>span]:text-primary-foreground" />
        </div>
        <div className="relative z-10 flex-1 flex flex-col justify-center">
          {illustrationContent || (
            <div className="space-y-6">
              <div>
                <h2 className="text-3xl font-bold leading-tight">
                  Your customer data,<br />finally connected.
                </h2>
                <p className="mt-3 text-primary-foreground/70 text-sm leading-relaxed">
                  Unify profiles, launch campaigns, and let AI surface insights - all in one workspace.
                </p>
              </div>
              <div className="space-y-3">
                {[
                  "AI-powered analyst that answers in plain English",
                  "Unified customer profiles across every channel",
                  "Email campaigns with real-time engagement tracking",
                  "Audience segments built on live data",
                ].map((f) => (
                  <div key={f} className="flex items-start gap-2 text-sm text-primary-foreground/80">
                    <svg className="w-4 h-4 text-primary-foreground mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    {f}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="relative z-10 text-xs text-primary-foreground/50">
          © {new Date().getFullYear()} Click CDP
        </div>
      </div>

      {/* Right panel - form */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12 bg-background">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8">
          <Logo />
        </div>

        <div className="w-full max-w-sm">
          {title && (
            <div className="mb-8">
              <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
              {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
            </div>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
