import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Icon } from '../Icon';
import { Home } from 'lucide-react';

describe('Icon', () => {
  it('renders the lucide icon component', () => {
    const { container } = render(<Icon icon={Home} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('applies custom className', () => {
    const { container } = render(<Icon icon={Home} className="text-red-500" />);
    const svg = container.querySelector('svg');
    expect(svg?.className.baseVal || svg?.getAttribute('class')).toContain('text-red-500');
  });
});
