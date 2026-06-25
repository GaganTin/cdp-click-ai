// Meritma logomark. Two source images share identical geometry:
//   /logo-light.png  → black mark (for light / bright surfaces)
//   /logo-dark.png   → white mark (for dark surfaces)
//
// variant:
//   "auto"    follows the app theme (.dark class) — black mark in light mode,
//             white mark in dark mode. Use on normal surfaces (sidebar, pages).
//   "inverse" the opposite of the theme. Use on surfaces painted with
//             bg-primary / text-primary-foreground (e.g. the auth side panel),
//             which are dark in light mode and light in dark mode.
//   "light"   always the black mark (known light surface).
//   "dark"    always the white mark (known dark surface).
//
// `withName` renders the "Meritma" wordmark beside the mark (a logo lockup).
export default function BrandLogo({
  className = "h-7",
  variant = "auto",
  withName = false,
  nameClass = "",
}) {
  const base = "w-auto select-none";
  const black = "/logo-light.png"; // black mark
  const white = "/logo-dark.png";  // white mark

  let mark;
  if (variant === "light") {
    mark = <img src={black} alt="Meritma" className={`${className} ${base}`} />;
  } else if (variant === "dark") {
    mark = <img src={white} alt="Meritma" className={`${className} ${base}`} />;
  } else if (variant === "inverse") {
    // light theme → white mark, dark theme → black mark
    mark = (
      <>
        <img src={white} alt="Meritma" className={`${className} ${base} block dark:hidden`} />
        <img src={black} alt="Meritma" className={`${className} ${base} hidden dark:block`} />
      </>
    );
  } else {
    // auto: light theme → black mark, dark theme → white mark
    mark = (
      <>
        <img src={black} alt="Meritma" className={`${className} ${base} block dark:hidden`} />
        <img src={white} alt="Meritma" className={`${className} ${base} hidden dark:block`} />
      </>
    );
  }

  return (
    <span className={`inline-flex items-center ${withName ? "gap-2" : ""}`}>
      {mark}
      {withName && (
        <span className={`font-heading font-bold text-lg tracking-tight ${nameClass}`}>Meritma</span>
      )}
    </span>
  );
}
