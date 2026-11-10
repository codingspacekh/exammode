import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '@/App';

/** M0: the placeholder window — titled ExamMode, built from shadcn/ui (N-07). */
describe('M0 the placeholder window', () => {
  it('shows the app name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'ExamMode' })).toBeInTheDocument();
  });
  it('uses the shadcn Button, in the primary (accent) style', () => {
    render(<App />);
    const button = screen.getByRole('button', { name: 'Join an exam' });
    expect(button).toHaveAttribute('data-slot', 'button');
    expect(button.className).toContain('bg-primary');
  });
});
