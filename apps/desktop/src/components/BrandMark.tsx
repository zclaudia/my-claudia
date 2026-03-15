import { useTheme, isDarkTheme } from '../contexts/ThemeContext';

interface BrandMarkProps {
  className?: string;
}

export function BrandMark({ className = '' }: BrandMarkProps) {
  const { resolvedTheme } = useTheme();
  const src = isDarkTheme(resolvedTheme) ? '/logo-transparent-dark.png' : '/logo-transparent.png';

  return <img src={src} alt="" className={className} draggable={false} />;
}
