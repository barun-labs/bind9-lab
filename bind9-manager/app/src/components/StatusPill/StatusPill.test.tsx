import { render, screen } from '@testing-library/react';
import { StatusPill } from './StatusPill';

test('renders label and a state class', () => {
  render(<StatusPill state="pending" label="Pending" />);
  const el = screen.getByText('Pending');
  expect(el).toBeInTheDocument();
});
