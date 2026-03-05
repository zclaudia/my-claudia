import type { LucideIcon } from 'lucide-react';

interface IconProps {
  icon: LucideIcon;
  size?: number;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ icon: LucideComponent, size = 16, className = '', strokeWidth = 1.75 }: IconProps) {
  return (
    <LucideComponent
      size={size}
      strokeWidth={strokeWidth}
      className={`inline-flex flex-shrink-0 ${className}`}
    />
  );
}
