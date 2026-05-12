import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WindowContextBar } from '../WindowContextBar';

describe('WindowContextBar', () => {
  it('renders server and project context', () => {
    render(<WindowContextBar serverName="Local" projectId="project-1" />);

    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('project-1')).toBeInTheDocument();
  });

  it('renders nothing without context', () => {
    const { container } = render(<WindowContextBar />);

    expect(container).toBeEmptyDOMElement();
  });
});
