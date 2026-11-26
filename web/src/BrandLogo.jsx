import SafeImg from './SafeImg.jsx';
// Inlined into the app itself: the logo is on every page, so it must not depend on a separate request that a weak
// connection or a content blocker can drop while the app's own code loads fine.
import logoUrl from './assets/agrivision-logo.png?inline';

/** The AgriVision logo, on a light pill so it reads on the green bars in both themes. Shown on every page. */
export function BrandLogo() {
  return (
    <span className="logo-pill">
      <SafeImg
        src={logoUrl}
        alt="AgriVision"
        width="480"
        height="150"
        fallback={<span className="logo-text">Agri<span>Vision</span></span>}
      />
    </span>
  );
}
