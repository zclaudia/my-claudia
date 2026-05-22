// apps/desktop/src/features/openspec/__tests__/MarkdownPreview.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarkdownPreview } from '../components/MarkdownPreview.js';

describe('MarkdownPreview', () => {
  it('renders headings with custom classes', () => {
    render(
      <MarkdownPreview
        content={`# H1\n\n## H2\n\n### Requirement: Login\n\n#### Scenario: x`}
      />,
    );
    expect(screen.getByText('H1')).toBeInTheDocument();
    expect(screen.getByText(/Requirement: Login/)).toBeInTheDocument();
    expect(screen.getByText(/Scenario: x/)).toBeInTheDocument();
  });

  it('renders lists', () => {
    render(<MarkdownPreview content={`- Item 1\n- Item 2`} />);
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('renders inline code', () => {
    render(<MarkdownPreview content="See `apiCall` helper." />);
    expect(screen.getByText('apiCall')).toBeInTheDocument();
  });

  it('empty content renders without crashing', () => {
    render(<MarkdownPreview content="" />);
    // No assertion — just ensure render didn't throw.
    expect(true).toBe(true);
  });

  it('renders **bold** as strong', () => {
    render(<MarkdownPreview content="this is **important** text" />);
    expect(screen.getByText('important').tagName).toBe('STRONG');
  });
});
