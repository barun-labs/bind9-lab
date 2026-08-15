import { render, screen } from '@testing-library/react';
import App from './App';

test('app mounts', () => {
  render(<App />);
  expect(screen.getByText(/Bind9-Manager/i)).toBeInTheDocument();
});
