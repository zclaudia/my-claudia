import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ToastContainer } from '../ToastContainer';
import { useToastStore } from '../../stores/toastStore';

describe('ToastContainer', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it('renders with the default bottom-right positioning', () => {
    useToastStore.setState({
      toasts: [
        {
          id: 'toast-1',
          title: 'Saved',
          type: 'success',
          createdAt: Date.now(),
        },
      ],
    });

    render(<ToastContainer />);

    expect(screen.getByTestId('toast-container')).toHaveClass('fixed', 'bottom-4', 'right-4');
  });

  it('allows the caller to override the container position', () => {
    useToastStore.setState({
      toasts: [
        {
          id: 'toast-2',
          title: 'Updated',
          type: 'info',
          createdAt: Date.now(),
        },
      ],
    });

    render(<ToastContainer className="absolute top-4 left-1/2 -translate-x-1/2" />);

    expect(screen.getByTestId('toast-container')).toHaveClass(
      'absolute',
      'top-4',
      'left-1/2',
      '-translate-x-1/2',
    );
  });
});
