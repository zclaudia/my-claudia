import { useState, useEffect } from 'react';

function hasForcedMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;

  const params = new URLSearchParams(window.location.search);
  return params.get('forceMobile') === '1';
}

/**
 * Hook to detect if a media query matches
 * @param query - CSS media query string (e.g., '(max-width: 767px)')
 * @returns boolean indicating if the media query matches
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    // Initialize with the current value (for SSR safety, default to false)
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (e: MediaQueryListEvent) => setMatches(e.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [query]);

  return matches;
}

/**
 * Hook to detect if the viewport is mobile-sized (< 768px)
 * @returns boolean indicating if viewport is mobile
 */
export function useIsMobile(): boolean {
  const matchesMobile = useMediaQuery('(max-width: 767px)');
  return hasForcedMobileViewport() || matchesMobile;
}

/**
 * Hook to detect if the viewport is tablet-sized (768px - 1023px)
 * @returns boolean indicating if viewport is tablet
 */
export function useIsTablet(): boolean {
  const matchesTablet = useMediaQuery('(min-width: 768px) and (max-width: 1023px)');
  return !hasForcedMobileViewport() && matchesTablet;
}

/**
 * Hook to detect if the viewport is desktop-sized (>= 1024px)
 * @returns boolean indicating if viewport is desktop
 */
export function useIsDesktop(): boolean {
  const matchesDesktop = useMediaQuery('(min-width: 1024px)');
  return !hasForcedMobileViewport() && matchesDesktop;
}
