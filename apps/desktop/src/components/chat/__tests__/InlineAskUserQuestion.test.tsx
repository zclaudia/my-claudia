import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { InlineAskUserQuestion } from '../InlineAskUserQuestion';

const makeRequest = (overrides = {}) => ({
  requestId: 'req-1',
  questions: [{
    header: 'Q1',
    question: 'Pick a color',
    options: [
      { label: 'Red', description: 'The color red' },
      { label: 'Blue', description: 'The color blue' },
    ],
    multiSelect: false,
  }],
  ...overrides,
});

describe('InlineAskUserQuestion', () => {
  it('renders question text', () => {
    const { getByText } = render(
      <InlineAskUserQuestion request={makeRequest()} onAnswer={() => {}} />
    );
    expect(getByText('Pick a color')).toBeTruthy();
    expect(getByText('Red')).toBeTruthy();
    expect(getByText('Blue')).toBeTruthy();
  });

  it('calls onAnswer with skip text when Skip clicked', () => {
    const onAnswer = vi.fn();
    const { getByText } = render(
      <InlineAskUserQuestion request={makeRequest()} onAnswer={onAnswer} />
    );
    fireEvent.click(getByText('Skip'));
    expect(onAnswer).toHaveBeenCalledWith('req-1', 'User declined to answer.');
  });

  it('submit button is disabled when no answer selected', () => {
    const { getByText } = render(
      <InlineAskUserQuestion request={makeRequest()} onAnswer={() => {}} />
    );
    const submitBtn = getByText('Submit');
    expect(submitBtn).toBeDisabled();
  });

  it('shows header and backend name', () => {
    const { getByText } = render(
      <InlineAskUserQuestion
        request={makeRequest({ backendName: 'my-server' })}
        onAnswer={() => {}}
      />
    );
    expect(getByText('my-server')).toBeTruthy();
    expect(getByText('Q1')).toBeTruthy();
  });
});
