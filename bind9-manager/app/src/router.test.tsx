import { render, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { routes } from './router';

test('an unbuilt route renders chrome + placeholder', () => {
  const r = createMemoryRouter(routes, { initialEntries: ['/config/dns-lab/servers'] });
  render(<RouterProvider router={r} />);
  expect(screen.getByText(/Bind9-Manager/i)).toBeInTheDocument(); // sidebar brand in chrome
  expect(screen.getByRole('heading', { name: /Servers & Interfaces/i })).toBeInTheDocument();
});
